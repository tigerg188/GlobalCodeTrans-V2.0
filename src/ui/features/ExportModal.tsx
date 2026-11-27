import React, { useState } from 'react';
import { X, Download, AlertTriangle, FileCheck2, FileText } from 'lucide-react';
import type { DocxExportMode } from '../../domain/task/TaskTypes';
import type { QualitySummary } from '../../application/services/QualityGateService';

export type ExportFormat = 'docx' | 'pdf';

interface ExportModalProps {
  isOpen: boolean;
  fileName: string;
  quality: QualitySummary;
  exportingFormat: ExportFormat | null;
  onClose: () => void;
  onExport: (format: ExportFormat, mode: DocxExportMode) => Promise<void>;
}

const EXPORT_MODES: Array<{
  mode: DocxExportMode;
  title: string;
  desc: string;
}> = [
  {
    mode: 'bilingual_interleaved',
    title: '双语段落对照（推荐审阅）',
    desc: '原文段落后紧跟译文段落，保留标题层级、结构化表格、公式及原图证据。',
  },
  {
    mode: 'bilingual_columns',
    title: '双栏对照表格',
    desc: '左栏原文、右栏译文并列排版，适合逐句核对技术条款、参数与合同内容。',
  },
  {
    mode: 'target_only',
    title: '纯译文交付版',
    desc: '仅输出目标语言文本与译文表格，同时按 C 策略保留不可重建的工程图与原图。',
  },
  {
    mode: 'bilingual_review',
    title: '原文 + 译文 + 审校溯源版',
    desc: '完整保留原文、译文、页码、策略 (A/B/C)、置信度及人工复核提示，适合高风险尽调。',
  },
];

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  fileName,
  quality,
  exportingFormat,
  onClose,
  onExport,
}) => {
  const [selectedMode, setSelectedMode] = useState<DocxExportMode>('bilingual_interleaved');

  if (!isOpen) return null;

  const isBusy = exportingFormat !== null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-blue-700" />
            <h2 className="text-sm font-semibold text-slate-900" style={{ fontFamily: 'var(--font-display)' }}>
              导出翻译成果 (.docx / .pdf)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-500 hover:text-slate-800 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
            <div className="font-medium text-slate-800 truncate">源文件：{fileName}</div>
            <div className="text-slate-600 font-mono tabular-nums">
              已翻译对象：{quality.translatedObjectCount} / {quality.totalTranslatableCount} · 待复核：
              {quality.needsReviewCount} · 数值/严重告警：{quality.errorCount}
            </div>
            {(quality.needsReviewCount > 0 || quality.errorCount > 0) && (
              <div className="pt-1 text-amber-700 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>存在待人工复核或数值校验告警项，建议导出后对照原件重点审校。</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700">选择成果输出版式模式</div>
            {EXPORT_MODES.map((opt) => (
              <label
                key={opt.mode}
                className={`block p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedMode === opt.mode
                    ? 'border-blue-600 bg-blue-50/50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="docxMode"
                    checked={selectedMode === opt.mode}
                    onChange={() => setSelectedMode(opt.mode)}
                    className="text-blue-600"
                  />
                  <span className="text-xs font-semibold text-slate-900">{opt.title}</span>
                </div>
                <p className="mt-1 pl-5 text-[11px] text-slate-600 leading-relaxed">{opt.desc}</p>
              </label>
            ))}
          </div>

          <div className="pt-2 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onExport('pdf', selectedMode)}
              className="px-4 py-2 text-xs font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 disabled:opacity-40 rounded flex items-center gap-1.5 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-red-700" />
              {exportingFormat === 'pdf' ? '正在生成 PDF...' : '导出为 PDF'}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onExport('docx', selectedMode)}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-40 rounded flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              {exportingFormat === 'docx' ? '正在生成 DOCX...' : '导出为 Word'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
