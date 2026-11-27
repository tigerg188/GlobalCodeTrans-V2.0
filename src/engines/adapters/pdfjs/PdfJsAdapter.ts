import * as pdfjsLib from 'pdfjs-dist';
import {
  applyAffineToPoint,
  computePdfTextItemUserBbox,
  CoordinateSpace,
  createBbox,
  multiplyAffine,
  pdfUserToPageSpace,
  verifyViewportCoordinateAlignment,
  type AffineMatrix,
  type BoundingBox,
} from '../../../domain/geometry/CoordinateSpace';
import {
  ObjectType,
  PageTag,
  type ChartSeriesPoint,
  type DocumentElementIR,
  type PageNativeStats,
  type PageRenderInfo,
} from '../../../domain/document/DocumentIR';
import { EngineRuntimeState } from '../../../domain/task/TaskTypes';
import { engineRegistry } from '../../registry/EngineRegistry';

let workerConfigured = false;

function ensurePdfWorker(): void {
  if (workerConfigured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
  workerConfigured = true;
}

export interface NativeTextFragment {
  text: string;
  bboxPage: BoundingBox;
  fontName: string;
  fontSize: number;
}

export interface NativeOrganizedBlock {
  blockId: string;
  objectType:
    | ObjectType.HEADING
    | ObjectType.PARAGRAPH
    | ObjectType.LIST
    | ObjectType.HEADER
    | ObjectType.FOOTER
    | ObjectType.PAGE_NUMBER;
  rawText: string;
  bboxPage: BoundingBox;
  fontSize: number;
  fontName: string;
  lineCount: number;
  readingOrder: number;
  elements: DocumentElementIR[];
}

export interface VectorSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'line' | 'curve' | 'rect';
  lengthPt: number;
}

export interface VectorChartCalibrationResult {
  series: Array<{ name: string; points: ChartSeriesPoint[] }>;
  xAxisBbox?: BoundingBox;
  yAxisBbox?: BoundingBox;
  note: string;
}

export interface NativePageExtraction {
  pageIndex: number;
  widthPt: number;
  heightPt: number;
  rotation: number;
  mediaBox: [number, number, number, number];
  cropBox: [number, number, number, number];
  nativeStats: PageNativeStats;
  tags: PageTag[];
  textFragments: NativeTextFragment[];
  organizedBlocks: NativeOrganizedBlock[];
  vectorSegments: VectorSegment[];
  renderInfo: PageRenderInfo;
  elements: DocumentElementIR[];
}

export interface LoadedPdfHandle {
  pageCount: number;
  metadata: {
    title?: string;
    author?: string;
    pdfVersion?: string;
  };
  proxy: pdfjsLib.PDFDocumentProxy;
}

interface LineCluster {
  yMid: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  fontSize: number;
  fontName: string;
  text: string;
  fragments: NativeTextFragment[];
}

/**
 * Deterministic native PDF text line/column/paragraph organizer.
 * Groups PDF.js glyph fragments by baseline Y, splits multi-column lines on wide gutters,
 * groups lines into blocks by vertical spacing & font changes, and orders columns top-to-bottom.
 */
