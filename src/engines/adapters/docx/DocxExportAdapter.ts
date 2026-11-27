import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import {
  ObjectType,
  ReconstructionStrategy,
  type DocumentIR,
  type DocumentObjectIR,
} from '../../../domain/document/DocumentIR';
import type { DocxExportMode } from '../../../domain/task/TaskTypes';
import { engineRegistry } from '../../registry/EngineRegistry';
import { EngineRuntimeState } from '../../../domain/task/TaskTypes';

function dataUrlToUint8Array(dataUrl: string): { bytes: Uint8Array; type: 'png' | 'jpg' } | null {
  try {
    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
    if (!match) return null;
    const ext = match[1].toLowerCase();
    const base64 = match[2];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return {
      bytes,
      type: ext === 'png' ? 'png' : 'jpg',
    };
  } catch {
    return null;
  }
}

/**
 * Computes Word page layout display dimensions (in CSS px / pt-equivalent for ImageRun.transformation)
 * WITHOUT downsampling the embedded full-resolution image byte stream.
 */
async function getWordLayoutDimensions(
  dataUrl: string,
  maxDisplayWidth = 520
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 320;
      const h = img.naturalHeight || 180;
      if (w <= maxDisplayWidth) {
        resolve({ width: w, height: h });
      } else {
        const ratio = maxDisplayWidth / w;
        resolve({ width: maxDisplayWidth, height: Math.max(24, Math.round(h * ratio)) });
      }
    };
    img.onerror = () => resolve({ width: 320, height: 180 });
    img.src = dataUrl;
  });
}

function buildStyledTable(
  headers: string[],
  rows: string[][],
  isTranslatedLabel?: string
): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];
  if (isTranslatedLabel) {
    blocks.push(
      new Paragraph({
        spacing: { before: 80, after: 40 },
        children: [
          new TextRun({
            text: isTranslatedLabel,
            bold: true,
            size: 18,
            color: '334155',
          }),
        ],
      })
    );
  }

  const colCount = Math.max(
    headers.length,
    ...rows.map((r) => r.length),
    1
  );

  const tableRows: TableRow[] = [];

  if (headers.length > 0) {
    const paddedHeaders = Array.from({ length: colCount }, (_, i) => headers[i] ?? '');
    tableRows.push(
      new TableRow({
        tableHeader: true,
        children: paddedHeaders.map(
          (cell) =>
            new TableCell({
              shading: { type: ShadingType.CLEAR, fill: 'EFF6FF', color: 'auto' },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: cell, bold: true, size: 18, color: '0F172A' }),
                  ],
                }),
              ],
            })
        ),
      })
    );
  }

  for (const row of rows) {
    const padded = Array.from({ length: colCount }, (_, i) => row[i] ?? '');
    tableRows.push(
      new TableRow({
        children: padded.map(
          (cell) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: cell, size: 18, color: '1E293B' })],
                }),
              ],
            })
        ),
      })
    );
  }

  blocks.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: tableRows,
    })
  );
  return blocks;
}

