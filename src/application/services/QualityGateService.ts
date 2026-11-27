import {
  ObjectStatus,
  ObjectType,
  ReconstructionStrategy,
  type DocumentIR,
} from '../../domain/document/DocumentIR';
import type { QualityCheckItem } from '../../domain/translation/TranslationTypes';
import { protectionService } from './ProtectionService';

export interface QualitySummary {
  items: QualityCheckItem[];
  errorCount: number;
  warningCount: number;
  needsReviewCount: number;
  translatedObjectCount: number;
  totalTranslatableCount: number;
}

const NON_TRANSLATABLE_TYPES = new Set<ObjectType>([
  ObjectType.IMAGE,
  ObjectType.PAGE_NUMBER,
]);

function computeBboxIoU(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number }
): number {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  if (inter <= 0) return 0;
  const areaA = Math.max(1, (a.x2 - a.x1) * (a.y2 - a.y1));
  const areaB = Math.max(1, (b.x2 - b.x1) * (b.y2 - b.y1));
  return inter / (areaA + areaB - inter);
}

export const qualityGateService = {
  evaluateDocument(doc: DocumentIR): QualitySummary {
    const items: QualityCheckItem[] = [];
    let needsReviewCount = 0;
    let translatedObjectCount = 0;
    let totalTranslatableCount = 0;

    for (const page of doc.pages) {
      // 1. Per-page native PDF text coverage rate
      const nativeBoxes = page.nativeStats.nativeFragmentBoxes;
      if (nativeBoxes && nativeBoxes.length >= 5 && page.objects.length > 0) {
        let coveredCount = 0;
        for (const [fx1, fy1, fx2, fy2] of nativeBoxes) {
          const cx = (fx1 + fx2) / 2;
          const cy = (fy1 + fy2) / 2;
          const covered = page.objects.some(
            (obj) =>
              cx >= obj.bbox.x1 - 4 &&
              cx <= obj.bbox.x2 + 4 &&
              cy >= obj.bbox.y1 - 4 &&
              cy <= obj.bbox.y2 + 4
          );
          if (covered) coveredCount += 1;
        }
        const coverage = coveredCount / nativeBoxes.length;
        if (coverage < 0.85) {
          items.push({
            code: 'NATIVE_TEXT_COVERAGE_LOW',
            severity: 'warning',
            message: `第 ${page.pageIndex + 1} 页原生 PDF 文本对象覆盖率偏低 (${Math.round(coverage * 100)}%，${coveredCount}/${nativeBoxes.length})，建议重新识别本页以防漏段`,
            objectId: page.objects[0].objectId,
            pageIndex: page.pageIndex,
          });
        }
      }

      // 2. Duplicate overlapping objects of identical objectType
      for (let i = 0; i < page.objects.length; i++) {
        for (let j = i + 1; j < page.objects.length; j++) {
          const a = page.objects[i];
          const b = page.objects[j];
          if (a.objectType === b.objectType && computeBboxIoU(a.bbox, b.bbox) >= 0.8) {
            items.push({
              code: 'DUPLICATE_OVERLAP',
              severity: 'warning',
              message: `第 ${page.pageIndex + 1} 页检测到重复框选的 ${a.objectType} 对象 (#${a.readingOrder} 与 #${b.readingOrder})`,
              objectId: b.objectId,
              pageIndex: page.pageIndex,
            });
          }
        }
      }

      // 3. Object-level completeness & semantic checks
      for (const obj of page.objects) {
        const isTranslatable =
          !NON_TRANSLATABLE_TYPES.has(obj.objectType) &&
          (obj.rawText.trim().length > 0 || Boolean(obj.tableData) || Boolean(obj.cadData?.peripheralLabels.length));

        if (isTranslatable) {
          totalTranslatableCount += 1;
          if (obj.translatedText && obj.translatedText.trim().length > 0) {
            translatedObjectCount += 1;
          } else if (obj.tableData?.translatedRows && obj.tableData.translatedRows.length > 0) {
            translatedObjectCount += 1;
          } else if (obj.status !== ObjectStatus.SKIPPED_WITH_REASON) {
            items.push({
              code: 'MISSING_TRANSLATION',
              severity: 'warning',
              message: `第 ${page.pageIndex + 1} 页 ${obj.objectType} 对象尚未生成译文`,
              objectId: obj.objectId,
              pageIndex: page.pageIndex,
            });
          }
        }

        if (obj.status === ObjectStatus.NEEDS_REVIEW || obj.review.reviewStatus === 'NEEDS_REVIEW') {
          needsReviewCount += 1;
        }

        if (obj.confidence !== null && obj.confidence < 0.72) {
          items.push({
            code: 'LOW_CONFIDENCE',
            severity: 'warning',
            message: `第 ${page.pageIndex + 1} 页 ${obj.objectType} 置信度偏低 (${Math.round(obj.confidence * 100)}%)：${obj.needsReviewReason || '建议人工核对原图'}`,
            objectId: obj.objectId,
            pageIndex: page.pageIndex,
          });
        }

        if (obj.objectType === ObjectType.FORMULA) {
          if (!obj.formulaData?.latex?.trim() || !obj.rawImageDataUrl) {
            items.push({
              code: 'FORMULA_INCOMPLETE',
              severity: 'warning',
              message: `第 ${page.pageIndex + 1} 页公式缺少 LaTeX 表达式或原始图像裁剪证据，建议局部重识别`,
              objectId: obj.objectId,
              pageIndex: page.pageIndex,
            });
          } else if (obj.review.reviewStatus !== 'APPROVED') {
            items.push({
              code: 'FORMULA_UNVERIFIED',
              severity: 'info',
              message: `第 ${page.pageIndex + 1} 页公式已提取 LaTeX 并保留原始图像，建议核对上下标与符号`,
              objectId: obj.objectId,
              pageIndex: page.pageIndex,
            });
          }
        }

        // Table structural integrity & cell numeric consistency
        if (obj.objectType === ObjectType.TABLE && obj.tableData) {
          const { headers, rows, translatedHeaders, translatedRows } = obj.tableData;
          if (translatedRows && translatedRows.length > 0) {
            const rowMismatch = translatedRows.length !== rows.length;
            const colMismatch = rows.some((r, rIdx) => (translatedRows[rIdx]?.length ?? 0) !== r.length);
            const headerMismatch =
              Boolean(translatedHeaders) && translatedHeaders!.length !== headers.length;
            if (rowMismatch || colMismatch || headerMismatch) {
              items.push({
                code: 'TABLE_STRUCTURE_MISMATCH',
                severity: 'error',
                message: `第 ${page.pageIndex + 1} 页表格译文行列结构与原表不一致（原 ${rows.length} 行 vs 译 ${translatedRows.length} 行）`,
                objectId: obj.objectId,
                pageIndex: page.pageIndex,
              });
            } else {
              const missingCellNums: string[] = [];
              rows.forEach((r, rIdx) => {
                r.forEach((cell, cIdx) => {
                  const tgtCell = translatedRows[rIdx]?.[cIdx] ?? '';
                  if (!cell.trim() || !tgtCell.trim()) return;
                  const sNums = protectionService.extractNumericTokens(cell);
                  const tNums = protectionService.extractNumericTokens(tgtCell);
                  sNums.forEach((n) => {
                    if (!tNums.includes(n)) missingCellNums.push(n);
                  });
                });
              });
              if (missingCellNums.length > 0) {
                items.push({
                  code: 'NUMBER_MISMATCH',
                  severity: 'error',
                  message: `第 ${page.pageIndex + 1} 页表格单元格译文可能遗漏或改动了原数值：${missingCellNums.slice(0, 4).join(', ')}`,
                  objectId: obj.objectId,
                  pageIndex: page.pageIndex,
                });
              }
            }
          }
        }

        if (
          (obj.objectType === ObjectType.CHART || obj.objectType === ObjectType.PLOT) &&
          obj.chartData?.extractionMethod === 'MODEL_ESTIMATED'
        ) {
          items.push({
            code: 'CHART_ESTIMATED',
            severity: 'warning',
            message: `第 ${page.pageIndex + 1} 页图表为视觉模型语义解析（非矢量精确采样），已保留原始高分辨率图像`,
            objectId: obj.objectId,
            pageIndex: page.pageIndex,
          });
        }

        if (
          (obj.objectType === ObjectType.CAD_DRAWING || obj.objectType === ObjectType.DIAGRAM) &&
          obj.strategy === ReconstructionStrategy.C_PRESERVE_ORIGINAL
        ) {
          items.push({
            code: 'CAD_PRESERVED',
            severity: 'info',
            message: `第 ${page.pageIndex + 1} 页工程图/结构图已按 C 策略保留原始图形与清晰度，仅处理可识别外围标注`,
            objectId: obj.objectId,
            pageIndex: page.pageIndex,
          });
        }

        if (obj.reconstructedImageDataUrl && obj.review.reviewStatus !== 'APPROVED') {
          items.push({
            code: 'EXPERIMENTAL_RECONSTRUCTION_UNAPPROVED',
            severity: 'warning',
            message: `第 ${page.pageIndex + 1} 页 ${obj.objectType} 存在试验性重绘图尚未批准，导出成果将默认采用原图保真`,
            objectId: obj.objectId,
            pageIndex: page.pageIndex,
          });
        }

        // Numeric consistency check on translated text
        if (obj.rawText.trim() && obj.translatedText?.trim()) {
          const srcNums = protectionService.extractNumericTokens(obj.rawText);
          const tgtNums = protectionService.extractNumericTokens(obj.translatedText);
          const missingNums = srcNums.filter((n) => !tgtNums.includes(n));
          if (missingNums.length > 0) {
            items.push({
              code: 'NUMBER_MISMATCH',
              severity: 'error',
              message: `第 ${page.pageIndex + 1} 页译文可能遗漏或改动了原数值：${missingNums.slice(0, 4).join(', ')}`,
              objectId: obj.objectId,
              pageIndex: page.pageIndex,
            });
          }
        }

        for (const w of obj.qualityWarnings) {
          items.push({
            code: 'HIGH_RISK_SEMANTIC',
            severity: 'warning',
            message: `第 ${page.pageIndex + 1} 页：${w}`,
            objectId: obj.objectId,
            pageIndex: page.pageIndex,
          });
        }
      }
    }

    const errorCount = items.filter((i) => i.severity === 'error').length;
    const warningCount = items.filter((i) => i.severity === 'warning').length;

    return {
      items,
      errorCount,
      warningCount,
      needsReviewCount,
      translatedObjectCount,
      totalTranslatableCount,
    };
  },
};
