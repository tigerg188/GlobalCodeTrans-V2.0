import React, { useMemo, useState } from 'react';
import katex from 'katex';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  Image as ImageIcon,
  Terminal,
  Cpu,
  Languages,
} from 'lucide-react';
import {
  ObjectStatus,
  ObjectType,
  ReconstructionStrategy,
  type DocumentIR,
  type DocumentObjectIR,
} from '../../domain/document/DocumentIR';
import type { EngineRecord, TaskLogEntry } from '../../domain/task/TaskTypes';
import type { QualityCheckItem } from '../../domain/translation/TranslationTypes';

type InspectorTab = 'object' | 'quality' | 'engines';

interface InspectorPaneProps {
  document: DocumentIR | null;
  selectedObject: DocumentObjectIR | null;
  qualityItems: QualityCheckItem[];
  engines: EngineRecord[];
  logs: TaskLogEntry[];
  onUpdateObject: (objectId: string, updater: (obj: DocumentObjectIR) => DocumentObjectIR) => void;
  onDeepVerifyObject: (pageIndex: number, objectId: string) => Promise<void>;
  onTranslateObject?: (objectId: string) => Promise<void>;
  onRebuildDiagram?: (objectId: string) => Promise<void>;
  onJumpToObject: (pageIndex: number, objectId: string) => void;
  isVerifyingRegion: boolean;
  translatingObjectId?: string | null;
}