async function buildObjectBlocks(
  obj: DocumentObjectIR,
  mode: DocxExportMode
): Promise<(Paragraph | Table)[]> {
  const blocks: (Paragraph | Table)[] = [];
  const srcText = obj.rawText?.trim() || '';
  const tgtText = obj.translatedText?.trim() || '';

  // 1. Visual objects (Image, CAD, Flowchart, Diagram, Chart, Formula image crop)
  // C-strategy rule: only use experimental reconstructedImageDataUrl as primary replacement if explicitly APPROVED by user.
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

  const pushImageParagraph = async (dataUrl: string, maxLayoutW: number, label?: string) => {
    const decoded = dataUrlToUint8Array(dataUrl);
    if (!decoded) return;
    if (label) {
      blocks.push(
        new Paragraph({
          spacing: { before: 100, after: 40 },
          children: [
            new TextRun({
              text: label,
              bold: true,
              size: 18,
              color: label.includes('译文重建') ? '1D4ED8' : '475569',
            }),
          ],
        })
      );
    }
    const dims = await getWordLayoutDimensions(dataUrl, maxLayoutW);
    blocks.push(
      new Paragraph({
        spacing: { before: 40, after: 80 },
        children: [
          new ImageRun({
            data: decoded.bytes,
            transformation: { width: dims.width, height: dims.height },
            type: decoded.type,
          }),
        ],
      })
    );
  };

  if (shouldEmbedVisual) {
    const maxLayoutW = obj.objectType === ObjectType.FORMULA ? 340 : 520;
    if (hasApprovedReconstruction && obj.reconstructedImageDataUrl) {
      await pushImageParagraph(
        obj.reconstructedImageDataUrl,
        maxLayoutW,
        mode === 'target_only' ? undefined : '【译文重建图表（已批准整图重绘）】'
      );
      if (mode !== 'target_only' && obj.rawImageDataUrl) {
        await pushImageParagraph(obj.rawImageDataUrl, maxLayoutW, '【原始图表证据对照】');
      }
    } else if (obj.rawImageDataUrl) {
      await pushImageParagraph(obj.rawImageDataUrl, maxLayoutW);
    }
  }

  // 2. Formula expression block
  if (obj.objectType === ObjectType.FORMULA && obj.formulaData?.latex) {
    blocks.push(
      new Paragraph({
        spacing: { before: 40, after: 80 },
        children: [
          new TextRun({
            text: `公式表达式 (LaTeX): ${obj.formulaData.latex}`,
            font: 'Consolas',
            size: 18,
            color: '1D4ED8',
          }),
        ],
      })
    );
  }

  // 3. Structured Table
  if (obj.objectType === ObjectType.TABLE && obj.tableData) {
    if (mode !== 'target_only' && (obj.tableData.headers.length > 0 || obj.tableData.rows.length > 0)) {
      blocks.push(...buildStyledTable(obj.tableData.headers, obj.tableData.rows, '【原表结构】'));
    }
    if (
      obj.tableData.translatedRows &&
      obj.tableData.translatedRows.length > 0
    ) {
      blocks.push(
        ...buildStyledTable(
          obj.tableData.translatedHeaders ?? obj.tableData.headers,
          obj.tableData.translatedRows,
          mode === 'target_only' ? undefined : '【译文表格】'
        )
      );
    }
  }

  // 4. Chart metadata
  if (
    (obj.objectType === ObjectType.CHART || obj.objectType === ObjectType.PLOT) &&
    obj.chartData &&
    (!hasApprovedReconstruction || mode === 'bilingual_review')
  ) {
    const lines = [
      obj.chartData.translatedTitle || obj.chartData.title
        ? `图表标题: ${obj.chartData.translatedTitle || obj.chartData.title}`
        : null,
      obj.chartData.xAxisLabel ? `X轴: ${obj.chartData.translatedXAxisLabel || obj.chartData.xAxisLabel}` : null,
      obj.chartData.yAxisLabel ? `Y轴: ${obj.chartData.translatedYAxisLabel || obj.chartData.yAxisLabel}` : null,
      obj.chartData.legendItems.length > 0
        ? `图例: ${(obj.chartData.translatedLegendItems || obj.chartData.legendItems).join(' / ')}`
        : null,
      `数据来源说明: ${obj.chartData.extractionMethod === 'NATIVE_VECTOR' ? 'PDF 原生矢量提取' : '视觉模型语义解析（非精确矢量采样，请核对原图）'}`,
    ].filter(Boolean) as string[];

    for (const line of lines) {
      blocks.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: line, size: 18, color: '475569' })],
        })
      );
    }
  }

  // 5. CAD / Engineering drawing peripheral labels (only in review mode or when approved visual reconstruction unavailable)
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
    blocks.push(...buildStyledTable(['图中原标注', '译文标注'], rows, '【图内文字识别与译文对照】'));
  }

  // 6. Standard Text / Heading / List / Caption / Footnote
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
      blocks.push(
        new Paragraph({
          heading: isHeading ? HeadingLevel.HEADING_2 : undefined,
          spacing: { before: isHeading ? 180 : 60, after: 80 },
          children: [
            new TextRun({
              text: tgtText || srcText,
              bold: isHeading,
              size: isHeading ? 26 : 21,
              color: '0F172A',
            }),
          ],
        })
      );
    } else if (mode === 'bilingual_columns') {
      blocks.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 50, type: WidthType.PERCENTAGE },
                  borders: {
                    top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    right: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                  },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: srcText || '—',
                          bold: isHeading,
                          size: isHeading ? 22 : 19,
                          color: '334155',
                        }),
                      ],
                    }),
                  ],
                }),
                new TableCell({
                  width: { size: 50, type: WidthType.PERCENTAGE },
                  borders: {
                    top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                  },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: tgtText || '（未生成译文）',
                          bold: isHeading,
                          size: isHeading ? 22 : 19,
                          color: '0F172A',
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
    } else {
      // bilingual_interleaved or bilingual_review
      if (srcText) {
        blocks.push(
          new Paragraph({
            heading: isHeading ? HeadingLevel.HEADING_2 : undefined,
            spacing: { before: isHeading ? 160 : 60, after: 40 },
            children: [
              new TextRun({
                text: srcText,
                bold: isHeading,
                size: isHeading ? 24 : 20,
                color: '475569',
              }),
            ],
          })
        );
      }
      if (tgtText) {
        blocks.push(
          new Paragraph({
            spacing: { before: 20, after: 80 },
            children: [
              new TextRun({
                text: tgtText,
                bold: isHeading,
                size: isHeading ? 24 : 21,
                color: '0F172A',
              }),
            ],
          })
        );
      }
    }
  }

  // 7. Review & Traceability Metadata in bilingual_review mode
  if (mode === 'bilingual_review') {
    const confStr = obj.confidence !== null ? `${Math.round(obj.confidence * 100)}%` : 'UNKNOWN';
    const metaLine = `[溯源] P${obj.pageIndex + 1} · ${obj.objectType} · 策略=${obj.strategy} · 来源=${obj.sourceReference} · 置信度=${confStr} · 审校=${obj.review.reviewStatus}${obj.needsReviewReason ? ` · 提示: ${obj.needsReviewReason}` : ''}`;
    blocks.push(
      new Paragraph({
        spacing: { before: 10, after: 90 },
        children: [
          new TextRun({
            text: metaLine,
            size: 16,
            color: '64748B',
            italics: true,
          }),
        ],
      })
    );
  }

  return blocks;
}

