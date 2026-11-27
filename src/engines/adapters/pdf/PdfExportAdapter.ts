import { jsPDF } from 'jspdf';
import {
  ObjectType,
  ReconstructionStrategy,
  type DocumentIR,
  type DocumentObjectIR,
} from '../../../domain/document/DocumentIR';
import { EngineRuntimeState, type DocxExportMode } from '../../../domain/task/TaskTypes';
import { engineRegistry } from '../../registry/EngineRegistry';

// A4 at 150 DPI (1240 x 1754 px) provides crisp typography & embedded image fidelity
const PAGE_W = 1240;
const PAGE_H = 1754;
const MARGIN_X = 76;
const MARGIN_TOP = 92;
const MARGIN_BOTTOM = 84;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const FONT_STACK =
  '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans Lao", "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO_FONT_STACK = '"Consolas", "SFMono-Regular", Menlo, monospace';

interface PageCanvasRecord {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }

    let current = '';
    // Segment by tokens so Latin words stay intact when possible, while CJK/Lao break cleanly
    const tokens = para.match(/(\S+\s*)/g) || [para];
    for (const token of tokens) {
      const candidate = current + token;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current.trimEnd()) {
          lines.push(current.trimEnd());
          current = '';
        }
        // If single token exceeds maxWidth (e.g. CJK run or long URL), split by character
        if (ctx.measureText(token).width > maxWidth) {
          let charBuf = '';
          for (const ch of Array.from(token)) {
            if (ctx.measureText(charBuf + ch).width > maxWidth && charBuf.length > 0) {
              lines.push(charBuf);
              charBuf = ch;
            } else {
              charBuf += ch;
            }
          }
          current = charBuf;
        } else {
          current = token.trimStart();
        }
      }
    }
    if (current.trimEnd()) {
      lines.push(current.trimEnd());
    }
  }

  return lines.length > 0 ? lines : [''];
}

class PdfPaginatedCanvas {
  public pages: PageCanvasRecord[] = [];
  private cursorY = MARGIN_TOP;
  private readonly docTitleHeader: string;

  constructor(sourceFileName: string) {
    this.docTitleHeader = `GlobalCodeTrans V2.0 — ${sourceFileName}`;
    this.addPage();
  }

  private get ctx(): CanvasRenderingContext2D {
    return this.pages[this.pages.length - 1].ctx;
  }

  public addPage(): void {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('浏览器无法初始化 Canvas 2D 渲染上下文，无法生成 PDF。');
    }

