import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Columns2,
  FileText,
  ZoomIn,
  ZoomOut,
  RotateCw,
  AlertTriangle,
  CheckCircle2,
  Languages,
  Upload,
} from 'lucide-react';
import {
  ObjectStatus,
  ObjectType,
  type DocumentIR,
  type DocumentObjectIR,
  type PageIR,
} from '../../domain/document/DocumentIR';

export type CenterViewMode = 'overlay' | 'bilingual' | 'objects';

interface DocumentPreviewPaneProps {
  document: DocumentIR | null;
  currentPageIndex: number;
  selectedObjectId: string | null;
  zoom: number;
  showBoxes: boolean;
  viewMode: CenterViewMode;
  onPageChange: (pageIndex: number) => void;
  onSelectObject: (objectId: string) => void;
  onZoomChange: (zoom: number) => void;
  onToggleBoxes: () => void;
  onViewModeChange: (mode: CenterViewMode) => void;
  onReprocessPage: (pageIndex: number) => void;
  onImportFile?: () => void;
  isProcessing: boolean;
}

function getBoxColorClasses(obj: DocumentObjectIR, isSelected: boolean): string {
  if (isSelected) {
    return 'border-2 border-blue-600 bg-blue-500/15 ring-2 ring-blue-400/50 z-20';
  }
  if (obj.status === ObjectStatus.FAILED) {
    return 'border border-red-500 bg-red-500/10 hover:bg-red-500/20 z-10';
  }
  if (obj.status === ObjectStatus.NEEDS_REVIEW || obj.review.reviewStatus === 'NEEDS_REVIEW') {
    return 'border border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 z-10';
  }
  switch (obj.objectType) {
    case ObjectType.TABLE:
      return 'border border-emerald-600/80 bg-emerald-500/5 hover:bg-emerald-500/15';
    case ObjectType.FORMULA:
      return 'border border-indigo-600/80 bg-indigo-500/10 hover:bg-indigo-500/20';
    case ObjectType.CHART:
    case ObjectType.PLOT:
      return 'border border-cyan-600/80 bg-cyan-500/10 hover:bg-cyan-500/20';
    case ObjectType.CAD_DRAWING:
    case ObjectType.DIAGRAM:
    case ObjectType.FLOWCHART:
      return 'border border-violet-600/80 bg-violet-500/10 hover:bg-violet-500/20';
    default:
      return 'border border-slate-500/50 bg-slate-500/5 hover:bg-blue-500/10';
  }
}

