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

export const qualityGateService = {
  evaluateDocument(doc: DocumentIR): QualitySummary {
    const items: QualityCheckItem[] = [];
    let needsReviewCount = 0;
    let translatedObjectCount = 0;
    let totalTranslatableCount = 0;

    for (const page of doc.pages) {
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

        if (obj.objectType === ObjectType.FORMULA && obj.review.reviewStatus !== 'APPROVED') {
          items.push({
            code: 'FORMULA_UNVERIFIED',
            severity: 'info',
            message: `第 ${page.pageIndex + 1} 页公式已提取 LaTeX 并保留原始图像，建议核对上下标与符号`,
            objectId: obj.objectId,
            pageIndex: page.pageIndex,
          });
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