    // White page background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    // Subtle header line
    ctx.font = `500 18px ${FONT_STACK}`;
    ctx.fillStyle = '#64748B';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(this.docTitleHeader, PAGE_W - MARGIN_X, 38);

    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN_X, 68);
    ctx.lineTo(PAGE_W - MARGIN_X, 68);
    ctx.stroke();

    ctx.textAlign = 'left';
    this.pages.push({ canvas, ctx });
    this.cursorY = MARGIN_TOP;
  }

  public ensureSpace(neededHeight: number): void {
    const maxBottom = PAGE_H - MARGIN_BOTTOM;
    if (this.cursorY + neededHeight > maxBottom && this.cursorY > MARGIN_TOP + 20) {
      this.addPage();
    }
  }

  public drawSpacer(px: number): void {
    this.cursorY += px;
  }

  public drawTextBlock(params: {
    text: string;
    fontSize: number;
    lineHeight: number;
    color: string;
    bold?: boolean;
    italic?: boolean;
    mono?: boolean;
    x?: number;
    maxWidth?: number;
    marginBottom?: number;
  }): void {
    const x = params.x ?? MARGIN_X;
    const maxWidth = params.maxWidth ?? CONTENT_W;
    const weight = params.bold ? '700' : '400';
    const style = params.italic ? 'italic ' : '';
    const family = params.mono ? MONO_FONT_STACK : FONT_STACK;
    const fontStr = `${style}${weight} ${params.fontSize}px ${family}`;

    this.ctx.font = fontStr;
    const lines = wrapTextLines(this.ctx, params.text, maxWidth);

    for (const line of lines) {
      this.ensureSpace(params.lineHeight);
      const ctx = this.ctx;
      ctx.font = fontStr;
      ctx.fillStyle = params.color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(line, x, this.cursorY);
      this.cursorY += params.lineHeight;
    }

    if (params.marginBottom) {
      this.cursorY += params.marginBottom;
    }
  }

  public drawDivider(color = '#CBD5E1', marginBottom = 14): void {
    this.ensureSpace(10);
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(MARGIN_X, this.cursorY);
    ctx.lineTo(PAGE_W - MARGIN_X, this.cursorY);
    ctx.stroke();
    this.cursorY += marginBottom;
  }

  public drawTwoColumnRow(
    leftText: string,
    rightText: string,
    isHeading: boolean
  ): void {
    const colGap = 24;
    const padX = 14;
    const padY = 12;
    const colW = (CONTENT_W - colGap) / 2;
    const innerW = colW - padX * 2;
    const fontSize = isHeading ? 24 : 20;
    const lineHeight = isHeading ? 34 : 29;
    const fontStrLeft = `${isHeading ? '700' : '400'} ${fontSize}px ${FONT_STACK}`;
    const fontStrRight = `${isHeading ? '700' : '400'} ${fontSize}px ${FONT_STACK}`;

    this.ctx.font = fontStrLeft;
    const leftLines = wrapTextLines(this.ctx, leftText || '—', innerW);
    this.ctx.font = fontStrRight;
    const rightLines = wrapTextLines(this.ctx, rightText || '（未生成译文）', innerW);

    const maxLines = Math.max(leftLines.length, rightLines.length);
    const chunkCapacity = Math.max(
      1,
      Math.floor((PAGE_H - MARGIN_BOTTOM - MARGIN_TOP - padY * 2) / lineHeight)
    );

    // Split extremely tall paragraphs safely across pages
    for (let offset = 0; offset < maxLines; offset += chunkCapacity) {
      const lSlice = leftLines.slice(offset, offset + chunkCapacity);
      const rSlice = rightLines.slice(offset, offset + chunkCapacity);
      const sliceLines = Math.max(lSlice.length, rSlice.length);
      const boxHeight = sliceLines * lineHeight + padY * 2;

      this.ensureSpace(boxHeight + 8);
      const ctx = this.ctx;
      const startY = this.cursorY;

      // Left cell background & border
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(MARGIN_X, startY, colW, boxHeight);
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1;
      ctx.strokeRect(MARGIN_X, startY, colW, boxHeight);

      // Right cell background & border
      const rightX = MARGIN_X + colW + colGap;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(rightX, startY, colW, boxHeight);
      ctx.strokeStyle = '#CBD5E1';
      ctx.strokeRect(rightX, startY, colW, boxHeight);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      ctx.font = fontStrLeft;
      ctx.fillStyle = '#334155';
      lSlice.forEach((line, i) => {
        ctx.fillText(line, MARGIN_X + padX, startY + padY + i * lineHeight);
      });

      ctx.font = fontStrRight;
      ctx.fillStyle = '#0F172A';
      rSlice.forEach((line, i) => {
        ctx.fillText(line, rightX + padX, startY + padY + i * lineHeight);
      });

      this.cursorY += boxHeight + 10;
    }
  }

  public async drawImageBox(dataUrl: string, maxWidthPx: number): Promise<void> {
    const img = await loadImageElement(dataUrl);
    if (!img || !img.naturalWidth || !img.naturalHeight) return;

    const maxAllowedW = Math.min(CONTENT_W, maxWidthPx);
    const maxAllowedH = 560;
    let drawW = img.naturalWidth;
    let drawH = img.naturalHeight;

    if (drawW > maxAllowedW) {
      const ratio = maxAllowedW / drawW;
      drawW = maxAllowedW;
      drawH = Math.round(drawH * ratio);
    }
    if (drawH > maxAllowedH) {
      const ratio = maxAllowedH / drawH;
      drawH = maxAllowedH;
      drawW = Math.round(drawW * ratio);
    }

    this.ensureSpace(drawH + 24);
    const ctx = this.ctx;
    ctx.drawImage(img, MARGIN_X, this.cursorY, drawW, drawH);
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN_X, this.cursorY, drawW, drawH);
    this.cursorY += drawH + 16;
  }

  public async drawSideBySideImages(
    leftDataUrl: string,
    rightDataUrl: string,
    leftLabel: string,
    rightLabel: string
  ): Promise<void> {
    const [leftImg, rightImg] = await Promise.all([
      loadImageElement(leftDataUrl),
      loadImageElement(rightDataUrl),
    ]);
    if (!leftImg || !rightImg) return;

    const colGap = 20;
    const colW = (CONTENT_W - colGap) / 2;
    const maxH = 540;

    const fit = (img: HTMLImageElement) => {
      let w = img.naturalWidth || colW;
      let h = img.naturalHeight || 240;
      const rW = colW / w;
      w = colW;
      h = Math.round(h * rW);
      if (h > maxH) {
        const rH = maxH / h;
        h = maxH;
        w = Math.round(w * rH);
      }
      return { w, h };
    };

    const lDim = fit(leftImg);
    const rDim = fit(rightImg);
    const rowH = Math.max(lDim.h, rDim.h);

    this.ensureSpace(rowH + 44);
    const ctx = this.ctx;

    ctx.font = `600 18px ${FONT_STACK}`;
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(leftLabel, MARGIN_X, this.cursorY);
    ctx.fillStyle = '#1D4ED8';
    ctx.fillText(rightLabel, MARGIN_X + colW + colGap, this.cursorY);
    this.cursorY += 26;

    ctx.drawImage(leftImg, MARGIN_X, this.cursorY, lDim.w, lDim.h);
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN_X, this.cursorY, lDim.w, lDim.h);

    const rightX = MARGIN_X + colW + colGap;
    ctx.drawImage(rightImg, rightX, this.cursorY, rDim.w, rDim.h);
    ctx.strokeStyle = '#2563EB';
    ctx.strokeRect(rightX, this.cursorY, rDim.w, rDim.h);

    this.cursorY += rowH + 18;
  }

  public drawTable(headers: string[], rows: string[][], label?: string): void {
    if (label) {
      this.drawTextBlock({
        text: label,
        fontSize: 20,
        lineHeight: 28,
        color: '#334155',
        bold: true,
        marginBottom: 6,
      });
    }

    const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
    const colW = CONTENT_W / colCount;
    const padX = colCount >= 10 ? 5 : 10;
    const padY = colCount >= 10 ? 6 : 8;
    const fontSize = colCount >= 12 ? 12 : colCount >= 8 ? 14 : 18;
    const lineHeight = Math.round(fontSize * 1.38);

    const drawRow = (cells: string[], isHeader: boolean) => {
      const fontStr = `${isHeader ? '700' : '400'} ${fontSize}px ${FONT_STACK}`;
      this.ctx.font = fontStr;
      const wrappedCols = Array.from({ length: colCount }, (_, c) =>
        wrapTextLines(this.ctx, cells[c] ?? '', Math.max(20, colW - padX * 2))
      );
      const maxLines = Math.max(...wrappedCols.map((w) => w.length), 1);
      const rowH = maxLines * lineHeight + padY * 2;

      this.ensureSpace(rowH + 4);
      const ctx = this.ctx;
      const startY = this.cursorY;

      for (let c = 0; c < colCount; c++) {
        const cellX = MARGIN_X + c * colW;
        ctx.fillStyle = isHeader ? '#EFF6FF' : '#FFFFFF';
        ctx.fillRect(cellX, startY, colW, rowH);
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 1;
        ctx.strokeRect(cellX, startY, colW, rowH);

        ctx.font = fontStr;
        ctx.fillStyle = isHeader ? '#0F172A' : '#1E293B';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        wrappedCols[c].forEach((line, lIdx) => {
          ctx.fillText(line, cellX + padX, startY + padY + lIdx * lineHeight);
        });
      }
      this.cursorY += rowH;
    };

    if (headers.length > 0) {
      drawRow(headers, true);
    }
    for (const row of rows) {
      drawRow(row, false);
    }
    this.cursorY += 14;
  }

  public stampPageFooters(): void {
    const total = this.pages.length;
    this.pages.forEach((p, idx) => {
      const ctx = p.ctx;
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(MARGIN_X, PAGE_H - 58);
      ctx.lineTo(PAGE_W - MARGIN_X, PAGE_H - 58);
      ctx.stroke();

      ctx.font = `400 18px ${FONT_STACK}`;
      ctx.fillStyle = '#64748B';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`第 ${idx + 1} 页 / 共 ${total} 页`, PAGE_W / 2, PAGE_H - 46);
    });
  }
}