export const DocumentPreviewPane: React.FC<DocumentPreviewPaneProps> = ({
  document,
  currentPageIndex,
  selectedObjectId,
  zoom,
  showBoxes,
  viewMode,
  onPageChange,
  onSelectObject,
  onZoomChange,
  onToggleBoxes,
  onViewModeChange,
  onReprocessPage,
  onImportFile,
  isProcessing,
}) => {
  const [showReconstructed, setShowReconstructed] = React.useState(true);
  const page: PageIR | undefined = document?.pages[currentPageIndex];
  const hasReconstructedOnPage = Boolean(page?.objects.some((o) => Boolean(o.reconstructedImageDataUrl)));

  if (!document || !page) {
    return (
      <section className="flex-1 flex flex-col items-center justify-center bg-slate-100/70 p-8 text-center">
        <div className="max-w-md space-y-4">
          <div className="mx-auto w-12 h-12 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400">
            <FileText className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold text-slate-900" style={{ fontFamily: 'var(--font-display)' }}>
            尚未导入技术文档
          </h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            请先导入真实 PDF 或工程图纸图像（PNG/JPG/WEBP），系统提取版面对象后，点击「开始翻译」即可执行多模态识别与专业翻译。
          </p>
          {onImportFile && (
            <div className="pt-1 flex justify-center">
              <button
                type="button"
                onClick={onImportFile}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md flex items-center gap-2 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                导入 PDF / 图像文件
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  const displayWidthPx = Math.round(page.widthPt * 1.15 * zoom);
  const displayHeightPx = Math.round(page.heightPt * 1.15 * zoom);
  const sortedObjects = [...page.objects].sort((a, b) => a.readingOrder - b.readingOrder);

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-slate-100/80 border-r border-slate-200">
      {/* Preview Toolbar */}
      <div className="h-11 px-3 bg-white border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(0, currentPageIndex - 1))}
            disabled={currentPageIndex === 0}
            className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40 text-slate-700 cursor-pointer"
            title="上一页"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-medium text-slate-700 tabular-nums whitespace-nowrap px-1">
            第 {currentPageIndex + 1} / {document.pageCount} 页
          </span>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(document.pageCount - 1, currentPageIndex + 1))}
            disabled={currentPageIndex >= document.pageCount - 1}
            className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40 text-slate-700 cursor-pointer"
            title="下一页"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <span className="h-4 w-px bg-slate-200 mx-1" />

          <button
            type="button"
            onClick={() => onZoomChange(Math.max(0.5, Number((zoom - 0.15).toFixed(2))))}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-700 cursor-pointer"
            title="缩小"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono text-slate-600 tabular-nums w-11 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => onZoomChange(Math.min(2.2, Number((zoom + 0.15).toFixed(2))))}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-700 cursor-pointer"
            title="放大"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
          <button
            type="button"
            onClick={() => onViewModeChange('overlay')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === 'overlay'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            页面叠加定位
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('bilingual')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1 ${
              viewMode === 'bilingual'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" />
            双语对照视图
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('objects')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === 'objects'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            对象清单 ({sortedObjects.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          {viewMode === 'overlay' && hasReconstructedOnPage && (
            <button
              type="button"
              onClick={() => setShowReconstructed((v) => !v)}
              className={`px-2.5 py-1 text-xs font-medium rounded border flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                showReconstructed
                  ? 'bg-blue-50 text-blue-800 border-blue-300'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Languages className="w-3.5 h-3.5" />
              {showReconstructed ? '显示原图' : '显示译文重建图'}
            </button>
          )}
          {viewMode === 'overlay' && (
            <button
              type="button"
              onClick={onToggleBoxes}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {showBoxes ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {showBoxes ? '隐藏区域框' : '显示区域框'}
            </button>
          )}
          <button
            type="button"
            onClick={() => onReprocessPage(currentPageIndex)}
            disabled={isProcessing}
            className={`px-2.5 py-1 text-xs font-medium rounded flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
              page.parseStatus === 'TRANSLATED'
                ? 'text-slate-700 bg-white border border-slate-200 hover:bg-slate-50'
                : 'text-white bg-blue-700 hover:bg-blue-800'
            }`}
            title="识别并翻译当前页面"
          >
            {page.parseStatus === 'TRANSLATED' ? (
              <RotateCw className="w-3.5 h-3.5" />
            ) : (
              <Languages className="w-3.5 h-3.5" />
            )}
            {page.parseStatus === 'TRANSLATED' ? '重新翻译本页' : '识别并翻译本页'}
          </button>
        </div>
      </div>

      {/* Main Preview Content */}
      <div className="flex-1 overflow-auto p-5">
        {viewMode === 'overlay' && (
          <div className="flex flex-col items-center">
            <div className="mb-2 flex items-center gap-3 text-[11px] text-slate-500 font-mono tabular-nums">
              <span>{page.widthPt.toFixed(1)} × {page.heightPt.toFixed(1)} pt</span>
              <span>·</span>
              <span>旋转 {page.rotation}°</span>
              <span>·</span>
              <span>原生文本 {page.nativeStats.textItemCount}</span>
              <span>·</span>
              <span>矢量操作 {page.nativeStats.vectorOpCount}</span>
              <span>·</span>
              <span>坐标往返误差 ≤ {page.nativeStats.coordinateRoundTripMaxErrorPt} pt</span>
            </div>

            <div
              className="relative bg-white shadow-sm border border-slate-300 select-none"
              style={{ width: displayWidthPx, height: displayHeightPx }}
            >
              {page.renderInfo.previewDataUrl ? (
                <img
                  src={page.renderInfo.previewDataUrl}
                  alt={`第 ${currentPageIndex + 1} 页渲染预览`}
                  className="w-full h-full object-contain pointer-events-none"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                  暂无页面渲染图像
                </div>
              )}

              {showReconstructed &&
                sortedObjects
                  .filter((obj) => Boolean(obj.reconstructedImageDataUrl))
                  .map((obj) => {
                    const leftPct = (obj.bbox.x1 / Math.max(1, page.widthPt)) * 100;
                    const topPct = (obj.bbox.y1 / Math.max(1, page.heightPt)) * 100;
                    const widthPct = (obj.bbox.width / Math.max(1, page.widthPt)) * 100;
                    const heightPct = (obj.bbox.height / Math.max(1, page.heightPt)) * 100;
                    return (
                      <img
                        key={`rec_${obj.objectId}`}
                        src={obj.reconstructedImageDataUrl}
                        alt="译文重建图表"
                        className="absolute inset-0 w-full h-full object-contain bg-white pointer-events-none z-10"
                        style={{
                          left: `${leftPct}%`,
                          top: `${topPct}%`,
                          width: `${widthPct}%`,
                          height: `${heightPct}%`,
                        }}
                        referrerPolicy="no-referrer"
                      />
                    );
                  })}

              {showBoxes &&
                sortedObjects.map((obj) => {
                  const leftPct = (obj.bbox.x1 / Math.max(1, page.widthPt)) * 100;
                  const topPct = (obj.bbox.y1 / Math.max(1, page.heightPt)) * 100;
                  const widthPct = (obj.bbox.width / Math.max(1, page.widthPt)) * 100;
                  const heightPct = (obj.bbox.height / Math.max(1, page.heightPt)) * 100;
                  const isSelected = obj.objectId === selectedObjectId;

                  return (
                    <button
                      key={obj.objectId}
                      type="button"
                      onClick={() => onSelectObject(obj.objectId)}
                      title={`#${obj.readingOrder} ${obj.objectType}`}
                      className={`absolute transition-colors cursor-pointer text-left ${getBoxColorClasses(
                        obj,
                        isSelected
                      )}`}
                      style={{
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                        width: `${widthPct}%`,
                        height: `${heightPct}%`,
                      }}
                    >
                      <span
                        className={`inline-block px-1 py-0.5 text-[10px] font-mono leading-none rounded-br ${
                          isSelected
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-900/75 text-white'
                        }`}
                      >
                        #{obj.readingOrder} {obj.objectType}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {viewMode === 'bilingual' && (
          <div className="max-w-5xl mx-auto bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="grid grid-cols-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
              <div className="px-4 py-2.5 border-r border-slate-200">
                原文与原图证据（第 {currentPageIndex + 1} 页）
              </div>
              <div className="px-4 py-2.5">专业译文与结构化重建</div>
            </div>

            {sortedObjects.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <p className="text-sm text-slate-500">
                  当前页尚未执行识别与翻译。请点击顶部「开始翻译」或下方按钮启动本页翻译。
                </p>
                <button
                  type="button"
                  onClick={() => onReprocessPage(currentPageIndex)}
                  disabled={isProcessing}
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-40 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Languages className="w-3.5 h-3.5" />
                  {isProcessing ? '正在翻译...' : '立即识别并翻译本页'}
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {sortedObjects.map((obj) => {
                  const isSelected = obj.objectId === selectedObjectId;
                  return (
                    <div
                      key={obj.objectId}
                      onClick={() => onSelectObject(obj.objectId)}
                      className={`grid grid-cols-2 cursor-pointer transition-colors ${
                        isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <div className="p-4 border-r border-slate-200 space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                          <span>#{obj.readingOrder} · {obj.objectType} · {obj.strategy}</span>
                          <span>
                            {obj.confidence !== null ? `${Math.round(obj.confidence * 100)}%` : 'UNKNOWN'}
                          </span>
                        </div>
                        {obj.rawImageDataUrl && (
                          <img
                            src={obj.rawImageDataUrl}
                            alt={obj.objectType}
                            className="max-h-48 border border-slate-200 rounded bg-white object-contain"
                            referrerPolicy="no-referrer"
                          />
                        )}
                        {obj.rawText && (
                          <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                            {obj.rawText}
                          </p>
                        )}
                        {obj.formulaData?.latex && (
                          <pre className="text-[11px] font-mono bg-slate-100 p-2 rounded text-indigo-800 overflow-x-auto">
                            {obj.formulaData.latex}
                          </pre>
                        )}
                      </div>

                      <div className="p-4 space-y-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500 font-mono">{obj.sourceType}</span>
                          {obj.review.reviewStatus === 'APPROVED' ? (
                            <span className="text-emerald-700 flex items-center gap-1 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              已确认
                            </span>
                          ) : obj.status === ObjectStatus.NEEDS_REVIEW ? (
                            <span className="text-amber-700 flex items-center gap-1 font-medium">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              待复核
                            </span>
                          ) : null}
                        </div>

                        {obj.reconstructedImageDataUrl && (
                          <div className="space-y-1">
                            <div className="text-[11px] font-medium text-blue-700">
                              译文重建图表（原位翻译）
                            </div>
                            <img
                              src={obj.reconstructedImageDataUrl}
                              alt="译文重建图表"
                              className="w-full max-h-96 border border-blue-200 rounded bg-white object-contain"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        )}

                        {obj.tableData ? (
                          <div className="overflow-x-auto border border-slate-200 rounded">
                            <table className="w-full text-xs border-collapse">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                  {(obj.tableData.translatedHeaders || obj.tableData.headers).map(
                                    (h, i) => (
                                      <th
                                        key={i}
                                        className="px-2 py-1.5 text-left font-semibold text-slate-800 border-r last:border-r-0 border-slate-200"
                                      >
                                        {h}
                                      </th>
                                    )
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {(obj.tableData.translatedRows || obj.tableData.rows).map(
                                  (row, rIdx) => (
                                    <tr key={rIdx} className="border-b last:border-b-0 border-slate-200">
                                      {row.map((cell, cIdx) => (
                                        <td
                                          key={cIdx}
                                          className="px-2 py-1.5 text-slate-700 border-r last:border-r-0 border-slate-200 tabular-nums"
                                        >
                                          {cell}
                                        </td>
                                      ))}
                                    </tr>
                                  )
                                )}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-sm text-slate-900 whitespace-pre-wrap leading-relaxed">
                            {obj.translatedText ||
                              (obj.reconstructedImageDataUrl
                                ? ''
                                : obj.objectType === ObjectType.FORMULA
                                  ? '（公式对象保留原图与 LaTeX 结构）'
                                  : '（尚未翻译）')}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {viewMode === 'objects' && (
          <div className="max-w-4xl mx-auto bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left font-semibold">顺序</th>
                  <th className="px-3 py-2 text-left font-semibold">对象类型</th>
                  <th className="px-3 py-2 text-left font-semibold">策略</th>
                  <th className="px-3 py-2 text-left font-semibold">来源</th>
                  <th className="px-3 py-2 text-right font-semibold">置信度</th>
                  <th className="px-3 py-2 text-left font-semibold">状态</th>
                  <th className="px-3 py-2 text-left font-semibold">摘要</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {sortedObjects.map((obj) => (
                  <tr
                    key={obj.objectId}
                    onClick={() => onSelectObject(obj.objectId)}
                    className={`cursor-pointer ${
                      obj.objectId === selectedObjectId
                        ? 'bg-blue-50'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="px-3 py-2 font-mono tabular-nums">#{obj.readingOrder}</td>
                    <td className="px-3 py-2 font-mono">{obj.objectType}</td>
                    <td className="px-3 py-2 font-mono">{obj.strategy}</td>
                    <td className="px-3 py-2 text-slate-600">{obj.sourceType}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {obj.confidence !== null ? `${Math.round(obj.confidence * 100)}%` : 'UNKNOWN'}
                    </td>
                    <td className="px-3 py-2">{obj.review.reviewStatus}</td>
                    <td className="px-3 py-2 text-slate-600 max-w-xs truncate">
                      {obj.rawText || obj.formulaData?.latex || obj.chartData?.title || '图形对象'}
                    </td>
                  </tr>
                ))}
                {sortedObjects.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      当前页暂无已识别对象
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};