export function organizeNativeTextBlocks(
  fragments: NativeTextFragment[],
  pageWidthPt: number,
  pageHeightPt: number,
  pageId: string
): NativeOrganizedBlock[] {
  if (fragments.length === 0) return [];

  // 1. Estimate dominant body font size weighted by character count
  const sizeBuckets = new Map<number, number>();
  for (const f of fragments) {
    const rounded = Math.round(f.fontSize);
    sizeBuckets.set(rounded, (sizeBuckets.get(rounded) || 0) + f.text.trim().length);
  }
  let bodyFontSize = 10;
  let maxBucketWeight = -1;
  for (const [sz, weight] of sizeBuckets.entries()) {
    if (weight > maxBucketWeight) {
      maxBucketWeight = weight;
      bodyFontSize = sz;
    }
  }

  // 2. Sort fragments top-to-bottom, left-to-right to form horizontal line runs
  const sorted = [...fragments].sort((a, b) => {
    const dy = a.bboxPage.y1 - b.bboxPage.y1;
    if (Math.abs(dy) > Math.max(3, Math.min(a.fontSize, b.fontSize) * 0.45)) return dy;
    return a.bboxPage.x1 - b.bboxPage.x1;
  });

  const rows: NativeTextFragment[][] = [];
  for (const frag of sorted) {
    const fragYMid = (frag.bboxPage.y1 + frag.bboxPage.y2) / 2;
    const lastRow = rows[rows.length - 1];
    if (!lastRow) {
      rows.push([frag]);
      continue;
    }
    const rowYMid =
      lastRow.reduce((sum, f) => sum + (f.bboxPage.y1 + f.bboxPage.y2) / 2, 0) / lastRow.length;
    const avgFs =
      lastRow.reduce((sum, f) => sum + f.fontSize, 0) / lastRow.length;
    if (Math.abs(fragYMid - rowYMid) <= Math.max(4, Math.max(avgFs, frag.fontSize) * 0.52)) {
      lastRow.push(frag);
    } else {
      rows.push([frag]);
    }
  }

  // 3. Split wide column gaps within each row into separate LineClusters
  const lines: LineCluster[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.bboxPage.x1 - b.bboxPage.x1);
    const segments: NativeTextFragment[][] = [];
    for (const frag of row) {
      const prevSeg = segments[segments.length - 1];
      if (!prevSeg) {
        segments.push([frag]);
        continue;
      }
      const prevFrag = prevSeg[prevSeg.length - 1];
      const gapX = frag.bboxPage.x1 - prevFrag.bboxPage.x2;
      const colThreshold = Math.max(26, Math.max(prevFrag.fontSize, frag.fontSize) * 2.4);
      if (gapX > colThreshold) {
        segments.push([frag]);
      } else {
        prevSeg.push(frag);
      }
    }

    for (const seg of segments) {
      const text = seg.map((f) => f.text).join(' ').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const x1 = Math.min(...seg.map((f) => f.bboxPage.x1));
      const y1 = Math.min(...seg.map((f) => f.bboxPage.y1));
      const x2 = Math.max(...seg.map((f) => f.bboxPage.x2));
      const y2 = Math.max(...seg.map((f) => f.bboxPage.y2));
      const avgFs = seg.reduce((s, f) => s + f.fontSize, 0) / seg.length;
      lines.push({
        yMid: (y1 + y2) / 2,
        x1,
        y1,
        x2,
        y2,
        fontSize: avgFs,
        fontName: seg[0].fontName,
        text,
        fragments: seg,
      });
    }
  }

  // 4. Order lines by column-aware reading order:
  // Detect whether document has 2 distinct columns (left/right halves rarely crossed by wide lines)
  const midX = pageWidthPt / 2;
  const wideLines = lines.filter((l) => l.x1 < midX - 24 && l.x2 > midX + 24);
  const isTwoColumn = lines.length >= 10 && wideLines.length < lines.length * 0.2;

  const sortedLines = [...lines].sort((a, b) => {
    if (isTwoColumn) {
      const aCol = a.x2 <= midX + 12 ? 0 : a.x1 >= midX - 12 ? 1 : 2;
      const bCol = b.x2 <= midX + 12 ? 0 : b.x1 >= midX - 12 ? 1 : 2;
      if (aCol !== 2 && bCol !== 2 && aCol !== bCol) {
        return aCol - bCol;
      }
    }
    const dy = a.y1 - b.y1;
    if (Math.abs(dy) > 4) return dy;
    return a.x1 - b.x1;
  });

  // 5. Group adjacent compatible lines into paragraph / heading / list blocks
  const grouped: LineCluster[][] = [];
  for (const line of sortedLines) {
    const curGroup = grouped[grouped.length - 1];
    if (!curGroup) {
      grouped.push([line]);
      continue;
    }
    const prev = curGroup[curGroup.length - 1];
    const verticalGap = line.y1 - prev.y2;
    const maxGap = Math.max(8, Math.max(prev.fontSize, line.fontSize) * 1.15);
    const sameColumn =
      Math.abs(line.x1 - prev.x1) < Math.max(48, pageWidthPt * 0.14) ||
      (line.x1 <= prev.x2 && line.x2 >= prev.x1);
    const fontShift = Math.abs(line.fontSize - prev.fontSize) > 1.8;
    const isListStart = /^([•\-–*]|\d+[.)]|\(\d+\))\s+/.test(line.text);
    const prevIsHeading = prev.fontSize >= bodyFontSize * 1.18 && curGroup.length <= 2;

    if (
      verticalGap >= -4 &&
      verticalGap <= maxGap &&
      sameColumn &&
      !fontShift &&
      !isListStart &&
      !prevIsHeading
    ) {
      curGroup.push(line);
    } else {
      grouped.push([line]);
    }
  }

  // 6. Convert grouped lines into classified NativeOrganizedBlocks
  return grouped.map((grp, idx) => {
    const rawText = grp.map((l) => l.text).join('\n').trim();
    const x1 = Math.min(...grp.map((l) => l.x1));
    const y1 = Math.min(...grp.map((l) => l.y1));
    const x2 = Math.max(...grp.map((l) => l.x2));
    const y2 = Math.max(...grp.map((l) => l.y2));
    const avgFs = grp.reduce((s, l) => s + l.fontSize, 0) / grp.length;

    let objectType: NativeOrganizedBlock['objectType'] = ObjectType.PARAGRAPH;
    if (y2 <= pageHeightPt * 0.065) {
      objectType = /^\d{1,4}$/.test(rawText) ? ObjectType.PAGE_NUMBER : ObjectType.HEADER;
    } else if (y1 >= pageHeightPt * 0.93) {
      objectType = /^\d{1,4}$/.test(rawText) ? ObjectType.PAGE_NUMBER : ObjectType.FOOTER;
    } else if (avgFs >= bodyFontSize * 1.18 && grp.length <= 3 && rawText.length <= 160) {
      objectType = ObjectType.HEADING;
    } else if (/^([•\-–*]|\d+[.)]|\(\d+\))\s+/.test(rawText)) {
      objectType = ObjectType.LIST;
    }

    const elements: DocumentElementIR[] = grp.flatMap((l, lIdx) =>
      l.fragments.map((f, fIdx) => ({
        elementId: `${pageId}_blk_${idx + 1}_el_${lIdx}_${fIdx}`,
        objectId: '',
        elementType: 'NATIVE_TEXT_SPAN',
        text: f.text,
        fontName: f.fontName,
        fontSize: f.fontSize,
        bbox: f.bboxPage,
        sequence: lIdx * 100 + fIdx + 1,
      }))
    );

    return {
      blockId: `${pageId}_native_blk_${idx + 1}`,
      objectType,
      rawText,
      bboxPage: createBbox(x1, y1, x2, y2, CoordinateSpace.PDF_PAGE_SPACE),
      fontSize: Number(avgFs.toFixed(2)),
      fontName: grp[0].fontName,
      lineCount: grp.length,
      readingOrder: idx + 1,
      elements,
    };
  });
}