async function renderObjectToPdfCanvas(
  canvasDoc: PdfPaginatedCanvas,
  obj: DocumentObjectIR,
  mode: DocxExportMode
): Promise<void> {
  const srcText = obj.rawText?.trim() || '';
  const tgtText = obj.translatedText?.trim() || '';

  const hasApprovedReconstruction =
    Boolean(obj.reconstructedImageDataUrl) && obj.review.reviewStatus === 'APPROVED';

  const shouldEmbedVisual =
    (Boolean(obj.rawImageDataUrl) || hasApprovedReconstruction) &&
    (obj.strategy === ReconstructionStrategy.C_PRESERVE_ORIGINAL ||
      hasApprovedReconstruction ||
      obj.objectType === ObjectType.FORMULA ||
      obj.objectType === ObjectType.CHART ||
      obj.objectType === ObjectType.PLOT ||
      obj.objectType === ObjectType.CAD_DRAWING ||
      obj.objectType === ObjectType.DIAGRAM ||
      obj.objectType === ObjectType.FLOWCHART ||
      obj.objectType === ObjectType.IMAGE);

  if (shouldEmbedVisual) {
    const imgWidth = obj.objectType === ObjectType.FORMULA ? 680 : CONTENT_W;
    if (hasApprovedReconstruction && obj.reconstructedImageDataUrl) {
      if (mode === 'target_only') {
        await canvasDoc.drawImageBox(obj.reconstructedImageDataUrl, imgWidth);
      } else if (mode === 'bilingual_columns' && obj.rawImageDataUrl) {
        await canvasDoc.drawSideBySideImages(
          obj.rawImageDataUrl,
          obj.reconstructedImageDataUrl,
          '【原图】',
          '【译文重建图表（已批准）】'
        );
      } else {
        canvasDoc.drawTextBlock({
          text: '【译文重建图表（已批准整图重绘）】',
          fontSize: 19,
          lineHeight: 26,
          color: '#1D4ED8',
          bold: true,
          marginBottom: 6,
        });
        await canvasDoc.drawImageBox(obj.reconstructedImageDataUrl, imgWidth);

        if (obj.rawImageDataUrl) {
          canvasDoc.drawTextBlock({
            text: '【原始图表证据对照】',
            fontSize: 18,
            lineHeight: 25,
            color: '#475569',
            bold: true,
            marginBottom: 6,
          });
          await canvasDoc.drawImageBox(obj.rawImageDataUrl, imgWidth);
        }
      }
    } else if (obj.rawImageDataUrl) {
      await canvasDoc.drawImageBox(obj.rawImageDataUrl, imgWidth);
    }
  }

  if (obj.objectType === ObjectType.FORMULA && obj.formulaData?.latex) {
    canvasDoc.drawTextBlock({
      text: `公式表达式 (LaTeX): ${obj.formulaData.latex}`,
      fontSize: 19,
      lineHeight: 27,
      color: '#1D4ED8',
      mono: true,
      marginBottom: 10,
    });
  }

  if (obj.objectType === ObjectType.TABLE && obj.tableData) {
    if (
      mode !== 'target_only' &&
      (obj.tableData.headers.length > 0 || obj.tableData.rows.length > 0)
    ) {
      canvasDoc.drawTable(obj.tableData.headers, obj.tableData.rows, '【原表结构】');
    }
    if (obj.tableData.translatedRows && obj.tableData.translatedRows.length > 0) {
      canvasDoc.drawTable(
        obj.tableData.translatedHeaders ?? obj.tableData.headers,
        obj.tableData.translatedRows,
        mode === 'target_only' ? undefined : '【译文表格】'
      );
    }
  }

  if (
    (obj.objectType === ObjectType.CHART || obj.objectType === ObjectType.PLOT) &&
    obj.chartData &&
    (!hasApprovedReconstruction || mode === 'bilingual_review')
  ) {
    const lines = [
      obj.chartData.translatedTitle || obj.chartData.title
        ? `图表标题: ${obj.chartData.translatedTitle || obj.chartData.title}`
        : null,
      obj.chartData.xAxisLabel
        ? `X轴: ${obj.chartData.translatedXAxisLabel || obj.chartData.xAxisLabel}`
        : null,
      obj.chartData.yAxisLabel
        ? `Y轴: ${obj.chartData.translatedYAxisLabel || obj.chartData.yAxisLabel}`
        : null,
      obj.chartData.legendItems.length > 0
        ? `图例: ${(obj.chartData.translatedLegendItems || obj.chartData.legendItems).join(' / ')}`
        : null,
      `数据来源说明: ${
        obj.chartData.extractionMethod === 'NATIVE_VECTOR'
          ? 'PDF 原生矢量提取'
          : '视觉模型语义解析（非精确矢量采样，请核对原图）'
      }`,
    ].filter(Boolean) as string[];

    for (const line of lines) {
      canvasDoc.drawTextBlock({
        text: line,
        fontSize: 19,
        lineHeight: 27,
        color: '#475569',
        marginBottom: 4,
      });
    }
    canvasDoc.drawSpacer(8);
  }

  // Only render separate label dictionary table in review mode (or when approved visual reconstruction was unavailable)
  if (
    (obj.objectType === ObjectType.CAD_DRAWING ||
      obj.objectType === ObjectType.DIAGRAM ||
      obj.objectType === ObjectType.FLOWCHART) &&
    obj.cadData?.peripheralLabels?.length &&
    (mode === 'bilingual_review' || !hasApprovedReconstruction)
  ) {
    const srcLabels = obj.cadData.peripheralLabels;
    const tgtLabels = obj.cadData.translatedPeripheralLabels || [];
    const rows = srcLabels.map((lbl, idx) => [lbl, tgtLabels[idx] || '（待翻译）']);
    canvasDoc.drawTable(['图中原标注', '译文标注'], rows, '【图内文字识别与译文对照】');
  }

  const isDiagramObject =
    obj.objectType === ObjectType.CAD_DRAWING ||
    obj.objectType === ObjectType.CHART ||
    obj.objectType === ObjectType.PLOT ||
    obj.objectType === ObjectType.DIAGRAM ||
    obj.objectType === ObjectType.FLOWCHART ||
    obj.objectType === ObjectType.IMAGE;

  if (
    obj.objectType !== ObjectType.TABLE &&
    (srcText || tgtText) &&
    !(hasApprovedReconstruction && isDiagramObject && mode !== 'bilingual_review')
  ) {
    const isHeading = obj.objectType === ObjectType.HEADING;
    if (mode === 'target_only') {
      canvasDoc.drawTextBlock({
        text: tgtText || srcText,
        fontSize: isHeading ? 28 : 22,
        lineHeight: isHeading ? 38 : 32,
        color: '#0F172A',
        bold: isHeading,
        marginBottom: isHeading ? 12 : 10,
      });
    } else if (mode === 'bilingual_columns') {
      canvasDoc.drawTwoColumnRow(srcText, tgtText, isHeading);
    } else {
      if (srcText) {
        canvasDoc.drawTextBlock({
          text: srcText,
          fontSize: isHeading ? 26 : 20,
          lineHeight: isHeading ? 36 : 29,
          color: '#475569',
          bold: isHeading,
          marginBottom: 6,
        });
      }
      if (tgtText) {
        canvasDoc.drawTextBlock({
          text: tgtText,
          fontSize: isHeading ? 26 : 22,
          lineHeight: isHeading ? 36 : 32,
          color: '#0F172A',
          bold: isHeading,
          marginBottom: 12,
        });
      }
    }
  }

  if (mode === 'bilingual_review') {
    const confStr = obj.confidence !== null ? `${Math.round(obj.confidence * 100)}%` : 'UNKNOWN';
    const metaLine = `[溯源] P${obj.pageIndex + 1} · ${obj.objectType} · 策略=${obj.strategy} · 来源=${obj.sourceReference} · 置信度=${confStr} · 审校=${obj.review.reviewStatus}${
      obj.needsReviewReason ? ` · 提示: ${obj.needsReviewReason}` : ''
    }`;
    canvasDoc.drawTextBlock({
      text: metaLine,
      fontSize: 16,
      lineHeight: 23,
      color: '#64748B',
      italic: true,
      marginBottom: 12,
    });
  }
}

