import {
  DOCUMENT_IR_SCHEMA_VERSION,
  ObjectStatus,
  ObjectType,
  ReconstructionStrategy,
  RegionType,
  type DocumentIR,
  type DocumentObjectIR,
  type EvidenceIR,
  type PageIR,
  type RegionIR,
} from '../../domain/document/DocumentIR';
import {
  CoordinateSpace,
  createBbox,
  normalizedEngineToPageSpace,
} from '../../domain/geometry/CoordinateSpace';
import {
  TaskStage,
  type ProcessingTask,
  type TaskLogEntry,
} from '../../domain/task/TaskTypes';
import type { TerminologyEntry } from '../../domain/translation/TranslationTypes';
import {
  applyOverlaysToSpec,
  geminiAdapter,
  type GeminiAnalyzedObject,
} from '../../engines/adapters/gemini/GeminiAdapter';
import {
  pdfJsAdapter,
  type LoadedPdfHandle,
  type NativeTextFragment,
} from '../../engines/adapters/pdfjs/PdfJsAdapter';
import { diagramReconstructor } from '../../engines/adapters/geometry/DiagramReconstructor';
import { protectionService } from '../services/ProtectionService';
import { qualityGateService } from '../services/QualityGateService';

async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function mapObjectType(raw: string): ObjectType {
  const upper = raw.toUpperCase().trim();
  if (upper in ObjectType) {
    return ObjectType[upper as keyof typeof ObjectType];
  }
  return ObjectType.UNKNOWN;
}

function mapRegionType(objType: ObjectType): RegionType {
  switch (objType) {
    case ObjectType.HEADING:
      return RegionType.SECTION_HEADING;
    case ObjectType.PARAGRAPH:
    case ObjectType.TEXT:
      return RegionType.PARAGRAPH;
    case ObjectType.LIST:
      return RegionType.LIST;
    case ObjectType.TABLE:
      return RegionType.TABLE;
    case ObjectType.FORMULA:
      return RegionType.FORMULA;
    case ObjectType.CHART:
    case ObjectType.PLOT:
      return RegionType.CHART;
    case ObjectType.CAD_DRAWING:
    case ObjectType.DIAGRAM:
    case ObjectType.FLOWCHART:
    case ObjectType.IMAGE:
      return RegionType.FIGURE;
    case ObjectType.CAPTION:
      return RegionType.CAPTION;
    case ObjectType.HEADER:
      return RegionType.HEADER;
    case ObjectType.FOOTER:
      return RegionType.FOOTER;
    case ObjectType.FOOTNOTE:
      return RegionType.FOOTNOTE;
    default:
      return RegionType.UNKNOWN;
  }
}

function chooseStrategy(objType: ObjectType, confidence: number | null, needsReview: boolean): ReconstructionStrategy {
  if (
    objType === ObjectType.CAD_DRAWING ||
    objType === ObjectType.DIAGRAM ||
    objType === ObjectType.FLOWCHART ||
    objType === ObjectType.IMAGE
  ) {
    return ReconstructionStrategy.C_PRESERVE_ORIGINAL;
  }
  if (objType === ObjectType.CHART || objType === ObjectType.PLOT) {
    return ReconstructionStrategy.C_PRESERVE_ORIGINAL;
  }
  if (objType === ObjectType.FORMULA) {
    if (needsReview || (confidence !== null && confidence < 0.72)) {
      return ReconstructionStrategy.C_PRESERVE_ORIGINAL;
    }
    return ReconstructionStrategy.B_VECTOR;
  }
  return ReconstructionStrategy.A_NATIVE;
}

function collectNativeTextInsideBbox(
  fragments: NativeTextFragment[],
  bbox: { x1: number; y1: number; x2: number; y2: number }
): string {
  const inside = fragments.filter((frag) => {
    const cx = (frag.bboxPage.x1 + frag.bboxPage.x2) / 2;
    const cy = (frag.bboxPage.y1 + frag.bboxPage.y2) / 2;
    return cx >= bbox.x1 - 4 && cx <= bbox.x2 + 4 && cy >= bbox.y1 - 4 && cy <= bbox.y2 + 4;
  });
  if (inside.length === 0) return '';

  // Sort top-to-bottom, left-to-right
  inside.sort((a, b) => {
    const dy = a.bboxPage.y1 - b.bboxPage.y1;
    if (Math.abs(dy) > 4) return dy;
    return a.bboxPage.x1 - b.bboxPage.x1;
  });

  const lines: string[] = [];
  let currentLine: string[] = [];
  let currentY: number | null = null;
  for (const frag of inside) {
    if (currentY === null || Math.abs(frag.bboxPage.y1 - currentY) <= Math.max(5, frag.fontSize * 0.6)) {
      currentLine.push(frag.text);
      if (currentY === null) currentY = frag.bboxPage.y1;
    } else {
      lines.push(currentLine.join(' ').replace(/\s+/g, ' ').trim());
      currentLine = [frag.text];
      currentY = frag.bboxPage.y1;
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine.join(' ').replace(/\s+/g, ' ').trim());
  }
  return lines.join('\n').trim();
}

export interface ImportedDocumentBundle {
  document: DocumentIR;
  task: ProcessingTask;
  fileBuffer: ArrayBuffer;
  pdfHandle?: LoadedPdfHandle;
}