function extractVectorSegmentsFromOpList(
  opList: { fnArray: number[]; argsArray: unknown[] },
  viewportTransform: AffineMatrix
): { vectorOpCount: number; vectorLineCount: number; imageCount: number; segments: VectorSegment[] } {
  const OPS = pdfjsLib.OPS;
  let vectorOpCount = 0;
  let vectorLineCount = 0;
  let imageCount = 0;
  const segments: VectorSegment[] = [];

  const ctmStack: AffineMatrix[] = [];
  let ctm: AffineMatrix = [1, 0, 0, 1, 0, 0];
  let curX = 0;
  let curY = 0;
  let subStartX = 0;
  let subStartY = 0;

  const toPagePt = (ux: number, uy: number) => {
    const combined = multiplyAffine(viewportTransform, ctm);
    return applyAffineToPoint(combined, { x: ux, y: uy });
  };

  const pushSeg = (ux1: number, uy1: number, ux2: number, uy2: number, kind: VectorSegment['kind']) => {
    const p1 = toPagePt(ux1, uy1);
    const p2 = toPagePt(ux2, uy2);
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (len >= 1.5 && segments.length < 4000) {
      segments.push({
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        kind,
        lengthPt: Number(len.toFixed(2)),
      });
    }
  };

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    if (fn === OPS.save) {
      ctmStack.push([...ctm]);
    } else if (fn === OPS.restore) {
      const popped = ctmStack.pop();
      if (popped) ctm = popped;
    } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
      const m: AffineMatrix = [
        Number(args[0]) || 0,
        Number(args[1]) || 0,
        Number(args[2]) || 0,
        Number(args[3]) || 0,
        Number(args[4]) || 0,
        Number(args[5]) || 0,
      ];
      ctm = multiplyAffine(ctm, m);
    } else if (fn === OPS.constructPath && Array.isArray(args)) {
      vectorOpCount += 1;
      const opsArg = args[0] as number[] | undefined;
      const coordsArg = args[1] as number[] | undefined;
      if (Array.isArray(opsArg) && Array.isArray(coordsArg)) {
        vectorLineCount += opsArg.length;
        let ci = 0;
        for (const subOp of opsArg) {
          if (subOp === OPS.moveTo && ci + 1 < coordsArg.length) {
            curX = coordsArg[ci++];
            curY = coordsArg[ci++];
            subStartX = curX;
            subStartY = curY;
          } else if (subOp === OPS.lineTo && ci + 1 < coordsArg.length) {
            const nx = coordsArg[ci++];
            const ny = coordsArg[ci++];
            pushSeg(curX, curY, nx, ny, 'line');
            curX = nx;
            curY = ny;
          } else if (subOp === OPS.curveTo && ci + 5 < coordsArg.length) {
            ci += 4; // control points
            const nx = coordsArg[ci++];
            const ny = coordsArg[ci++];
            pushSeg(curX, curY, nx, ny, 'curve');
            curX = nx;
            curY = ny;
          } else if ((subOp === OPS.curveTo2 || subOp === OPS.curveTo3) && ci + 3 < coordsArg.length) {
            ci += 2;
            const nx = coordsArg[ci++];
            const ny = coordsArg[ci++];
            pushSeg(curX, curY, nx, ny, 'curve');
            curX = nx;
            curY = ny;
          } else if (subOp === OPS.rectangle && ci + 3 < coordsArg.length) {
            const rx = coordsArg[ci++];
            const ry = coordsArg[ci++];
            const rw = coordsArg[ci++];
            const rh = coordsArg[ci++];
            pushSeg(rx, ry, rx + rw, ry, 'rect');
            pushSeg(rx + rw, ry, rx + rw, ry + rh, 'rect');
            pushSeg(rx + rw, ry + rh, rx, ry + rh, 'rect');
            pushSeg(rx, ry + rh, rx, ry, 'rect');
            curX = rx;
            curY = ry;
          } else if (subOp === OPS.closePath) {
            pushSeg(curX, curY, subStartX, subStartY, 'line');
            curX = subStartX;
            curY = subStartY;
          }
        }
      }
    } else if (fn === OPS.moveTo && Array.isArray(args) && args.length >= 2) {
      vectorOpCount += 1;
      curX = Number(args[0]) || 0;
      curY = Number(args[1]) || 0;
      subStartX = curX;
      subStartY = curY;
    } else if (fn === OPS.lineTo && Array.isArray(args) && args.length >= 2) {
      vectorOpCount += 1;
      vectorLineCount += 1;
      const nx = Number(args[0]) || 0;
      const ny = Number(args[1]) || 0;
      pushSeg(curX, curY, nx, ny, 'line');
      curX = nx;
      curY = ny;
    } else if (fn === OPS.rectangle && Array.isArray(args) && args.length >= 4) {
      vectorOpCount += 1;
      vectorLineCount += 1;
      const rx = Number(args[0]) || 0;
      const ry = Number(args[1]) || 0;
      const rw = Number(args[2]) || 0;
      const rh = Number(args[3]) || 0;
      pushSeg(rx, ry, rx + rw, ry, 'rect');
      pushSeg(rx + rw, ry, rx + rw, ry + rh, 'rect');
      pushSeg(rx + rw, ry + rh, rx, ry + rh, 'rect');
      pushSeg(rx, ry + rh, rx, ry, 'rect');
    } else if (
      fn === OPS.curveTo ||
      fn === OPS.stroke ||
      fn === OPS.fill ||
      fn === OPS.eoFill
    ) {
      vectorOpCount += 1;
    } else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintImageMaskXObject ||
      fn === OPS.paintImageXObjectRepeat
    ) {
      imageCount += 1;
    }
  }

  return { vectorOpCount, vectorLineCount, imageCount, segments };
}