export const pdfExportAdapter = {
  async exportDocument(
    doc: DocumentIR,
    mode: DocxExportMode,
    targetLanguageLabel: string
  ): Promise<Blob> {
    engineRegistry.markState('pdf-builder', EngineRuntimeState.LOADED);
    engineRegistry.recordCallStart('pdf-builder');
    const t0 = performance.now();

    try {
      const canvasDoc = new PdfPaginatedCanvas(doc.sourceFileName);

      canvasDoc.drawTextBlock({
        text: doc.metadata.title || doc.sourceFileName,
        fontSize: 34,
        lineHeight: 46,
        color: '#0F172A',
        bold: true,
        marginBottom: 10,
      });

      canvasDoc.drawTextBlock({
        text: `源文件: ${doc.sourceFileName} | 页数: ${doc.pageCount} | 目标语言: ${targetLanguageLabel} | 输出模式: ${mode} | Schema: v${doc.schemaVersion}`,
        fontSize: 18,
        lineHeight: 26,
        color: '#475569',
        marginBottom: 14,
      });

      canvasDoc.drawDivider('#94A3B8', 22);

      for (const page of doc.pages) {
        canvasDoc.drawTextBlock({
          text: `第 ${page.pageIndex + 1} 页（原生文本 ${page.nativeStats.textItemCount} 段 / 矢量操作 ${page.nativeStats.vectorOpCount} / 图像 ${page.nativeStats.imageCount}）`,
          fontSize: 24,
          lineHeight: 34,
          color: '#1D4ED8',
          bold: true,
          marginBottom: 14,
        });

        const sorted = [...page.objects].sort((a, b) => a.readingOrder - b.readingOrder);
        if (sorted.length === 0) {
          canvasDoc.drawTextBlock({
            text: '（本页暂无已识别对象）',
            fontSize: 19,
            lineHeight: 28,
            color: '#64748B',
            italic: true,
            marginBottom: 14,
          });
        } else {
          for (const obj of sorted) {
            await renderObjectToPdfCanvas(canvasDoc, obj, mode);
          }
        }
        canvasDoc.drawSpacer(16);
      }

      canvasDoc.stampPageFooters();

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4',
        compress: true,
      });
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();

      canvasDoc.pages.forEach((p, idx) => {
        if (idx > 0) pdf.addPage('a4', 'portrait');
        const imgData = p.canvas.toDataURL('image/jpeg', 0.92);
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH, undefined, 'FAST');
      });

      const blob = pdf.output('blob');
      const valid = blob.size > 0;
      engineRegistry.recordCallSuccess('pdf-builder', Math.round(performance.now() - t0), valid);
      return blob;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      engineRegistry.recordCallError('pdf-builder', Math.round(performance.now() - t0), msg);
      throw err;
    }
  },
};