export const documentPipeline = {
  createLog(
    taskId: string,
    stage: TaskStage,
    module: string,
    action: string,
    status: TaskLogEntry['status'],
    message: string,
    extra?: Partial<TaskLogEntry>
  ): TaskLogEntry {
    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level: status === 'FAIL' ? 'ERROR' : status === 'WARN' ? 'WARN' : 'INFO',
      taskId,
      stage,
      module,
      action,
      status,
      message,
      ...extra,
    };
  },

  async importFile(
    file: File,
    sourceLanguage: string,
    targetLanguage: string,
    domainHint: string
  ): Promise<ImportedDocumentBundle> {
    const buffer = await file.arrayBuffer();
    const fileHash = await computeSha256Hex(buffer);
    const documentId = `doc_${crypto.randomUUID().slice(0, 8)}`;
    const taskId = `task_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    const logs: TaskLogEntry[] = [
      this.createLog(
        taskId,
        TaskStage.IMPORTING,
        'ImportWorkflow',
        'readFile',
        'OK',
        `已读取真实文件 ${file.name} (${(file.size / 1024).toFixed(1)} KB, SHA-256: ${fileHash.slice(0, 12)})`
      ),
    ];

    if (isPdf) {
      const pdfHandle = await pdfJsAdapter.openPdf(buffer);
      const pages: PageIR[] = [];

      // Preflight extract & render all pages (sequentially to keep memory predictable)
      for (let i = 0; i < pdfHandle.pageCount; i++) {
        const pageId = `${documentId}_p${i + 1}`;
        const native = await pdfJsAdapter.extractAndRenderPage(pdfHandle.proxy, i, pageId, 1.5);
        pages.push({
          pageId,
          documentId,
          pageIndex: i,
          widthPt: native.widthPt,
          heightPt: native.heightPt,
          rotation: native.rotation,
          mediaBox: native.mediaBox,
          cropBox: native.cropBox,
          tags: native.tags,
          nativeStats: native.nativeStats,
          renderInfo: native.renderInfo,
          regions: [],
          objects: [],
          parseStatus: 'NATIVE_PARSED',
        });
      }

      logs.push(
        this.createLog(
          taskId,
          TaskStage.NATIVE_PARSING,
          'PdfJsAdapter',
          'preflightPages',
          'OK',
          `PDF.js 原生预检完成：共 ${pdfHandle.pageCount} 页，已提取 MediaBox/CropBox、文本变换、矢量操作数与页面渲染图`,
          { engineId: 'pdfjs-native' }
        )
      );

      const document: DocumentIR = {
        schemaVersion: DOCUMENT_IR_SCHEMA_VERSION,
        documentId,
        sourceFileName: file.name,
        fileSizeBytes: file.size,
        fileHash,
        fileType: 'pdf',
        mimeType: file.type || 'application/pdf',
        languageHints: sourceLanguage === 'auto' ? [] : [sourceLanguage],
        pageCount: pdfHandle.pageCount,
        createdAt: now,
        updatedAt: now,
        status: 'IMPORTED',
        metadata: {
          title: pdfHandle.metadata.title || file.name,
          author: pdfHandle.metadata.author,
          pdfVersion: pdfHandle.metadata.pdfVersion,
          inferredDomain: domainHint,
        },
        pages,
        evidences: {},
        relations: [],
      };

      const task: ProcessingTask = {
        taskId,
        documentId,
        fileName: file.name,
        createdAt: now,
        updatedAt: now,
        sourceLanguage,
        targetLanguage,
        domainHint,
        currentStage: TaskStage.IDLE,
        completedPages: 0,
        totalPages: pdfHandle.pageCount,
        completedWorkItems: 0,
        totalWorkItems: pdfHandle.pageCount * 2, // Parse + Translate per page
        status: 'CREATED',
        errorCount: 0,
        needsReviewCount: 0,
        logs,
      };

      return { document, task, fileBuffer: buffer, pdfHandle };
    } else {
      // Image file import
      const pageId = `${documentId}_p1`;
      const native = await pdfJsAdapter.renderImageFileToPage(
        buffer,
        file.type || 'image/png',
        pageId
      );
      const page: PageIR = {
        pageId,
        documentId,
        pageIndex: 0,
        widthPt: native.widthPt,
        heightPt: native.heightPt,
        rotation: 0,
        mediaBox: native.mediaBox,
        cropBox: native.cropBox,
        tags: native.tags,
        nativeStats: native.nativeStats,
        renderInfo: native.renderInfo,
        regions: [],
        objects: [],
        parseStatus: 'NATIVE_PARSED',
      };

      const document: DocumentIR = {
        schemaVersion: DOCUMENT_IR_SCHEMA_VERSION,
        documentId,
        sourceFileName: file.name,
        fileSizeBytes: file.size,
        fileHash,
        fileType: 'image',
        mimeType: file.type || 'image/png',
        languageHints: sourceLanguage === 'auto' ? [] : [sourceLanguage],
        pageCount: 1,
        createdAt: now,
        updatedAt: now,
        status: 'IMPORTED',
        metadata: {
          title: file.name,
          inferredDomain: domainHint,
        },
        pages: [page],
        evidences: {},
        relations: [],
      };

      const task: ProcessingTask = {
        taskId,
        documentId,
        fileName: file.name,
        createdAt: now,
        updatedAt: now,
        sourceLanguage,
        targetLanguage,
        domainHint,
        currentStage: TaskStage.IDLE,
        completedPages: 0,
        totalPages: 1,
        completedWorkItems: 0,
        totalWorkItems: 2,
        status: 'CREATED',
        errorCount: 0,
        needsReviewCount: 0,
        logs,
      };

      return { document, task, fileBuffer: buffer };
    }
  },

  async processSinglePage(
    doc: DocumentIR,
    task: ProcessingTask,
    pageIndex: number,
    terminology: TerminologyEntry[],
    pdfHandle?: LoadedPdfHandle,
    forceRetranslate = false
  ): Promise<{ page: PageIR; newEvidences: Record<string, EvidenceIR>; logs: TaskLogEntry[] }> {
    const page = doc.pages[pageIndex];
    if (!page) {
      throw new Error(`页面索引 ${pageIndex} 不存在`);
    }

    const logs: TaskLogEntry[] = [];
    const newEvidences: Record<string, EvidenceIR> = {};

    // Keep any user-approved/edited objects unless forceRetranslate is requested
    const approvedExisting = forceRetranslate
      ? []
      : page.objects.filter(
          (o) => o.review.reviewStatus === 'APPROVED' || o.review.reviewStatus === 'EDITED'
        );

    // 1. Gather native text fragments if PDF handle is available
    let nativeFragments: NativeTextFragment[] = [];
    if (doc.fileType === 'pdf' && pdfHandle) {
      const native = await pdfJsAdapter.extractAndRenderPage(
        pdfHandle.proxy,
        pageIndex,
        page.pageId,
        1.6
      );
      nativeFragments = native.textFragments;
      page.nativeStats = native.nativeStats;
      page.tags = native.tags;
      page.renderInfo = native.renderInfo;
    }

    const previewUrl = page.renderInfo.previewDataUrl;
    if (!previewUrl) {
      throw new Error(`第 ${pageIndex + 1} 页缺少渲染预览图，无法执行视觉分析。`);
    }

    // 2. Call Gemini Multimodal Vision Layout & Extraction
    const visionResp = await geminiAdapter.analyzePage({
      pageIndex,
      imageBase64: previewUrl,
      mimeType: 'image/jpeg',
      pageWidthPt: page.widthPt,
      pageHeightPt: page.heightPt,
      sourceLanguage: task.sourceLanguage,
      domainHint: task.domainHint,
      nativeHints: {
        textSampleCount: page.nativeStats.textItemCount,
        vectorLineCount: page.nativeStats.vectorLineCount,
        imageCount: page.nativeStats.imageCount,
        nativeTextSnippets: nativeFragments.slice(0, 15).map((f) => f.text),
      },
    });

    logs.push(
      this.createLog(
        task.taskId,
        TaskStage.VISION_ANALYZING,
        'GeminiVisionAdapter',
        'analyzePage',
        'OK',
        `第 ${pageIndex + 1} 页视觉版面分析完成，识别 ${visionResp.result.objects.length} 个候选对象`,
        {
          engineId: 'gemini-vision-layout',
          pageIndex,
          durationMs: visionResp.durationMs,
        }
      )
    );

    if (visionResp.result.detectedLanguage && !doc.metadata.detectedLanguage) {
      doc.metadata.detectedLanguage = visionResp.result.detectedLanguage;
    }

    const objects: DocumentObjectIR[] = [...approvedExisting];
    const regions: RegionIR[] = [];

    // 3. Fuse native PDF evidence + Gemini Vision objects -> Document IR
    const sortedRaw = [...visionResp.result.objects].sort(
      (a, b) => (a.readingOrder ?? 0) - (b.readingOrder ?? 0)
    );

    const isVisualDiagramType = (t: ObjectType) =>
      t === ObjectType.CAD_DRAWING ||
      t === ObjectType.CHART ||
      t === ObjectType.PLOT ||
      t === ObjectType.DIAGRAM ||
      t === ObjectType.FLOWCHART ||
      t === ObjectType.IMAGE;

    for (let idx = 0; idx < sortedRaw.length; idx++) {
      const item: GeminiAnalyzedObject = sortedRaw[idx];
      const objectType = mapObjectType(item.objectType);
      const regionType = mapRegionType(objectType);
      let rawNorm =
        item.bboxNormalized && item.bboxNormalized.length === 4
          ? [...item.bboxNormalized]
          : [0, 0, 1000, 1000];

      // Prevent clipping outer axis labels, ticks, or scale text on visual drawings/charts
      if (isVisualDiagramType(objectType)) {
        const wSpan = rawNorm[3] - rawNorm[1];
        const hSpan = rawNorm[2] - rawNorm[0];
        if (doc.fileType === 'image' && (wSpan >= 520 || hSpan >= 450)) {
          // For uploaded standalone engineering figures/charts, preserve 100% unclipped canvas
          rawNorm = [0, 0, 1000, 1000];
        } else {
          // Pad outward safely by 2.5% so axis labels on borders are never shaved off
          rawNorm = [
            Math.max(0, rawNorm[0] - 25),
            Math.max(0, rawNorm[1] - 25),
            Math.min(1000, rawNorm[2] + 25),
            Math.min(1000, rawNorm[3] + 25),
          ];
        }
      }

      const bboxPage = normalizedEngineToPageSpace(
        rawNorm as [number, number, number, number],
        page.widthPt,
        page.heightPt
      );

      // Skip duplicates that heavily overlap user-approved objects
      const alreadyApproved = approvedExisting.some((ap) => {
        const ix1 = Math.max(ap.bbox.x1, bboxPage.x1);
        const iy1 = Math.max(ap.bbox.y1, bboxPage.y1);
        const ix2 = Math.min(ap.bbox.x2, bboxPage.x2);
        const iy2 = Math.min(ap.bbox.y2, bboxPage.y2);
        const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
        const area = Math.max(1, bboxPage.width * bboxPage.height);
        return inter / area > 0.65;
      });
      if (alreadyApproved) continue;

      const objectId = `${page.pageId}_obj_${idx + 1}_${crypto.randomUUID().slice(0, 4)}`;
      const regionId = `${page.pageId}_reg_${idx + 1}`;
      const evidenceId = `ev_${objectId}`;

      // Check native PDF text inside this bounding box
      const nativeText =
        nativeFragments.length > 0 ? collectNativeTextInsideBbox(nativeFragments, bboxPage) : '';

      const useNativePrimary =
        nativeText.length > 0 &&
        objectType !== ObjectType.FORMULA &&
        objectType !== ObjectType.TABLE &&
        objectType !== ObjectType.CHART &&
        objectType !== ObjectType.CAD_DRAWING;

      const resolvedRawText = useNativePrimary
        ? nativeText
        : item.rawText?.trim() || nativeText || '';

      const sourceType = useNativePrimary
        ? 'HYBRID'
        : doc.fileType === 'image'
          ? 'IMAGE_UPLOAD'
          : 'GEMINI_VISION';

      const sourceReference = useNativePrimary
        ? 'PDF.js 原生文本坐标融合 + Gemini 版面定位'
        : 'Gemini 多模态视觉识别';

      // Preserve visual crop evidence for non-trivial objects
      const needsCrop =
        objectType === ObjectType.FORMULA ||
        objectType === ObjectType.CHART ||
        objectType === ObjectType.PLOT ||
        objectType === ObjectType.TABLE ||
        objectType === ObjectType.CAD_DRAWING ||
        objectType === ObjectType.DIAGRAM ||
        objectType === ObjectType.FLOWCHART ||
        objectType === ObjectType.IMAGE;

      const rawImageDataUrl = needsCrop
        ? await pdfJsAdapter.cropRegionDataUrl(previewUrl, bboxPage, page.widthPt, page.heightPt)
        : undefined;

      const confidence =
        typeof item.confidence === 'number' && !Number.isNaN(item.confidence)
          ? Math.max(0, Math.min(1, item.confidence))
          : null;

      const needsReview =
        Boolean(item.needsReview) ||
        (confidence !== null && confidence < 0.72) ||
        objectType === ObjectType.FORMULA ||
        objectType === ObjectType.CHART ||
        objectType === ObjectType.CAD_DRAWING;

      const strategy = chooseStrategy(objectType, confidence, needsReview);

      const evidence: EvidenceIR = {
        evidenceId,
        sourceFile: doc.sourceFileName,
        pageIndex,
        bbox: bboxPage,
        rawContent: resolvedRawText || item.latex || '[Visual Region]',
        engineId: useNativePrimary ? 'pdfjs-native+gemini-vision-layout' : 'gemini-vision-layout',
        engineVersion: visionResp.model,
        parameters: {
          nativeTextMatched: Boolean(nativeText),
          normalizedBbox: item.bboxNormalized,
        },
        timestamp: new Date().toISOString(),
      };
      newEvidences[evidenceId] = evidence;

      const docObj: DocumentObjectIR = {
        objectId,
        pageId: page.pageId,
        pageIndex,
        objectType,
        regionType,
        readingOrder: item.readingOrder ?? idx + 1,
        bbox: bboxPage,
        sourceType,
        sourceReference,
        confidence,
        status: needsReview ? ObjectStatus.NEEDS_REVIEW : ObjectStatus.STRUCTURED,
        strategy,
        rawText: resolvedRawText,
        rawImageDataUrl,
        formulaData:
          objectType === ObjectType.FORMULA
            ? {
                latex: item.latex || resolvedRawText || '',
                displayMode: 'block',
                rawImageRef: evidenceId,
              }
            : undefined,
        tableData:
          objectType === ObjectType.TABLE
            ? {
                headers: item.tableHeaders || [],
                rows: item.tableRows || [],
              }
            : undefined,
        chartData:
          objectType === ObjectType.CHART || objectType === ObjectType.PLOT
            ? {
                chartType: item.chartType || 'UNKNOWN',
                title: item.chartTitle,
                xAxisLabel: item.xAxisLabel,
                yAxisLabel: item.yAxisLabel,
                legendItems: item.legendItems || [],
                extractionMethod: 'MODEL_ESTIMATED',
                note:
                  item.chartNote ||
                  '视觉模型语义解析结果（非原生矢量精确采样），已保留原始图表图像供核验。',
              }
            : undefined,
        cadData:
          objectType === ObjectType.CAD_DRAWING ||
          objectType === ObjectType.DIAGRAM ||
          objectType === ObjectType.FLOWCHART
            ? {
                peripheralLabels: item.peripheralLabels || [],
                vectorOpCount: page.nativeStats.vectorOpCount,
                geometryPreserved: true,
              }
            : undefined,
        elements: [],
        evidenceIds: [evidenceId],
        needsReviewReason:
          item.reviewReason ||
          (objectType === ObjectType.FORMULA
            ? '数学公式需对照原图核验上下标与符号'
            : objectType === ObjectType.CHART
              ? '图表坐标/图例为视觉估读，建议人工对照原图'
              : objectType === ObjectType.CAD_DRAWING
                ? '工程图已按 C 策略保留原始图形，仅处理外围标注'
                : undefined),
        qualityWarnings: [],
        review: {
          reviewStatus: needsReview ? 'NEEDS_REVIEW' : 'UNREVIEWED',
          reviewer: 'system',
          reviewedAt: new Date().toISOString(),
        },
      };

      objects.push(docObj);
      regions.push({
        regionId,
        pageId: page.pageId,
        regionType,
        bbox: bboxPage,
        readingOrder: docObj.readingOrder,
        objectIds: [objectId],
      });
    }

    // Remove redundant TABLE objects subsumed inside a visual diagram (e.g. attached bottom profile band)
    const diagramBoxes = objects
      .filter(
        (o) =>
          o.objectType === ObjectType.CAD_DRAWING ||
          o.objectType === ObjectType.CHART ||
          o.objectType === ObjectType.PLOT ||
          o.objectType === ObjectType.DIAGRAM ||
          o.objectType === ObjectType.FLOWCHART
      )
      .map((o) => o.bbox);

    if (diagramBoxes.length > 0) {
      const droppedTableIds = new Set<string>();
      for (const obj of objects) {
        if (obj.objectType !== ObjectType.TABLE) continue;
        const tArea = Math.max(1, obj.bbox.width * obj.bbox.height);
        const subsumed = diagramBoxes.some((db) => {
          const ix1 = Math.max(db.x1, obj.bbox.x1);
          const iy1 = Math.max(db.y1, obj.bbox.y1);
          const ix2 = Math.min(db.x2, obj.bbox.x2);
          const iy2 = Math.min(db.y2, obj.bbox.y2);
          const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
          return inter / tArea >= 0.55;
        });
        if (subsumed) {
          droppedTableIds.add(obj.objectId);
        }
      }
      if (droppedTableIds.size > 0) {
        for (let i = objects.length - 1; i >= 0; i--) {
          if (droppedTableIds.has(objects[i].objectId)) {
            objects.splice(i, 1);
          }
        }
        for (let i = regions.length - 1; i >= 0; i--) {
          if (regions[i].objectIds.some((id) => droppedTableIds.has(id))) {
            regions.splice(i, 1);
          }
        }
      }
    }

    // 4. Build Translation Units (Text, Tables, Charts, CAD labels) with deterministic ProtectionService
    interface PendingTranslationUnit {
      unitId: string;
      objectId: string;
      kind: 'MAIN_TEXT' | 'TABLE_HEADER' | 'TABLE_CELL' | 'CHART_META' | 'CAD_LABEL';
      rowIdx?: number;
      colIdx?: number;
      labelIdx?: number;
      fieldKey?: 'title' | 'xAxisLabel' | 'yAxisLabel';
      tokens: ReturnType<typeof protectionService.protect>['tokens'];
      payload: {
        id: string;
        objectType: string;
        protectedText: string;
        contextBefore?: string;
        contextAfter?: string;
        sectionHeading?: string;
      };
    }

    const pendingUnits: PendingTranslationUnit[] = [];
    let currentHeading = doc.metadata.title || '';

    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      if (!forceRetranslate && obj.review.reviewStatus === 'APPROVED' && obj.translatedText) continue;
      if (obj.objectType === ObjectType.HEADING && obj.rawText) {
        currentHeading = obj.rawText;
      }

      if (
        obj.rawText.trim() &&
        obj.objectType !== ObjectType.IMAGE &&
        obj.objectType !== ObjectType.PAGE_NUMBER &&
        obj.objectType !== ObjectType.FORMULA
      ) {
        const prot = protectionService.protect(obj.rawText);
        const unitId = `${obj.objectId}_main`;
        pendingUnits.push({
          unitId,
          objectId: obj.objectId,
          kind: 'MAIN_TEXT',
          tokens: prot.tokens,
          payload: {
            id: unitId,
            objectType: obj.objectType,
            protectedText: prot.protectedText,
            contextBefore: i > 0 ? objects[i - 1].rawText.slice(0, 120) : undefined,
            contextAfter: i < objects.length - 1 ? objects[i + 1].rawText.slice(0, 120) : undefined,
            sectionHeading: currentHeading,
          },
        });
      }

      if (obj.tableData) {
        obj.tableData.headers.forEach((h, colIdx) => {
          if (!h.trim()) return;
          const prot = protectionService.protect(h);
          const unitId = `${obj.objectId}_th_${colIdx}`;
          pendingUnits.push({
            unitId,
            objectId: obj.objectId,
            kind: 'TABLE_HEADER',
            colIdx,
            tokens: prot.tokens,
            payload: {
              id: unitId,
              objectType: 'TABLE_HEADER',
              protectedText: prot.protectedText,
              sectionHeading: currentHeading,
            },
          });
        });

        obj.tableData.rows.forEach((row, rowIdx) => {
          row.forEach((cell, colIdx) => {
            if (!cell.trim()) return;
            // Skip pure numbers from needing LLM translation
            if (/^[±+\-]?\d+(?:[.,]\d+)?(?:\s*%|\s*mm|\s*kV|\s*MPa)?$/i.test(cell.trim())) {
              return;
            }
            const prot = protectionService.protect(cell);
            const unitId = `${obj.objectId}_td_${rowIdx}_${colIdx}`;
            pendingUnits.push({
              unitId,
              objectId: obj.objectId,
              kind: 'TABLE_CELL',
              rowIdx,
              colIdx,
              tokens: prot.tokens,
              payload: {
                id: unitId,
                objectType: 'TABLE_CELL',
                protectedText: prot.protectedText,
                sectionHeading: currentHeading,
              },
            });
          });
        });
      }

      if (obj.chartData) {
        (['title', 'xAxisLabel', 'yAxisLabel'] as const).forEach((fk) => {
          const val = obj.chartData?.[fk];
          if (!val || !val.trim()) return;
          const prot = protectionService.protect(val);
          const unitId = `${obj.objectId}_chart_${fk}`;
          pendingUnits.push({
            unitId,
            objectId: obj.objectId,
            kind: 'CHART_META',
            fieldKey: fk,
            tokens: prot.tokens,
            payload: {
              id: unitId,
              objectType: 'CHART_LABEL',
              protectedText: prot.protectedText,
              sectionHeading: currentHeading,
            },
          });
        });
      }

      if (obj.cadData?.peripheralLabels?.length) {
        obj.cadData.peripheralLabels.forEach((lbl, lIdx) => {
          if (!lbl.trim()) return;
          const prot = protectionService.protect(lbl);
          const unitId = `${obj.objectId}_cad_${lIdx}`;
          pendingUnits.push({
            unitId,
            objectId: obj.objectId,
            kind: 'CAD_LABEL',
            labelIdx: lIdx,
            tokens: prot.tokens,
            payload: {
              id: unitId,
              objectType: 'CAD_ANNOTATION',
              protectedText: prot.protectedText,
              sectionHeading: currentHeading,
            },
          });
        });
      }
    }

    if (pendingUnits.length > 0) {
      // Translate in chunks of up to 35 units to stay bounded and reliable
      const CHUNK_SIZE = 35;
      const objMap = new Map(objects.map((o) => [o.objectId, o]));

      // Pre-initialize translated table matrices and CAD label arrays
      for (const obj of objects) {
        if (obj.tableData) {
          obj.tableData.translatedHeaders = [...obj.tableData.headers];
          obj.tableData.translatedRows = obj.tableData.rows.map((r) => [...r]);
        }
        if (obj.cadData) {
          obj.cadData.translatedPeripheralLabels = [...obj.cadData.peripheralLabels];
        }
      }

      for (let start = 0; start < pendingUnits.length; start += CHUNK_SIZE) {
        const slice = pendingUnits.slice(start, start + CHUNK_SIZE);
        const trResp = await geminiAdapter.translateUnits({
          units: slice.map((u) => u.payload),
          sourceLanguage: task.sourceLanguage,
          targetLanguage: task.targetLanguage,
          documentContext: {
            title: doc.metadata.title || doc.sourceFileName,
            domain: doc.metadata.inferredDomain || task.domainHint,
            standardSystem: doc.metadata.inferredStandardSystem,
            summary: visionResp.result.pageSummary,
          },
          terminology: terminology.map((t) => ({
            sourceTerm: t.sourceTerm,
            targetTerm: t.targetTerm,
            domain: t.domain,
            preferred: t.preferred,
          })),
        });

        if (trResp.result.inferredDomain) {
          doc.metadata.inferredDomain = trResp.result.inferredDomain;
        }
        if (trResp.result.inferredStandardSystem) {
          doc.metadata.inferredStandardSystem = trResp.result.inferredStandardSystem;
        }

        const sliceMap = new Map(slice.map((u) => [u.unitId, u]));
        for (const tr of trResp.result.translations) {
          const meta = sliceMap.get(tr.id);
          if (!meta) continue;
          const obj = objMap.get(meta.objectId);
          if (!obj) continue;

          const restored = protectionService.restore(tr.targetText, meta.tokens);
          if (restored.missingTokens.length > 0) {
            obj.qualityWarnings.push(
              `保护片段未完整保留：${restored.missingTokens.map((m) => m.original).join(', ')}`
            );
            obj.status = ObjectStatus.NEEDS_REVIEW;
            obj.review.reviewStatus = 'NEEDS_REVIEW';
          }
          if (tr.riskFlags && tr.riskFlags.length > 0) {
            obj.qualityWarnings.push(...tr.riskFlags);
            obj.status = ObjectStatus.NEEDS_REVIEW;
          }

          if (meta.kind === 'MAIN_TEXT') {
            obj.translatedText = restored.restoredText;
            if (obj.status !== ObjectStatus.NEEDS_REVIEW) {
              obj.status = ObjectStatus.TRANSLATED;
            }
          } else if (meta.kind === 'TABLE_HEADER' && obj.tableData?.translatedHeaders && meta.colIdx !== undefined) {
            obj.tableData.translatedHeaders[meta.colIdx] = restored.restoredText;
          } else if (
            meta.kind === 'TABLE_CELL' &&
            obj.tableData?.translatedRows &&
            meta.rowIdx !== undefined &&
            meta.colIdx !== undefined
          ) {
            obj.tableData.translatedRows[meta.rowIdx][meta.colIdx] = restored.restoredText;
          } else if (meta.kind === 'CHART_META' && obj.chartData && meta.fieldKey) {
            if (meta.fieldKey === 'title') obj.chartData.translatedTitle = restored.restoredText;
            if (meta.fieldKey === 'xAxisLabel') obj.chartData.translatedXAxisLabel = restored.restoredText;
            if (meta.fieldKey === 'yAxisLabel') obj.chartData.translatedYAxisLabel = restored.restoredText;
          } else if (
            meta.kind === 'CAD_LABEL' &&
            obj.cadData?.translatedPeripheralLabels &&
            meta.labelIdx !== undefined
          ) {
            obj.cadData.translatedPeripheralLabels[meta.labelIdx] = restored.restoredText;
          }
        }

        logs.push(
          this.createLog(
            task.taskId,
            TaskStage.TRANSLATING,
            'GeminiTranslator',
            'translateUnits',
            'OK',
            `第 ${pageIndex + 1} 页完成 ${slice.length} 个翻译单元专业翻译`,
            {
              engineId: 'gemini-translator',
              pageIndex,
              durationMs: trResp.durationMs,
            }
          )
        );
      }
    }

    // 5. In-Place Chart/Diagram Text Translation & Visual Reconstruction
    for (const obj of objects) {
      const shouldReconstructVisual =
        Boolean(obj.rawImageDataUrl) &&
        (obj.objectType === ObjectType.CAD_DRAWING ||
          obj.objectType === ObjectType.CHART ||
          obj.objectType === ObjectType.PLOT ||
          obj.objectType === ObjectType.DIAGRAM ||
          obj.objectType === ObjectType.FLOWCHART ||
          obj.objectType === ObjectType.IMAGE);

      if (!shouldReconstructVisual || !obj.rawImageDataUrl) continue;

      try {
        const recResp = await geminiAdapter.reconstructDiagram({
          imageBase64: obj.rawImageDataUrl,
          mimeType: 'image/jpeg',
          sourceLanguage: task.sourceLanguage,
          targetLanguage: task.targetLanguage,
          domainHint: doc.metadata.inferredDomain || task.domainHint,
          terminology: terminology.map((t) => ({
            sourceTerm: t.sourceTerm,
            targetTerm: t.targetTerm,
          })),
        });

        if (recResp.diagramSpec) {
          const rebuiltUrl = await diagramReconstructor.reconstructFromSpec(recResp.diagramSpec);
          if (rebuiltUrl) {
            obj.diagramSpec = recResp.diagramSpec;
            obj.diagramOverlays = recResp.overlays;
            obj.reconstructedImageDataUrl = rebuiltUrl;
            obj.status = ObjectStatus.RECONSTRUCTED;

            if (obj.cadData) {
              obj.cadData.peripheralLabels = recResp.overlays.map((o) => o.sourceText);
              obj.cadData.translatedPeripheralLabels = recResp.overlays.map((o) => o.translatedText);
            }
            if (obj.chartData && recResp.diagramTitle) {
              obj.chartData.translatedTitle = recResp.diagramTitle;
            }
            if (!obj.translatedText && recResp.diagramSummary) {
              obj.translatedText = recResp.diagramSummary;
            }

            logs.push(
              this.createLog(
                task.taskId,
                TaskStage.TRANSLATING,
                'DiagramReconstructor',
                'reconstructDiagram',
                'OK',
                `第 ${pageIndex + 1} 页图表 [${obj.objectType}] 已按 ${recResp.diagramSpec.kind} 结构完成全图译文重绘（含 ${recResp.overlays.length} 处文字）`,
                {
                  engineId: 'gemini-vision-layout',
                  pageIndex,
                  durationMs: recResp.durationMs,
                }
              )
            );
          }
        }
      } catch (recErr) {
        logs.push(
          this.createLog(
            task.taskId,
            TaskStage.TRANSLATING,
            'DiagramReconstructor',
            'reconstructDiagram',
            'WARN',
            `第 ${pageIndex + 1} 页图表原位重建失败，已保留高清原图：${recErr instanceof Error ? recErr.message : String(recErr)}`,
            { pageIndex }
          )
        );
      }
    }

    const updatedPage: PageIR = {
      ...page,
      regions,
      objects,
      parseStatus: 'TRANSLATED',
      errorMessage: undefined,
    };

    return { page: updatedPage, newEvidences, logs };
  },

  async deepVerifyObject(
    doc: DocumentIR,
    pageIndex: number,
    objectId: string,
    sourceLanguage: string
  ): Promise<DocumentObjectIR> {
    const page = doc.pages[pageIndex];
    if (!page) throw new Error('页面不存在');
    const targetObj = page.objects.find((o) => o.objectId === objectId);
    if (!targetObj) throw new Error('对象不存在');

    const cropUrl =
      targetObj.rawImageDataUrl ||
      (page.renderInfo.previewDataUrl
        ? await pdfJsAdapter.cropRegionDataUrl(
            page.renderInfo.previewDataUrl,
            targetObj.bbox,
            page.widthPt,
            page.heightPt
          )
        : undefined);

    if (!cropUrl) {
      throw new Error('无法获取该对象的局部图像，无法执行局部视觉重识别');
    }

    const resp = await geminiAdapter.verifyRegion({
      objectType: targetObj.objectType,
      imageBase64: cropUrl,
      mimeType: 'image/png',
      existingText: targetObj.rawText || targetObj.formulaData?.latex,
      sourceLanguage,
    });

    const updated: DocumentObjectIR = {
      ...targetObj,
      rawImageDataUrl: cropUrl,
      rawText: resp.result.rawText?.trim() || targetObj.rawText,
      confidence:
        typeof resp.result.confidence === 'number' ? resp.result.confidence : targetObj.confidence,
      needsReviewReason: resp.result.reviewReason || targetObj.needsReviewReason,
      status: resp.result.needsReview ? ObjectStatus.NEEDS_REVIEW : ObjectStatus.EXTRACTED,
    };

    if (updated.objectType === ObjectType.FORMULA && resp.result.latex) {
      updated.formulaData = {
        latex: resp.result.latex,
        displayMode: updated.formulaData?.displayMode || 'block',
        rawImageRef: updated.formulaData?.rawImageRef,
      };
    }

    if (
      updated.objectType === ObjectType.TABLE &&
      (resp.result.tableHeaders?.length || resp.result.tableRows?.length)
    ) {
      updated.tableData = {
        ...updated.tableData,
        headers: resp.result.tableHeaders || updated.tableData?.headers || [],
        rows: resp.result.tableRows || updated.tableData?.rows || [],
      };
    }

    if (
      (updated.objectType === ObjectType.CHART || updated.objectType === ObjectType.PLOT) &&
      resp.result.chartMeta
    ) {
      updated.chartData = {
        chartType: updated.chartData?.chartType || 'UNKNOWN',
        title: resp.result.chartMeta.title || updated.chartData?.title,
        xAxisLabel: resp.result.chartMeta.xAxis || updated.chartData?.xAxisLabel,
        yAxisLabel: resp.result.chartMeta.yAxis || updated.chartData?.yAxisLabel,
        legendItems: resp.result.chartMeta.legends || updated.chartData?.legendItems || [],
        extractionMethod: 'MODEL_ESTIMATED',
        note: resp.result.chartMeta.notes || updated.chartData?.note || '局部视觉复核更新',
      };
    }

    if (resp.result.peripheralLabels?.length && updated.cadData) {
      updated.cadData = {
        ...updated.cadData,
        peripheralLabels: resp.result.peripheralLabels,
      };
    }

    return updated;
  },

  async translateSingleObject(
    doc: DocumentIR,
    task: { sourceLanguage: string; targetLanguage: string; domainHint?: string },
    targetObj: DocumentObjectIR,
    terminology: TerminologyEntry[]
  ): Promise<DocumentObjectIR> {
    const sourceText = targetObj.rawText?.trim();
    if (!sourceText) {
      throw new Error('该对象暂无可翻译的原文文本。');
    }

    const prot = protectionService.protect(sourceText);
    const unitId = `${targetObj.objectId}_single`;

    const trResp = await geminiAdapter.translateUnits({
      units: [
        {
          id: unitId,
          objectType: targetObj.objectType,
          protectedText: prot.protectedText,
        },
      ],
      sourceLanguage: task.sourceLanguage,
      targetLanguage: task.targetLanguage,
      documentContext: {
        title: doc.metadata.title || doc.sourceFileName,
        domain: doc.metadata.inferredDomain || task.domainHint,
        standardSystem: doc.metadata.inferredStandardSystem,
      },
      terminology: terminology.map((t) => ({
        sourceTerm: t.sourceTerm,
        targetTerm: t.targetTerm,
        domain: t.domain,
        preferred: t.preferred,
      })),
    });

    const tr = trResp.result.translations.find((t) => t.id === unitId) || trResp.result.translations[0];
    if (!tr) {
      throw new Error('翻译接口未返回有效的译文结果。');
    }

    const restored = protectionService.restore(tr.targetText, prot.tokens);
    const nextWarnings = [...targetObj.qualityWarnings];
    let nextStatus = ObjectStatus.TRANSLATED;
    let nextReviewStatus = targetObj.review.reviewStatus;

    if (restored.missingTokens.length > 0) {
      nextWarnings.push(
        `保护片段未完整保留：${restored.missingTokens.map((m) => m.original).join(', ')}`
      );
      nextStatus = ObjectStatus.NEEDS_REVIEW;
      nextReviewStatus = 'NEEDS_REVIEW';
    }
    if (tr.riskFlags && tr.riskFlags.length > 0) {
      nextWarnings.push(...tr.riskFlags);
      nextStatus = ObjectStatus.NEEDS_REVIEW;
    }

    return {
      ...targetObj,
      translatedText: restored.restoredText,
      status: nextStatus,
      qualityWarnings: nextWarnings,
      review: {
        ...targetObj.review,
        reviewStatus: nextReviewStatus,
        reviewedAt: new Date().toISOString(),
      },
    };
  },

  async rebuildDiagramFromOverlays(targetObj: DocumentObjectIR): Promise<DocumentObjectIR> {
    if (!targetObj.diagramSpec || !targetObj.diagramOverlays?.length) {
      return targetObj;
    }
    const nextSpec = applyOverlaysToSpec(targetObj.diagramSpec, targetObj.diagramOverlays);
    const rebuiltUrl = await diagramReconstructor.reconstructFromSpec(nextSpec);
    return {
      ...targetObj,
      diagramSpec: nextSpec,
      reconstructedImageDataUrl: rebuiltUrl || targetObj.reconstructedImageDataUrl,
      status: ObjectStatus.RECONSTRUCTED,
      review: {
        ...targetObj.review,
        reviewStatus: 'EDITED',
        reviewedAt: new Date().toISOString(),
      },
    };
  },

  refreshTaskMetrics(doc: DocumentIR, task: ProcessingTask): ProcessingTask {
    const q = qualityGateService.evaluateDocument(doc);
    const completedPages = doc.pages.filter((p) => p.parseStatus === 'TRANSLATED').length;
    const failedPages = doc.pages.filter((p) => p.parseStatus === 'FAILED').length;
    return {
      ...task,
      updatedAt: new Date().toISOString(),
      completedPages,
      totalPages: doc.pageCount,
      completedWorkItems: completedPages * 2,
      totalWorkItems: doc.pageCount * 2,
      needsReviewCount: q.needsReviewCount,
      errorCount: failedPages + q.errorCount,
    };
  },
};

export { createBbox, CoordinateSpace };