export const InspectorPane: React.FC<InspectorPaneProps> = ({
  document,
  selectedObject,
  qualityItems,
  engines,
  logs,
  onUpdateObject,
  onDeepVerifyObject,
  onTranslateObject,
  onRebuildDiagram,
  onJumpToObject,
  isVerifyingRegion,
  translatingObjectId,
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>('object');

  const katexHtml = useMemo(() => {
    if (!selectedObject?.formulaData?.latex) return null;
    try {
      return katex.renderToString(selectedObject.formulaData.latex, {
        throwOnError: false,
        displayMode: true,
      });
    } catch {
      return null;
    }
  }, [selectedObject?.formulaData?.latex]);

  return (
    <aside className="w-[390px] shrink-0 bg-white flex flex-col h-full min-h-0">
      {/* Inspector Tab Bar */}
      <div className="h-11 px-2 border-b border-slate-200 flex items-center gap-1 shrink-0 bg-slate-50/70">
        <button
          type="button"
          onClick={() => setActiveTab('object')}
          className={`flex-1 py-1.5 px-2 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'object'
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          识别与审校
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('quality')}
          className={`flex-1 py-1.5 px-2 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'quality'
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          质量检查 ({qualityItems.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('engines')}
          className={`flex-1 py-1.5 px-2 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'engines'
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          引擎与日志
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'object' && (
          <>
            {!selectedObject ? (
              <div className="py-12 text-center space-y-2">
                <p className="text-sm font-medium text-slate-700">未选中文档对象</p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {document
                    ? '请在中央预览区点击任意识别框或双语段落，即可查看原始证据、公式/表格/图表结构与译文，并进行人工修订与复核。'
                    : '导入文件并执行处理后，可在此逐项审校识别对象。'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Metadata Header (Zero-pill clean text) */}
                <div className="pb-3 border-b border-slate-200 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900 font-mono">
                      #{selectedObject.readingOrder} · {selectedObject.objectType}
                    </span>
                    <span
                      className={`text-xs font-medium flex items-center gap-1 ${
                        selectedObject.review.reviewStatus === 'APPROVED'
                          ? 'text-emerald-700'
                          : selectedObject.status === ObjectStatus.NEEDS_REVIEW
                            ? 'text-amber-700'
                            : 'text-slate-600'
                      }`}
                    >
                      {selectedObject.review.reviewStatus === 'APPROVED' && (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      {selectedObject.status === ObjectStatus.NEEDS_REVIEW && (
                        <AlertTriangle className="w-3.5 h-3.5" />
                      )}
                      {selectedObject.review.reviewStatus}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2 gap-y-0.5 font-mono tabular-nums">
                    <span>策略: {selectedObject.strategy}</span>
                    <span>·</span>
                    <span>来源: {selectedObject.sourceType}</span>
                    <span>·</span>
                    <span>
                      置信度:{' '}
                      {selectedObject.confidence !== null
                        ? `${Math.round(selectedObject.confidence * 100)}%`
                        : 'UNKNOWN'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                    坐标 ({selectedObject.bbox.coordinateSpace}): [{selectedObject.bbox.x1.toFixed(1)},{' '}
                    {selectedObject.bbox.y1.toFixed(1)}, {selectedObject.bbox.x2.toFixed(1)},{' '}
                    {selectedObject.bbox.y2.toFixed(1)}] pt
                  </div>
                  {selectedObject.needsReviewReason && (
                    <div className="mt-1.5 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                      复核提示：{selectedObject.needsReviewReason}
                    </div>
                  )}
                </div>

                {/* Original Crop Evidence */}
                {selectedObject.rawImageDataUrl && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                        <ImageIcon className="w-3.5 h-3.5 text-slate-500" />
                        原始区域裁剪证据
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onDeepVerifyObject(selectedObject.pageIndex, selectedObject.objectId)
                        }
                        disabled={isVerifyingRegion}
                        className="text-xs font-medium text-blue-700 hover:text-blue-800 flex items-center gap-1 disabled:opacity-40 cursor-pointer"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${isVerifyingRegion ? 'animate-spin' : ''}`}
                        />
                        {isVerifyingRegion ? '重识别中...' : '局部视觉重识别'}
                      </button>
                    </div>
                    <div className="p-2 bg-slate-50 border border-slate-200 rounded flex justify-center">
                      <img
                        src={selectedObject.rawImageDataUrl}
                        alt="原始区域图像"
                        className="max-h-44 object-contain"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  </div>
                )}

                {/* Reconstructed Translated Diagram Preview + Editable Overlays */}
                {selectedObject.reconstructedImageDataUrl && (
                  <div className="space-y-2 p-2.5 bg-blue-50/40 border border-blue-200 rounded">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-blue-800 flex items-center gap-1">
                        <Languages className="w-3.5 h-3.5" />
                        译文重建图表（导出成果将使用此图）
                      </span>
                      {onRebuildDiagram && (
                        <button
                          type="button"
                          onClick={() => onRebuildDiagram(selectedObject.objectId)}
                          className="text-[11px] font-medium text-blue-700 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" />
                          重新渲染图表
                        </button>
                      )}
                    </div>
                    <div className="p-1.5 bg-white border border-blue-200 rounded flex justify-center">
                      <img
                        src={selectedObject.reconstructedImageDataUrl}
                        alt="译文重建图表"
                        className="max-h-52 object-contain"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    {selectedObject.diagramOverlays && selectedObject.diagramOverlays.length > 0 && (
                      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                        <div className="text-[11px] text-slate-600 font-medium">
                          图内标注译文微调（共 {selectedObject.diagramOverlays.length} 处，改后点「重新渲染图表」）：
                        </div>
                        {selectedObject.diagramOverlays.map((ov, idx) => (
                          <div key={ov.id} className="grid grid-cols-1 gap-1 bg-white p-1.5 rounded border border-slate-200">
                            <div className="text-[10px] text-slate-500 truncate" title={ov.sourceText}>
                              原文：{ov.sourceText}
                            </div>
                            <input
                              type="text"
                              value={ov.translatedText}
                              onChange={(e) => {
                                const val = e.target.value;
                                onUpdateObject(selectedObject.objectId, (obj) => ({
                                  ...obj,
                                  diagramOverlays: (obj.diagramOverlays || []).map((item, i) =>
                                    i === idx ? { ...item, translatedText: val } : item
                                  ),
                                }));
                              }}
                              className="w-full px-2 py-1 text-[11px] border border-slate-300 rounded focus:outline-none focus:border-blue-600"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Formula Structure & KaTeX Comparison */}
                {selectedObject.objectType === ObjectType.FORMULA && (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      公式 LaTeX 表达式（可修订）
                    </label>
                    <textarea
                      value={selectedObject.formulaData?.latex || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        onUpdateObject(selectedObject.objectId, (obj) => ({
                          ...obj,
                          formulaData: {
                            latex: val,
                            displayMode: obj.formulaData?.displayMode || 'block',
                            rawImageRef: obj.formulaData?.rawImageRef,
                          },
                          review: {
                            ...obj.review,
                            reviewStatus: 'EDITED',
                            previousLatex: obj.review.previousLatex ?? obj.formulaData?.latex,
                            reviewedAt: new Date().toISOString(),
                          },
                        }));
                      }}
                      rows={3}
                      className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600"
                    />
                    {katexHtml && (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded overflow-x-auto">
                        <div className="text-[11px] text-slate-500 mb-1">KaTeX 渲染对照：</div>
                        <div
                          className="text-sm text-slate-900"
                          dangerouslySetInnerHTML={{ __html: katexHtml }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Table Structured Preview */}
                {selectedObject.objectType === ObjectType.TABLE && selectedObject.tableData && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-700">
                      表格结构预览（共 {selectedObject.tableData.rows.length} 行）
                    </div>
                    <div className="overflow-x-auto border border-slate-200 rounded max-h-56">
                      <table className="w-full text-[11px] border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            {(
                              selectedObject.tableData.translatedHeaders ||
                              selectedObject.tableData.headers
                            ).map((h, i) => (
                              <th
                                key={i}
                                className="px-2 py-1 text-left font-semibold text-slate-800 border-r last:border-r-0 border-slate-200"
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(
                            selectedObject.tableData.translatedRows ||
                            selectedObject.tableData.rows
                          ).map((row, rIdx) => (
                            <tr key={rIdx} className="border-b last:border-b-0 border-slate-200">
                              {row.map((cell, cIdx) => (
                                <td
                                  key={cIdx}
                                  className="px-2 py-1 text-slate-700 border-r last:border-r-0 border-slate-200 tabular-nums"
                                >
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Chart Metadata */}
                {(selectedObject.objectType === ObjectType.CHART ||
                  selectedObject.objectType === ObjectType.PLOT) &&
                  selectedObject.chartData && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1.5 text-xs">
                      <div className="font-semibold text-slate-800">
                        图表语义信息（{selectedObject.chartData.chartType}）
                      </div>
                      <div className="text-slate-600">
                        采集方式：
                        <span className="font-mono text-slate-900">
                          {selectedObject.chartData.extractionMethod === 'NATIVE_VECTOR'
                            ? '原生矢量提取'
                            : '视觉模型语义解析（非精确矢量采样）'}
                        </span>
                      </div>
                      {selectedObject.chartData.title && (
                        <div>标题：{selectedObject.chartData.translatedTitle || selectedObject.chartData.title}</div>
                      )}
                      {selectedObject.chartData.xAxisLabel && (
                        <div>X 轴：{selectedObject.chartData.translatedXAxisLabel || selectedObject.chartData.xAxisLabel}</div>
                      )}
                      {selectedObject.chartData.yAxisLabel && (
                        <div>Y 轴：{selectedObject.chartData.translatedYAxisLabel || selectedObject.chartData.yAxisLabel}</div>
                      )}
                      <div className="text-[11px] text-amber-700">{selectedObject.chartData.note}</div>
                    </div>
                  )}

                {/* CAD / Diagram Preserved Note */}
                {(selectedObject.objectType === ObjectType.CAD_DRAWING ||
                  selectedObject.objectType === ObjectType.DIAGRAM ||
                  selectedObject.objectType === ObjectType.FLOWCHART) &&
                  selectedObject.cadData && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-2 text-xs">
                      <div className="font-semibold text-slate-800">
                        工程图 / 流程图（C 策略：原图保真保留）
                      </div>
                      <p className="text-[11px] text-slate-600">
                        未接入外部 CAD 插件，系统严禁修改原始几何实体，导出时保留原图高清图像，仅附带以下可识别外围标注译文：
                      </p>
                      {selectedObject.cadData.peripheralLabels.length > 0 ? (
                        <ul className="space-y-1 max-h-36 overflow-y-auto">
                          {selectedObject.cadData.peripheralLabels.map((lbl, idx) => (
                            <li
                              key={idx}
                              className="flex justify-between gap-2 text-[11px] py-1 border-b last:border-b-0 border-slate-200"
                            >
                              <span className="text-slate-600">{lbl}</span>
                              <span className="text-slate-900 font-medium">
                                {selectedObject.cadData?.translatedPeripheralLabels?.[idx] || '—'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-[11px] text-slate-500">未检测到独立外围文字标注</div>
                      )}
                    </div>
                  )}

                {/* Raw Text */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    原始提取文本 ({selectedObject.sourceReference})
                  </label>
                  <textarea
                    value={selectedObject.rawText}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateObject(selectedObject.objectId, (obj) => ({
                        ...obj,
                        rawText: val,
                      }));
                    }}
                    rows={3}
                    className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded text-slate-700 focus:outline-none focus:border-blue-600"
                  />
                </div>

                {/* Translated Text */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-700">
                      专业译文（可人工修订）
                    </label>
                    {onTranslateObject && selectedObject.rawText?.trim() && (
                      <button
                        type="button"
                        disabled={translatingObjectId === selectedObject.objectId}
                        onClick={() => onTranslateObject(selectedObject.objectId)}
                        className="text-xs font-medium text-blue-700 hover:text-blue-800 flex items-center gap-1 disabled:opacity-40 cursor-pointer"
                      >
                        <Languages className="w-3 h-3" />
                        {translatingObjectId === selectedObject.objectId
                          ? '翻译中...'
                          : selectedObject.translatedText
                            ? '重新翻译此段'
                            : '翻译此段'}
                      </button>
                    )}
                  </div>
                  <textarea
                    value={selectedObject.translatedText || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateObject(selectedObject.objectId, (obj) => ({
                        ...obj,
                        translatedText: val,
                        review: {
                          ...obj.review,
                          reviewStatus: 'EDITED',
                          previousContent: obj.review.previousContent ?? obj.translatedText,
                          reviewedAt: new Date().toISOString(),
                        },
                      }));
                    }}
                    rows={4}
                    placeholder="等待翻译或在此输入人工译文..."
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600"
                  />
                </div>

                {/* Review Actions */}
                <div className="pt-2 border-t border-slate-200 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateObject(selectedObject.objectId, (obj) => ({
                        ...obj,
                        status: ObjectStatus.TRANSLATED,
                        review: {
                          ...obj.review,
                          reviewStatus: 'APPROVED',
                          reviewedAt: new Date().toISOString(),
                        },
                      }))
                    }
                    className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer"
                  >
                    确认通过
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateObject(selectedObject.objectId, (obj) => ({
                        ...obj,
                        status: ObjectStatus.NEEDS_REVIEW,
                        review: {
                          ...obj.review,
                          reviewStatus: 'NEEDS_REVIEW',
                          reviewedAt: new Date().toISOString(),
                        },
                      }))
                    }
                    className="py-2 px-3 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer"
                  >
                    标记待审
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateObject(selectedObject.objectId, (obj) => ({
                        ...obj,
                        strategy: ReconstructionStrategy.C_PRESERVE_ORIGINAL,
                      }))
                    }
                    className="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer"
                    title="导出 Word 时强制保留原始图像，不尝试文本/结构重建"
                  >
                    保留原图 (C策略)
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'quality' && (
          <div className="space-y-2.5">
            {qualityItems.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                {document ? '当前未检测到质量告警或遗漏项。' : '处理文档后将在此显示质量检查结果。'}
              </div>
            ) : (
              qualityItems.map((item, idx) => (
                <button
                  key={`${item.objectId}_${idx}`}
                  type="button"
                  onClick={() => {
                    onJumpToObject(item.pageIndex, item.objectId);
                    setActiveTab('object');
                  }}
                  className="w-full text-left p-2.5 rounded border border-slate-200 hover:border-blue-400 hover:bg-blue-50/40 transition-colors space-y-1 cursor-pointer"
                >
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span
                      className={`font-semibold flex items-center gap-1 ${
                        item.severity === 'error'
                          ? 'text-red-700'
                          : item.severity === 'warning'
                            ? 'text-amber-700'
                            : 'text-blue-700'
                      }`}
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      {item.code}
                    </span>
                    <span className="text-slate-500">第 {item.pageIndex + 1} 页</span>
                  </div>
                  <p className="text-xs text-slate-700 leading-snug">{item.message}</p>
                </button>
              ))
            )}
          </div>
        )}

        {activeTab === 'engines' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-slate-600" />
                运行时引擎状态注册表（真实事件驱动）
              </div>
              <div className="divide-y divide-slate-200 border border-slate-200 rounded">
                {engines.map((eng) => (
                  <div key={eng.engineId} className="p-2.5 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">{eng.displayName}</span>
                      <span className="font-mono text-[11px] font-semibold text-blue-700">
                        {eng.state}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      版本: {eng.version} · 调用: {eng.callCount} · 成功: {eng.successCount} · 错误: {eng.errorCount}
                      {eng.lastDurationMs ? ` · 耗时: ${eng.lastDurationMs}ms` : ''}
                    </div>
                    {eng.lastError && (
                      <div className="text-[11px] text-red-600">{eng.lastError}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-slate-600" />
                任务执行日志 ({logs.length})
              </div>
              <div className="border border-slate-200 rounded bg-slate-50 max-h-72 overflow-y-auto divide-y divide-slate-200">
                {logs.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500">暂无日志</div>
                ) : (
                  [...logs].reverse().map((log) => (
                    <div key={log.id} className="p-2 text-[11px] space-y-0.5">
                      <div className="flex items-center justify-between font-mono text-slate-500 tabular-nums">
                        <span>
                          [{log.status}] {log.module}.{log.action}
                        </span>
                        <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div
                        className={`${
                          log.level === 'ERROR'
                            ? 'text-red-700'
                            : log.level === 'WARN'
                              ? 'text-amber-700'
                              : 'text-slate-700'
                        }`}
                      >
                        {log.message}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