export const pdfJsAdapter = {
  async openPdf(buffer: ArrayBuffer): Promise<LoadedPdfHandle> {
    ensurePdfWorker();
    engineRegistry.markState('pdfjs-native', EngineRuntimeState.INSTALLED);
    engineRegistry.recordCallStart('pdfjs-native');
    const t0 = performance.now();

    try {
      const dataCopy = new Uint8Array(buffer.slice(0));
      const loadingTask = pdfjsLib.getDocument({ data: dataCopy });
      const proxy = await loadingTask.promise;
      engineRegistry.markState('pdfjs-native', EngineRuntimeState.LOADED);

      let title: string | undefined;
      let author: string | undefined;
      let pdfVersion: string | undefined;
      try {
        const meta = await proxy.getMetadata();
        const info = meta?.info as Record<string, unknown> | undefined;
        if (info) {
          title = typeof info.Title === 'string' && info.Title.trim() ? info.Title.trim() : undefined;
          author = typeof info.Author === 'string' && info.Author.trim() ? info.Author.trim() : undefined;
          pdfVersion =
            typeof info.PDFFormatVersion === 'string' ? info.PDFFormatVersion : undefined;
        }
      } catch {
        // Metadata is optional
      }

      engineRegistry.recordCallSuccess('pdfjs-native', Math.round(performance.now() - t0), true);
      return {
        pageCount: proxy.numPages,
        metadata: { title, author, pdfVersion },
        proxy,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      engineRegistry.recordCallError('pdfjs-native', Math.round(performance.now() - t0), msg);
      throw err;
    }
  },

  async renderPagePreviewDataUrl(
    proxy: pdfjsLib.PDFDocumentProxy,
    pageIndex: number,
    renderScale = 1.5
  ): Promise<{ previewDataUrl: string; pixelWidth: number; pixelHeight: number }> {
    const page = await proxy.getPage(pageIndex + 1);
    const renderViewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(renderViewport.width));
    canvas.height = Math.max(1, Math.floor(renderViewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('无法创建 Canvas 2D 渲染上下文。');
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport: renderViewport,
      canvas,
    }).promise;

    const previewDataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const pixelWidth = canvas.width;
    const pixelHeight = canvas.height;
    // Release temporary canvas backing store promptly
    canvas.width = 0;
    canvas.height = 0;
    return { previewDataUrl, pixelWidth, pixelHeight };
  },

  async extractAndRenderPage(
    proxy: pdfjsLib.PDFDocumentProxy,
    pageIndex: number,
    pageId: string,
    renderScale = 1.6,
    renderPreview = true
  ): Promise<NativePageExtraction> {
    engineRegistry.recordCallStart('pdfjs-native');
    engineRegistry.recordCallStart('geometry-affine');
    const t0 = performance.now();

    try {
      const page = await proxy.getPage(pageIndex + 1);
      const effectiveView = page.view as [number, number, number, number];
      const pageInfoRaw = (page as unknown as {
        _pageInfo?: { mediaBox?: number[]; cropBox?: number[]; view?: number[] };
      })._pageInfo;
      const rawMedia =
        pageInfoRaw?.mediaBox && pageInfoRaw.mediaBox.length === 4
          ? ([...pageInfoRaw.mediaBox] as [number, number, number, number])
          : ([...effectiveView] as [number, number, number, number]);
      const rawCrop =
        pageInfoRaw?.cropBox && pageInfoRaw.cropBox.length === 4
          ? ([...pageInfoRaw.cropBox] as [number, number, number, number])
          : ([...effectiveView] as [number, number, number, number]);
      const distinctCropBoxObserved = Boolean(
        pageInfoRaw?.mediaBox &&
          pageInfoRaw?.cropBox &&
          rawMedia.some((v, idx) => Math.abs(v - rawCrop[idx]) > 0.5)
      );

      const rotation = page.rotate || 0;
      const mediaBox = rawMedia;
      const cropBox: [number, number, number, number] = [
        effectiveView[0],
        effectiveView[1],
        effectiveView[2],
        effectiveView[3],
      ];

      const baseViewport = page.getViewport({ scale: 1 });
      const widthPt = baseViewport.width;
      const heightPt = baseViewport.height;
      const vpTransform = baseViewport.transform as AffineMatrix;

      // 1. Extract native text items using full 6-component transform matrix & independent viewport check
      const textContent = await page.getTextContent();
      const textFragments: NativeTextFragment[] = [];
      const elements: DocumentElementIR[] = [];
      let maxViewportErr = 0;

      let seq = 0;
      for (const item of textContent.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const rawTx = item.transform as number[];
        const tx: [number, number, number, number, number, number] = [
          rawTx[0] ?? 1,
          rawTx[1] ?? 0,
          rawTx[2] ?? 0,
          rawTx[3] ?? 1,
          rawTx[4] ?? 0,
          rawTx[5] ?? 0,
        ];
        const fontHeight = Math.max(4, Math.hypot(tx[2], tx[3]) || item.height || 10);
        const itemWidth = Math.max(1, item.width || fontHeight * item.str.length * 0.5);

        const userBbox = computePdfTextItemUserBbox(tx, itemWidth, fontHeight);
        const vpErr = verifyViewportCoordinateAlignment(
          userBbox,
          cropBox,
          rotation,
          vpTransform,
          1
        );
        if (vpErr > maxViewportErr) maxViewportErr = vpErr;

        const pageBbox = pdfUserToPageSpace(userBbox, cropBox, rotation);

        textFragments.push({
          text: item.str,
          bboxPage: pageBbox,
          fontName: item.fontName || 'unknown',
          fontSize: Number(fontHeight.toFixed(2)),
        });

        seq += 1;
        elements.push({
          elementId: `${pageId}_el_${seq}`,
          objectId: '',
          elementType: 'NATIVE_TEXT_SPAN',
          text: item.str,
          fontName: item.fontName,
          fontSize: Number(fontHeight.toFixed(2)),
          bbox: pageBbox,
          sequence: seq,
        });
      }

      const organizedBlocks = organizeNativeTextBlocks(textFragments, widthPt, heightPt, pageId);

      // 2. Inspect PDF operator list for real vector path segments (with CTM) & embedded images
      let vectorOpCount = 0;
      let vectorLineCount = 0;
      let imageCount = 0;
      let vectorSegments: VectorSegment[] = [];
      try {
        const opList = await page.getOperatorList();
        const extractedVec = extractVectorSegmentsFromOpList(opList, vpTransform);
        vectorOpCount = extractedVec.vectorOpCount;
        vectorLineCount = extractedVec.vectorLineCount;
        imageCount = extractedVec.imageCount;
        vectorSegments = extractedVec.segments;
      } catch {
        // Some PDFs restrict operator list inspection; keep zero without fabricating
      }

      // 3. Multi-label page classification based on real observed counts
      const tags: PageTag[] = [];
      if (textFragments.length >= 25) tags.push(PageTag.TEXT_HEAVY);
      if (imageCount > 0 && textFragments.length < 15) tags.push(PageTag.IMAGE_HEAVY);
      if (vectorOpCount >= 40) tags.push(PageTag.VECTOR_HEAVY);
      if (vectorLineCount >= 120 && textFragments.length < 80) tags.push(PageTag.DRAWING_HEAVY);
      if (tags.length > 1 || (textFragments.length > 0 && (imageCount > 0 || vectorOpCount > 15))) {
        tags.push(PageTag.MIXED);
      }
      if (tags.length === 0) {
        tags.push(imageCount > 0 ? PageTag.IMAGE_HEAVY : PageTag.TEXT_HEAVY);
      }

      // 4. Render page preview only when requested (supports lightweight native-only preflight)
      let renderInfo: PageRenderInfo = {
        renderScale,
        pixelWidth: Math.max(1, Math.floor(widthPt * renderScale)),
        pixelHeight: Math.max(1, Math.floor(heightPt * renderScale)),
      };
      if (renderPreview) {
        const rendered = await this.renderPagePreviewDataUrl(proxy, pageIndex, renderScale);
        renderInfo = {
          renderScale,
          pixelWidth: rendered.pixelWidth,
          pixelHeight: rendered.pixelHeight,
          previewDataUrl: rendered.previewDataUrl,
        };
      }

      const durationMs = Math.round(performance.now() - t0);
      engineRegistry.recordCallSuccess('geometry-affine', durationMs, true);
      engineRegistry.recordCallSuccess('pdfjs-native', durationMs, true);

      return {
        pageIndex,
        widthPt,
        heightPt,
        rotation,
        mediaBox,
        cropBox,
        nativeStats: {
          textItemCount: textFragments.length,
          vectorOpCount,
          vectorLineCount,
          imageCount,
          coordinateRoundTripMaxErrorPt: Number(maxViewportErr.toFixed(4)),
          distinctCropBoxObserved,
          nativeFragmentBoxes: textFragments.map((f) => [
            Number(f.bboxPage.x1.toFixed(1)),
            Number(f.bboxPage.y1.toFixed(1)),
            Number(f.bboxPage.x2.toFixed(1)),
            Number(f.bboxPage.y2.toFixed(1)),
          ]),
        },
        tags,
        textFragments,
        organizedBlocks,
        vectorSegments,
        renderInfo,
        elements,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      engineRegistry.recordCallError('pdfjs-native', Math.round(performance.now() - t0), msg);
      throw err;
    }
  },

  /**
   * Attempts deterministic calibration of a chart region from real PDF vector path segments
   * and native tick numeric labels. Returns null unless genuine orthogonal axes + numeric ticks
   * + internal curve/bar geometry are confirmed.
   */
  calibrateChartFromVectors(
    segments: VectorSegment[],
    chartBbox: BoundingBox,
    fragments: NativeTextFragment[]
  ): VectorChartCalibrationResult | null {
    if (segments.length < 6) return null;
    const insideSegs = segments.filter((s) => {
      const mx = (s.x1 + s.x2) / 2;
      const my = (s.y1 + s.y2) / 2;
      return (
        mx >= chartBbox.x1 - 6 &&
        mx <= chartBbox.x2 + 6 &&
        my >= chartBbox.y1 - 6 &&
        my <= chartBbox.y2 + 6
      );
    });
    if (insideSegs.length < 4) return null;

    // Identify longest horizontal (potential X-axis) & vertical (potential Y-axis) lines
    const horiz = insideSegs
      .filter((s) => Math.abs(s.y2 - s.y1) <= 1.5 && s.lengthPt >= chartBbox.width * 0.35)
      .sort((a, b) => b.lengthPt - a.lengthPt);
    const vert = insideSegs
      .filter((s) => Math.abs(s.x2 - s.x1) <= 1.5 && s.lengthPt >= chartBbox.height * 0.3)
      .sort((a, b) => b.lengthPt - a.lengthPt);

    if (horiz.length === 0 || vert.length === 0) return null;
    const xAxis = horiz[0];
    const yAxis = vert[0];
    const axX1 = Math.min(xAxis.x1, xAxis.x2);
    const axX2 = Math.max(xAxis.x1, xAxis.x2);
    const axY1 = Math.min(yAxis.y1, yAxis.y2);
    const axY2 = Math.max(yAxis.y1, yAxis.y2);
    if (axX2 - axX1 < 20 || axY2 - axY1 < 20) return null;

    // Extract numeric Y-axis tick labels left of yAxis and numeric X-axis tick labels below xAxis
    const parseNum = (t: string): number | null => {
      const cleaned = t.trim().replace(',', '.');
      if (!/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)) return null;
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : null;
    };

    const yTicks = fragments
      .map((f) => ({
        val: parseNum(f.text),
        cy: (f.bboxPage.y1 + f.bboxPage.y2) / 2,
        cx: (f.bboxPage.x1 + f.bboxPage.x2) / 2,
      }))
      .filter(
        (t): t is { val: number; cy: number; cx: number } =>
          t.val !== null &&
          t.cx <= yAxis.x1 + 8 &&
          t.cx >= chartBbox.x1 - 24 &&
          t.cy >= axY1 - 8 &&
          t.cy <= axY2 + 8
      );

    if (yTicks.length < 2) return null;
    yTicks.sort((a, b) => a.cy - b.cy);
    const topTick = yTicks[0];
    const botTick = yTicks[yTicks.length - 1];
    const dyPx = botTick.cy - topTick.cy;
    if (Math.abs(dyPx) < 10 || topTick.val === botTick.val) return null;

    const mapYToValue = (py: number) =>
      botTick.val + ((botTick.cy - py) / dyPx) * (topTick.val - botTick.val);

    // Collect non-axis internal segments (candidate curve/line series segments)
    const dataSegs = insideSegs.filter(
      (s) =>
        s !== xAxis &&
        s !== yAxis &&
        Math.min(s.x1, s.x2) >= axX1 - 2 &&
        Math.max(s.x1, s.x2) <= axX2 + 2 &&
        Math.min(s.y1, s.y2) >= axY1 - 2 &&
        Math.max(s.y1, s.y2) <= axY2 + 2 &&
        s.kind !== 'rect' &&
        !(Math.abs(s.y2 - s.y1) <= 1 && s.lengthPt > (axX2 - axX1) * 0.85) // skip gridlines
    );

    if (dataSegs.length < 2) return null;
    const rawPts: Array<{ px: number; py: number }> = [];
    for (const s of dataSegs) {
      rawPts.push({ px: s.x1, py: s.y1 }, { px: s.x2, py: s.y2 });
    }
    rawPts.sort((a, b) => a.px - b.px);

    // Deduplicate adjacent identical vertices
    const deduped: ChartSeriesPoint[] = [];
    for (const pt of rawPts) {
      const last = deduped[deduped.length - 1];
      const xRel = Number((((pt.px - axX1) / (axX2 - axX1)) * 100).toFixed(2));
      const yVal = Number(mapYToValue(pt.py).toFixed(4));
      if (!last || Math.abs(Number(last.x) - xRel) > 0.3 || Math.abs(Number(last.y) - yVal) > 0.01) {
        deduped.push({ x: `${xRel}%`, y: yVal });
      }
    }

    if (deduped.length < 3) return null;

    return {
      series: [{ name: '矢量提取主曲线', points: deduped.slice(0, 120) }],
      xAxisBbox: createBbox(axX1, xAxis.y1 - 2, axX2, xAxis.y2 + 2, CoordinateSpace.PDF_PAGE_SPACE),
      yAxisBbox: createBbox(yAxis.x1 - 2, axY1, yAxis.x2 + 2, axY2, CoordinateSpace.PDF_PAGE_SPACE),
      note: `已基于 PDF 原生坐标轴 (${yTicks.length} 个 Y 轴刻度) 与 ${dataSegs.length} 条矢量路径段标定提取 ${deduped.length} 个曲线采样点。`,
    };
  },

  async renderImageFileToPage(
    fileBuffer: ArrayBuffer,
    mimeType: string,
    pageId: string
  ): Promise<NativePageExtraction> {
    engineRegistry.recordCallStart('geometry-affine');
    const t0 = performance.now();

    const blob = new Blob([fileBuffer], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('无法解码上传的图像文件。'));
        el.src = objectUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建 Canvas 上下文');
      ctx.drawImage(img, 0, 0);
      const previewDataUrl = canvas.toDataURL('image/jpeg', 0.92);

      const widthPt = Math.round((canvas.width * 72) / 96);
      const heightPt = Math.round((canvas.height * 72) / 96);

      engineRegistry.recordCallSuccess('geometry-affine', Math.round(performance.now() - t0), true);
      void pageId;
      return {
        pageIndex: 0,
        widthPt,
        heightPt,
        rotation: 0,
        mediaBox: [0, 0, widthPt, heightPt],
        cropBox: [0, 0, widthPt, heightPt],
        nativeStats: {
          textItemCount: 0,
          vectorOpCount: 0,
          vectorLineCount: 0,
          imageCount: 1,
          coordinateRoundTripMaxErrorPt: 0,
          distinctCropBoxObserved: false,
        },
        tags: [PageTag.IMAGE_HEAVY],
        textFragments: [],
        organizedBlocks: [],
        vectorSegments: [],
        renderInfo: {
          renderScale: canvas.width / Math.max(1, widthPt),
          pixelWidth: canvas.width,
          pixelHeight: canvas.height,
          previewDataUrl,
        },
        elements: [],
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  },

  async cropRegionDataUrl(
    pagePreviewDataUrl: string,
    bboxPage: BoundingBox,
    pageWidthPt: number,
    pageHeightPt: number
  ): Promise<string | undefined> {
    if (!pagePreviewDataUrl || pageWidthPt <= 0 || pageHeightPt <= 0) return undefined;
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to load page preview for crop'));
      el.src = pagePreviewDataUrl;
    });

    const scaleX = img.naturalWidth / pageWidthPt;
    const scaleY = img.naturalHeight / pageHeightPt;
    const pad = 4;
    const sx = Math.max(0, Math.floor(bboxPage.x1 * scaleX - pad));
    const sy = Math.max(0, Math.floor(bboxPage.y1 * scaleY - pad));
    const ex = Math.min(img.naturalWidth, Math.ceil(bboxPage.x2 * scaleX + pad));
    const ey = Math.min(img.naturalHeight, Math.ceil(bboxPage.y2 * scaleY + pad));
    const sw = Math.max(1, ex - sx);
    const sh = Math.max(1, ey - sy);

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL('image/png');
  },
};
