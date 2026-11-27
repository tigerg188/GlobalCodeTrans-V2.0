import React, { useState } from 'react';
import {
  X,
  Gauge,
  CheckCircle2,
  Activity,
  RefreshCw,
  AlertCircle,
  Edit3,
} from 'lucide-react';
import type { ModelDashboardResponse, FreeModelEntry } from '../../engines/adapters/gemini/GeminiAdapter';

interface ModelDashboardModalProps {
  isOpen: boolean;
  dashboard: ModelDashboardResponse | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSelectActiveModel: (modelId: string) => Promise<void>;
  onTestModel: (modelId: string) => Promise<{ ok: boolean; message: string }>;
  onUpdateQuotaLimit: (modelId: string, limit: number) => Promise<void>;
}

export const ModelDashboardModal: React.FC<ModelDashboardModalProps> = ({
  isOpen,
  dashboard,
  onClose,
  onRefresh,
  onSelectActiveModel,
  onTestModel,
  onUpdateQuotaLimit,
}) => {
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
  const [editingLimitId, setEditingLimitId] = useState<string | null>(null);
  const [limitDraft, setLimitDraft] = useState<string>('');
  const [testNotice, setTestNotice] = useState<{ ok: boolean; text: string } | null>(null);

  if (!isOpen) return null;

  const handleTest = async (modelId: string) => {
    setTestingModelId(modelId);
    setTestNotice(null);
    try {
      const res = await onTestModel(modelId);
      setTestNotice({ ok: res.ok, text: res.message });
    } finally {
      setTestingModelId(null);
    }
  };

  const handleSelect = async (modelId: string) => {
    setSwitchingModelId(modelId);
    setTestNotice(null);
    try {
      await onSelectActiveModel(modelId);
    } finally {
      setSwitchingModelId(null);
    }
  };

  const handleSaveLimit = async (modelId: string) => {
    const val = Number(limitDraft);
    if (!Number.isFinite(val) || val < 1) return;
    await onUpdateQuotaLimit(modelId, Math.round(val));
    setEditingLimitId(null);
  };

  const renderQuotaBar = (entry: FreeModelEntry) => {
    const pct = Math.min(
      100,
      Math.round((entry.usage.requestsToday / Math.max(1, entry.dailyQuotaLimit)) * 100)
    );
    const barColor =
      pct >= 90 ? 'bg-red-600' : pct >= 70 ? 'bg-amber-500' : 'bg-blue-600';
    return (
      <div className="w-full space-y-1">
        <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
          <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-500">
          <span>
            已用 {entry.usage.requestsToday} / {entry.dailyQuotaLimit} 次
          </span>
          <span>参考余量 {entry.remainingReference}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-5xl max-h-[88vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Gauge className="w-4 h-4 text-blue-700" />
            <h2
              className="text-sm font-semibold text-slate-900"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              模型目录与本应用当日调用统计看板
            </h2>
            {dashboard && (
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                · 统计日期 {dashboard.date}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              刷新统计
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-slate-500 hover:text-slate-800 rounded cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Summary Strip */}
        {dashboard && (
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 grid grid-cols-2 sm:grid-cols-5 gap-3 shrink-0">
            <div>
              <div className="text-[11px] text-slate-500">当前主力模型</div>
              <div className="text-xs font-semibold font-mono text-blue-700 mt-0.5 truncate">
                {dashboard.activeModel}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">免费模型总数</div>
              <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {dashboard.summary.freeModelCount} 个（文档可用 {dashboard.summary.pipelineModelCount} 个）
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">当日总调用次数</div>
              <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {dashboard.summary.totalRequestsToday} 次（成功 {dashboard.summary.totalSuccessToday}）
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">当日失败 / 限流</div>
              <div
                className={`text-sm font-semibold font-mono tabular-nums mt-0.5 ${
                  dashboard.summary.totalErrorsToday > 0 ? 'text-red-700' : 'text-slate-900'
                }`}
              >
                {dashboard.summary.totalErrorsToday} 次
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">当日累计 Token 消耗</div>
              <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {dashboard.summary.totalTokensToday.toLocaleString()}
              </div>
            </div>
          </div>
        )}

        {/* Honest Quota Explanation + Test Result */}
        <div className="px-5 py-2.5 border-b border-slate-200 bg-white space-y-2 shrink-0">
          <p className="text-[11px] text-slate-600 leading-relaxed">
            说明：已按当前服务端配置收录参考模型目录（仅文档流水线模型支持在本看板实测连通性，其余专用模态为仅预留配置、未实测连通）。调用次数、成功/失败数与 Token 消耗为本应用当日真实调用统计；因标准 API Key 不提供远程剩余配额查询接口，每日额度上限为本地参考限额（支持点击「改限额」调整本地参考差额阈值）。当主模型高负载（503）或限流（429）时，可切换或自动回退至 <span className="font-mono text-slate-800">gemini-3.1-flash-lite</span>。
          </p>
          {testNotice && (
            <div
              className={`px-3 py-2 rounded border text-xs flex items-center gap-2 ${
                testNotice.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              {testNotice.ok ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{testNotice.text}</span>
            </div>
          )}
        </div>

        {/* Model Table */}
        <div className="flex-1 overflow-y-auto p-5">
          {!dashboard ? (
            <div className="py-12 text-center text-xs text-slate-500">正在加载免费模型看板数据...</div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="px-3 py-2.5 text-left font-semibold">模型标识与模态</th>
                    <th className="px-3 py-2.5 text-left font-semibold">职责与工作台适配</th>
                    <th className="px-3 py-2.5 text-left font-semibold w-52">本应用当日调用统计 / 本地参考限额</th>
                    <th className="px-3 py-2.5 text-right font-semibold">当日 Token (输入/输出)</th>
                    <th className="px-3 py-2.5 text-right font-semibold">最近延迟 / 状态</th>
                    <th className="px-3 py-2.5 text-right font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {dashboard.models.map((entry) => (
                    <tr
                      key={entry.modelId}
                      className={entry.isActive ? 'bg-blue-50/50' : 'hover:bg-slate-50/70'}
                    >
                      <td className="px-3 py-3 align-top space-y-1">
                        <div className="font-mono font-semibold text-slate-900 flex items-center gap-1.5">
                          <span>{entry.modelId}</span>
                          {entry.isActive && (
                            <span className="text-[10px] font-sans font-semibold text-blue-700">
                              [当前启用]
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-600">{entry.displayName}</div>
                        <div className="text-[10px] text-slate-500">{entry.modality}</div>
                      </td>

                      <td className="px-3 py-3 align-top space-y-1 max-w-xs">
                        <div className="text-slate-800 font-medium">{entry.role}</div>
                        <div className="text-[11px] text-slate-500 leading-snug">{entry.notes}</div>
                        <div className="text-[10px] font-mono text-slate-500">
                          参考速率：{entry.rpmReference} RPM
                        </div>
                      </td>

                      <td className="px-3 py-3 align-top space-y-1.5">
                        {renderQuotaBar(entry)}
                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono tabular-nums">
                          <span>
                            成功 {entry.usage.successToday} · 限流/503 {entry.usage.rateLimitedToday}
                          </span>
                          {editingLimitId === entry.modelId ? (
                            <span className="flex items-center gap-1">
                              <input
                                type="number"
                                min={1}
                                max={100000}
                                value={limitDraft}
                                onChange={(e) => setLimitDraft(e.target.value)}
                                className="w-14 px-1 py-0.5 border border-blue-500 rounded text-[10px] bg-white"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveLimit(entry.modelId)}
                                className="text-blue-700 font-semibold cursor-pointer"
                              >
                                保存
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingLimitId(entry.modelId);
                                setLimitDraft(String(entry.dailyQuotaLimit));
                              }}
                              className="text-slate-500 hover:text-blue-700 flex items-center gap-0.5 cursor-pointer"
                              title="调整本地当日参考上限"
                            >
                              <Edit3 className="w-2.5 h-2.5" />
                              改限额
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="px-3 py-3 align-top text-right font-mono tabular-nums text-slate-700">
                        <div>{entry.usage.totalTokensToday.toLocaleString()}</div>
                        <div className="text-[10px] text-slate-500">
                          {entry.usage.promptTokensToday.toLocaleString()} /{' '}
                          {entry.usage.outputTokensToday.toLocaleString()}
                        </div>
                      </td>

                      <td className="px-3 py-3 align-top text-right font-mono tabular-nums">
                        <div className="text-slate-800">
                          {entry.usage.lastLatencyMs !== null
                            ? `${entry.usage.lastLatencyMs} ms`
                            : '未调用'}
                        </div>
                        {entry.usage.lastError && (
                          <div
                            className="text-[10px] text-red-600 max-w-[160px] ml-auto truncate"
                            title={entry.usage.lastError}
                          >
                            {entry.usage.lastError}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-3 align-top text-right whitespace-nowrap">
                        {entry.supportsDocumentPipeline ? (
                          <div className="flex flex-col items-end gap-1.5">
                            <button
                              type="button"
                              disabled={entry.isActive || switchingModelId === entry.modelId}
                              onClick={() => handleSelect(entry.modelId)}
                              className={`px-2.5 py-1 text-[11px] font-medium rounded border cursor-pointer ${
                                entry.isActive
                                  ? 'bg-blue-700 text-white border-blue-700 opacity-90 cursor-default'
                                  : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              {entry.isActive
                                ? '当前使用中'
                                : switchingModelId === entry.modelId
                                  ? '切换中...'
                                  : '设为主力模型'}
                            </button>
                            <button
                              type="button"
                              disabled={testingModelId === entry.modelId}
                              onClick={() => handleTest(entry.modelId)}
                              className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded flex items-center gap-1 cursor-pointer disabled:opacity-40"
                            >
                              <Activity className="w-3 h-3" />
                              {testingModelId === entry.modelId ? '探测中...' : '实测连通性'}
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">仅预留配置（未实测连通）</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
