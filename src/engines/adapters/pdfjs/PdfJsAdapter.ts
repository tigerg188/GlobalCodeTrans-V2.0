import * as pdfjsLib from 'pdfjs-dist';
import {
  CoordinateSpace,
  createBbox,
  pdfUserToPageSpace,
  verifyRoundTripErrorPt,
  type BoundingBox,
} from '../../../domain/geometry/CoordinateSpace';
import {
  PageTag,
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

export const pdfJsAdapter = {
  async openPdf(buffer: ArrayBuffer): Promise<LoadedPdfHandle> {
    ensurePdfWorker();
    engineRegistry.markState('pdfjs-native', EngineRuntimeState.INSTALLED);
    engineRegistry.recordCallStart('pdfjs-native');
    const t0 = performance.now();

    try {
      // Pass a slice copy so PDF.js worker transfer never detaches the caller's original ArrayBuffer
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

  async extractAndRenderPage(
    proxy: pdfjsLib.PDFDocumentProxy,
    pageIndex: number,
    pageId: string,
    renderScale = 1.6
  ): Promise<NativePageExtraction> {
    engineRegistry.recordCallStart('pdfjs-native');
    engineRegistry.recordCallStart('geometry-affine');
    const t0 = performance.now();

    try {
      const page = await proxy.getPage(pageIndex + 1);
      const view = page.view as [number, number, number, number];
      const rotation = page.rotate || 0;
      const mediaBox: [number, number, number, number] = [view[0], view[1], view[2], view[3]];
      const cropBox: [number, number, number, number] = [view[0], view[1], view[2], view[3]];

      const baseViewport = page.getViewport({ scale: 1 });
      const widthPt = baseViewport.width;
      const heightPt = baseViewport.height;

      // 1. Extract native text items with exact affine transform mapping
      const textContent = await page.getTextContent();
      const textFragments: NativeTextFragment[] = [];
      const elements: DocumentElementIR[] = [];
      let maxRoundTripErr = 0;

      let seq = 0;
      for (const item of textContent.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const tx = item.transform as number[]; // [a, b, c, d, e, f] in PDF_USER_SPACE
        const fontHeight = Math.max(4, Math.hypot(tx[2], tx[3]) || item.height || 10);
        const itemWidth = Math.max(1, item.width || fontHeight * item.str.length * 0.5);
        const userX1 = tx[4];
        const userY1 = tx[5];
        const userX2 = userX1 + itemWidth;
        const userY2 = userY1 + fontHeight;

        const userBbox = createBbox(
          userX1,
          userY1,
          userX2,
          userY2,
          CoordinateSpace.PDF_USER_SPACE
        );
        const rtErr = verifyRoundTripErrorPt(userBbox, cropBox, rotation);
        if (rtErr > maxRoundTripErr) maxRoundTripErr = rtErr;

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

      // 2. Inspect PDF operator list for vector paths & embedded images
      let vectorOpCount = 0;
      let vectorLineCount = 0;
      let imageCount = 0;
      try {
        const opList = await page.getOperatorList();
        const OPS = pdfjsLib.OPS;
        for (let i = 0; i < opList.fnArray.length; i++) {
          const fn = opList.fnArray[i];
          if (
            fn === OPS.constructPath ||
            fn === OPS.moveTo ||
            fn === OPS.lineTo ||
            fn === OPS.rectangle ||
            fn === OPS.curveTo ||
            fn === OPS.stroke ||
            fn === OPS.fill ||
            fn === OPS.eoFill
          ) {
            vectorOpCount += 1;
            if (fn === OPS.constructPath && Array.isArray(opList.argsArray[i])) {
              const opsArg = opList.argsArray[i][0];
              if (Array.isArray(opsArg)) {
                vectorLineCount += opsArg.length;
              }
            } else if (fn === OPS.lineTo || fn === OPS.rectangle) {
              vectorLineCount += 1;
            }
          } else if (
            fn === OPS.paintImageXObject ||
            fn === OPS.paintInlineImageXObject ||
            fn === OPS.paintImageMaskXObject ||
            fn === OPS.paintImageXObjectRepeat
          ) {
            imageCount += 1;
          }
        }
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

      // 4. Render page to offscreen canvas for accurate visual preview & object cropping
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
          coordinateRoundTripMaxErrorPt: Number(maxRoundTripErr.toFixed(6)),
        },
        tags,
        textFragments,
        renderInfo: {
          renderScale,
          pixelWidth: canvas.width,
          pixelHeight: canvas.height,
          previewDataUrl,
        },
        elements,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      engineRegistry.recordCallError('pdfjs-native', Math.round(performance.now() - t0), msg);
      throw err;
    }
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

      // Convert pixel dimensions at 96 DPI into PDF points (72 pt/in)
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
        },
        tags: [PageTag.IMAGE_HEAVY],
        textFragments: [],
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