export const docxExportAdapter = {
  async exportDocument(
    doc: DocumentIR,
    mode: DocxExportMode,
    targetLanguageLabel: string
  ): Promise<Blob> {
    engineRegistry.markState('docx-builder', EngineRuntimeState.LOADED);
    engineRegistry.recordCallStart('docx-builder');
    const t0 = performance.now();

    try {
      const children: (Paragraph | Table)[] = [
        new Paragraph({
          heading: HeadingLevel.TITLE,
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: doc.metadata.title || doc.sourceFileName,
              bold: true,
              size: 32,
              color: '0F172A',
            }),
          ],
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: `源文件: ${doc.sourceFileName} | 页数: ${doc.pageCount} | 目标语言: ${targetLanguageLabel} | 输出模式: ${mode} | Schema: v${doc.schemaVersion}`,
              size: 18,
              color: '475569',
            }),
          ],
        }),
      ];

      for (const page of doc.pages) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 240, after: 100 },
            children: [
              new TextRun({
                text: `第 ${page.pageIndex + 1} 页（原生文本 ${page.nativeStats.textItemCount} 段 / 矢量操作 ${page.nativeStats.vectorOpCount} / 图像 ${page.nativeStats.imageCount}）`,
                bold: true,
                size: 22,
                color: '1D4ED8',
              }),
            ],
          })
        );

        const sorted = [...page.objects].sort((a, b) => a.readingOrder - b.readingOrder);
        for (const obj of sorted) {
          const objBlocks = await buildObjectBlocks(obj, mode);
          children.push(...objBlocks);
        }
      }

      const wordDoc = new Document({
        sections: [
          {
            headers: {
              default: new Header({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({
                        text: `GlobalCodeTrans V2.0 — ${doc.sourceFileName}`,
                        size: 16,
                        color: '64748B',
                      }),
                    ],
                  }),
                ],
              }),
            },
            footers: {
              default: new Footer({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({ text: '第 ', size: 16, color: '64748B' }),
                      new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '64748B' }),
                      new TextRun({ text: ' 页 / 共 ', size: 16, color: '64748B' }),
                      new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '64748B' }),
                      new TextRun({ text: ' 页', size: 16, color: '64748B' }),
                    ],
                  }),
                ],
              }),
            },
            children,
          },
        ],
      });

      const blob = await Packer.toBlob(wordDoc);
      const valid = blob.size > 0;
      engineRegistry.recordCallSuccess('docx-builder', Math.round(performance.now() - t0), valid);
      return blob;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      engineRegistry.recordCallError('docx-builder', Math.round(performance.now() - t0), msg);
      throw err;
    }
  },
};
