import React, { useState } from 'react';
import { X, Plus, Trash2, BookOpen } from 'lucide-react';
import type { LanguageCode, TerminologyEntry } from '../../domain/translation/TranslationTypes';

interface TerminologyModalProps {
  isOpen: boolean;
  entries: TerminologyEntry[];
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  onClose: () => void;
  onSaveEntries: (entries: TerminologyEntry[]) => Promise<void>;
}

export const TerminologyModal: React.FC<TerminologyModalProps> = ({
  isOpen,
  entries,
  sourceLanguage,
  targetLanguage,
  onClose,
  onSaveEntries,
}) => {
  const [sourceTerm, setSourceTerm] = useState('');
  const [targetTerm, setTargetTerm] = useState('');
  const [domain, setDomain] = useState('机电与工程设备');
  const [preferred, setPreferred] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceTerm.trim() || !targetTerm.trim()) return;
    setIsSaving(true);
    try {
      const next: TerminologyEntry[] = [
        ...entries,
        {
          id: `term_${crypto.randomUUID().slice(0, 8)}`,
          sourceTerm: sourceTerm.trim(),
          targetTerm: targetTerm.trim(),
          sourceLanguage,
          targetLanguage,
          domain: domain.trim() || '通用工程',
          preferred,
          approvalStatus: 'APPROVED',
          version: 1,
        },
      ];
      await onSaveEntries(next);
      setSourceTerm('');
      setTargetTerm('');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const next = entries.filter((item) => item.id !== id);
    await onSaveEntries(next);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-lg">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-700" />
            <h2 className="text-sm font-semibold text-slate-900" style={{ fontFamily: 'var(--font-display)' }}>
              专业术语库管理（本地持久化）
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

        <form onSubmit={handleAdd} className="p-4 border-b border-slate-200 bg-slate-50 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <input
              type="text"
              value={sourceTerm}
              onChange={(e) => setSourceTerm(e.target.value)}
              placeholder="源语言术语 (如: 断路器 / Circuit Breaker)"
              className="px-3 py-2 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-blue-600"
            />
            <input
              type="text"
              value={targetTerm}
              onChange={(e) => setTargetTerm(e.target.value)}
              placeholder="目标译文 (如: 断路器 / ຕົວຕັດວົງຈອນ)"
              className="px-3 py-2 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-blue-600"
            />
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="所属专业域 (如: 电气 / 化工 / 机械)"
              className="px-3 py-2 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-blue-600"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={preferred}
                onChange={(e) => setPreferred(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              设为首选强制术语（取消勾选则标记为禁用参考）
            </label>
            <button
              type="submit"
              disabled={isSaving || !sourceTerm.trim() || !targetTerm.trim()}
              className="px-3.5 py-1.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-40 text-white text-xs font-medium rounded flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              添加术语
            </button>
          </div>
        </form>

        <div className="flex-1 overflow-y-auto p-4">
          {entries.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              当前术语库为空。添加术语后，系统将在调用 Gemini 翻译时注入上下文约束并检查一致性。
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2 text-left font-semibold">源术语</th>
                  <th className="py-2 text-left font-semibold">目标译文</th>
                  <th className="py-2 text-left font-semibold">专业领域</th>
                  <th className="py-2 text-left font-semibold">约束</th>
                  <th className="py-2 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="py-2 pr-2 font-medium text-slate-900">{entry.sourceTerm}</td>
                    <td className="py-2 pr-2 text-blue-800">{entry.targetTerm}</td>
                    <td className="py-2 pr-2 text-slate-600">{entry.domain}</td>
                    <td className="py-2 pr-2 text-slate-600">
                      {entry.preferred ? '首选' : '避免'}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(entry.id)}
                        className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
