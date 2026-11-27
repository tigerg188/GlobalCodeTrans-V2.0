import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  Pause,
  Save,
  FileDown,
  BookOpen,
  FileText,
  AlertCircle,
  CheckCircle2,
  Trash2,
  FolderOpen,
  AlertTriangle,
  Gauge,
  Languages,
} from 'lucide-react';
import type { DocumentIR, DocumentObjectIR } from './domain/document/DocumentIR';
import {
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES,
  type LanguageCode,
  type TerminologyEntry,
} from './domain/translation/TranslationTypes';
import {
  TaskStage,
  type DocxExportMode,
  type EngineRecord,
  type ProcessingTask,
} from './domain/task/TaskTypes';
import { engineRegistry } from './engines/registry/EngineRegistry';
import {
  geminiAdapter,
  type ModelDashboardResponse,
  type ServerHealthResponse,
} from './engines/adapters/gemini/GeminiAdapter';
import { pdfJsAdapter, type LoadedPdfHandle } from './engines/adapters/pdfjs/PdfJsAdapter';
import { docxExportAdapter } from './engines/adapters/docx/DocxExportAdapter';
import { pdfExportAdapter } from './engines/adapters/pdf/PdfExportAdapter';
import { documentPipeline } from './application/workflows/DocumentPipeline';
import { qualityGateService } from './application/services/QualityGateService';
import { storageAdapter, type SavedTaskSummary } from './infrastructure/storage/IndexedDbAdapter';
import { DocumentPreviewPane, type CenterViewMode } from './ui/features/DocumentPreviewPane';
import { InspectorPane } from './ui/features/InspectorPane';
import { TerminologyModal } from './ui/features/TerminologyModal';
import { ExportModal, type ExportFormat } from './ui/features/ExportModal';
import { ModelDashboardModal } from './ui/features/ModelDashboardModal';

interface WorkspaceSession {
  document: DocumentIR;
  task: ProcessingTask;
  fileBuffer?: ArrayBuffer;
  pdfHandle?: LoadedPdfHandle;
}

const STAGE_LABELS: Record<TaskStage, string> = {
  [TaskStage.IDLE]: '待启动',
  [TaskStage.IMPORTING]: '导入文件中',
  [TaskStage.NATIVE_PARSING]: 'PDF.js 原生解析',
  [TaskStage.VISION_ANALYZING]: '多模态视觉识别',
  [TaskStage.TRANSLATING]: '专业翻译中',
  [TaskStage.QUALITY_CHECKING]: '质量检查中',
  [TaskStage.READY_FOR_REVIEW]: '待人工审校',
  [TaskStage.EXPORTING_DOCX]: '生成 Word 中',
  [TaskStage.COMPLETED]: '处理完成',
  [TaskStage.PAUSED]: '已暂停',
  [TaskStage.FAILED]: '执行异常',
};

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pauseRequestedRef = useRef(false);

  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [savedTasks, setSavedTasks] = useState<SavedTaskSummary[]>([]);

  const [sourceLanguage, setSourceLanguage] = useState<LanguageCode>('auto');
  const [targetLanguage, setTargetLanguage] = useState<LanguageCode>('zh');
  const [domainHint, setDomainHint] = useState<string>('工程建设与设备技术文档');

  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const [showBoxes, setShowBoxes] = useState(true);
  const [centerViewMode, setCenterViewMode] = useState<CenterViewMode>('overlay');

  const [isProcessing, setIsProcessing] = useState(false);
  const [isVerifyingRegion, setIsVerifyingRegion] = useState(false);
  const [translatingObjectId, setTranslatingObjectId] = useState<string | null>(null);
  const [reconstructingObjectId, setReconstructingObjectId] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);

  const [terminology, setTerminology] = useState<TerminologyEntry[]>([]);
  const [isTerminologyOpen, setIsTerminologyOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isModelDashboardOpen, setIsModelDashboardOpen] = useState(false);
  const [modelDashboard, setModelDashboard] = useState<ModelDashboardResponse | null>(null);

  const [engines, setEngines] = useState<EngineRecord[]>(engineRegistry.getAll());
  const [health, setHealth] = useState<ServerHealthResponse | null>(null);
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'info' | 'error' | 'success';
    text: string;
  } | null>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.document.documentId === activeDocId) ?? null,
    [sessions, activeDocId]
  );

  const activeDoc = activeSession?.document ?? null;
  const activeTask = activeSession?.task ?? null;

  const selectedObject = useMemo(() => {
    if (!activeDoc) return null;
    for (const p of activeDoc.pages) {
      const found = p.objects.find((o) => o.objectId === selectedObjectId);
      if (found) return found;
    }
    return null;
  }, [activeDoc, selectedObjectId]);

  const qualitySummary = useMemo(() => {
    if (!activeDoc) {
      return {
        items: [],
        errorCount: 0,
        warningCount: 0,
        needsReviewCount: 0,
        translatedObjectCount: 0,
        totalTranslatableCount: 0,
      };
    }
    return qualityGateService.evaluateDocument(activeDoc);
  }, [activeDoc]);

  useEffect(() => {
    const unsub = engineRegistry.subscribe(setEngines);
    geminiAdapter
      .checkHealth()
      .then(setHealth)
      .catch((err) => {
        setBannerMessage({
          type: 'error',
          text: `后端服务健康检查失败：${err instanceof Error ? err.message : String(err)}`,
        });
      });

    geminiAdapter
      .getModelDashboard()
      .then(setModelDashboard)
      .catch(() => {});

    storageAdapter
      .listSavedTasks()
      .then(setSavedTasks)
      .catch(() => {});

    storageAdapter
      .loadTerminology()
      .then(setTerminology)
      .catch(() => {});

    return unsub;
  }, []);

  const refreshModelDashboard = async () => {
    try {
      const next = await geminiAdapter.getModelDashboard();
      setModelDashboard(next);
    } catch {
      // Ignore silent refresh failures
    }
  };

  const updateSession = (
    documentId: string,
    updater: (prev: WorkspaceSession) => WorkspaceSession
  ) => {
    setSessions((prev) =>
      prev.map((s) => (s.document.documentId === documentId ? updater(s) : s))
    );
  };

  const ensurePreviewForPage = async (pageIndex: number) => {
    const sess = sessions.find((s) => s.document.documentId === activeDocId);
    if (!sess || !sess.pdfHandle) return;
    const targetPage = sess.document.pages[pageIndex];
    if (!targetPage || targetPage.renderInfo.previewDataUrl) return;
    try {
      const updatedPage = await documentPipeline.ensurePagePreview(
        targetPage,
        sess.pdfHandle,
        1.5
      );
      if (!updatedPage.renderInfo.previewDataUrl) return;
      updateSession(sess.document.documentId, (prev) => ({
        ...prev,
        document: {
          ...prev.document,
          pages: prev.document.pages.map((p, idx) =>
            idx === pageIndex ? updatedPage : p
          ),
        },
      }));
    } catch {
      // Non-fatal: preview will render during processing
    }
  };

  useEffect(() => {
    if (!activeSession?.pdfHandle) return;
    const targetPage = activeSession.document.pages[currentPageIndex];
    if (targetPage && !targetPage.renderInfo.previewDataUrl) {
      ensurePreviewForPage(currentPageIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocId, currentPageIndex, activeSession?.pdfHandle]);

  const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setBannerMessage(null);
    const importedIds: string[] = [];
    for (const file of Array.from(fileList)) {
      try {
        const bundle = await documentPipeline.importFile(
          file,
          sourceLanguage,
          targetLanguage,
          domainHint
        );
        setSessions((prev) => [...prev, bundle]);
        importedIds.push(bundle.document.documentId);
      } catch (err) {
        setBannerMessage({
          type: 'error',
          text: `导入 ${file.name} 失败：${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    if (importedIds.length > 0) {
      setActiveDocId(importedIds[0]);
      setCurrentPageIndex(0);
      setSelectedObjectId(null);
      setBannerMessage({
        type: 'success',
        text: `已成功导入 ${importedIds.length} 份文件并完成原生结构预检。`,
      });
    }
    e.target.value = '';
  };

  const handleStartProcessing = async () => {
    if (isProcessing) return;
    if (!activeSession) {
      setBannerMessage({
        type: 'info',
        text: '请先点击「导入文件」选择需要翻译的 PDF 或图像文件，然后点击「开始翻译」。',
      });
      return;
    }

    pauseRequestedRef.current = false;
    setIsProcessing(true);
    setBannerMessage(null);

    const docId = activeSession.document.documentId;
    let workingDoc = activeSession.document;
    const languageChanged =
      workingDoc.pages.some((p) => p.parseStatus === 'TRANSLATED') &&
      (activeSession.task.targetLanguage !== targetLanguage ||
        activeSession.task.sourceLanguage !== sourceLanguage);
    const allAlreadyTranslated = workingDoc.pages.every((p) => p.parseStatus === 'TRANSLATED');
    const shouldForceRetranslate = languageChanged || allAlreadyTranslated;

    let workingTask: ProcessingTask = {
      ...activeSession.task,
      sourceLanguage,
      targetLanguage,
      domainHint,
      status: 'RUNNING',
      currentStage: TaskStage.VISION_ANALYZING,
      lastError: undefined,
    };

    updateSession(docId, (s) => ({ ...s, task: workingTask }));

    try {
      for (let i = 0; i < workingDoc.pageCount; i++) {
        if (pauseRequestedRef.current) {
          workingTask = {
            ...workingTask,
            status: 'PAUSED',
            currentStage: TaskStage.PAUSED,
            logs: [
              ...workingTask.logs,
              documentPipeline.createLog(
                workingTask.taskId,
                TaskStage.PAUSED,
                'TaskManager',
                'pause',
                'WARN',
                `用户于第 ${i + 1} 页前暂停任务`
              ),
            ],
          };
          updateSession(docId, (s) => ({ ...s, task: workingTask }));
          setIsProcessing(false);
          return;
        }

        // Skip already translated pages only when resuming a partial run with same language
        if (!shouldForceRetranslate && workingDoc.pages[i].parseStatus === 'TRANSLATED') {
          continue;
        }

        setCurrentPageIndex(i);
        workingTask = {
          ...workingTask,
          currentStage: TaskStage.VISION_ANALYZING,
        };
        updateSession(docId, (s) => ({ ...s, task: workingTask }));

        try {
          const { page, newEvidences, newRelations, logs } = await documentPipeline.processSinglePage(
            workingDoc,
            workingTask,
            i,
            terminology,
            activeSession.pdfHandle,
            shouldForceRetranslate
          );

          const nextPages = workingDoc.pages.map((p, idx) => (idx === i ? page : p));
          const mergedRelations = [
            ...workingDoc.relations.filter(
              (r) => !newRelations.some((nr) => nr.relationId === r.relationId)
            ),
            ...newRelations,
          ];
          workingDoc = {
            ...workingDoc,
            pages: nextPages,
            evidences: { ...workingDoc.evidences, ...newEvidences },
            relations: mergedRelations,
            updatedAt: new Date().toISOString(),
            status: 'ANALYZED',
          };

          workingTask = documentPipeline.refreshTaskMetrics(workingDoc, {
            ...workingTask,
            logs: [...workingTask.logs, ...logs],
          });

          updateSession(docId, (s) => ({
            ...s,
            document: workingDoc,
            task: workingTask,
          }));
        } catch (pageErr) {
          const errMsg = pageErr instanceof Error ? pageErr.message : String(pageErr);
          const nextPages = workingDoc.pages.map((p, idx) =>
            idx === i ? { ...p, parseStatus: 'FAILED' as const, errorMessage: errMsg } : p
          );
          workingDoc = { ...workingDoc, pages: nextPages };
          workingTask = {
            ...workingTask,
            errorCount: workingTask.errorCount + 1,
            lastError: `第 ${i + 1} 页失败：${errMsg}`,
            logs: [
              ...workingTask.logs,
              documentPipeline.createLog(
                workingTask.taskId,
                TaskStage.VISION_ANALYZING,
                'DocumentPipeline',
                'processSinglePage',
                'FAIL',
                `第 ${i + 1} 页处理失败：${errMsg}`,
                { pageIndex: i }
              ),
            ],
          };
          updateSession(docId, (s) => ({
            ...s,
            document: workingDoc,
            task: workingTask,
          }));
        }
      }

      const finalQuality = qualityGateService.evaluateDocument(workingDoc);
      const hasFailedPages = workingDoc.pages.some((p) => p.parseStatus === 'FAILED');
      const hasErrors = hasFailedPages || finalQuality.errorCount > 0;

      workingDoc = {
        ...workingDoc,
        status: hasFailedPages ? 'FAILED' : 'READY',
        updatedAt: new Date().toISOString(),
      };
      workingTask = {
        ...documentPipeline.refreshTaskMetrics(workingDoc, workingTask),
        status: hasErrors ? 'PARTIAL_ERROR' : 'COMPLETED',
        currentStage:
          finalQuality.needsReviewCount > 0 || finalQuality.errorCount > 0
            ? TaskStage.READY_FOR_REVIEW
            : TaskStage.COMPLETED,
      };

      updateSession(docId, (s) => ({
        ...s,
        document: workingDoc,
        task: workingTask,
      }));

      setBannerMessage({
        type: hasErrors ? 'error' : 'success',
        text: hasFailedPages
          ? `任务部分完成：存在页面解析或翻译错误，请查看底部状态与右侧日志。`
          : finalQuality.errorCount > 0
            ? `处理完成，但质量检查发现 ${finalQuality.errorCount} 项数值/表格结构异常（${finalQuality.needsReviewCount} 项待审校），请点击右下角或「质量检查」核对。`
            : `全文档处理完成（共 ${workingDoc.pageCount} 页，${finalQuality.translatedObjectCount} 个对象已翻译，${finalQuality.needsReviewCount} 项待人工核对）。`,
      });
    } finally {
      setIsProcessing(false);
      refreshModelDashboard();
    }
  };

  const handleReprocessPage = async (pageIndex: number) => {
    if (!activeSession || isProcessing) return;
    setIsProcessing(true);
    setBannerMessage(null);
    try {
      const targetPage = activeSession.document.pages[pageIndex];
      const forceRetranslate =
        targetPage?.parseStatus === 'TRANSLATED' ||
        activeSession.task.targetLanguage !== targetLanguage;

      const { page, newEvidences, newRelations, logs } = await documentPipeline.processSinglePage(
        activeSession.document,
        { ...activeSession.task, sourceLanguage, targetLanguage, domainHint },
        pageIndex,
        terminology,
        activeSession.pdfHandle,
        forceRetranslate
      );

      const mergedRelations = [
        ...activeSession.document.relations.filter(
          (r) => !newRelations.some((nr) => nr.relationId === r.relationId)
        ),
        ...newRelations,
      ];

      const nextDoc: DocumentIR = {
        ...activeSession.document,
        pages: activeSession.document.pages.map((p, idx) => (idx === pageIndex ? page : p)),
        evidences: { ...activeSession.document.evidences, ...newEvidences },
        relations: mergedRelations,
        updatedAt: new Date().toISOString(),
      };
      const nextTask = documentPipeline.refreshTaskMetrics(nextDoc, {
        ...activeSession.task,
        logs: [...activeSession.task.logs, ...logs],
      });
      updateSession(nextDoc.documentId, (s) => ({
        ...s,
        document: nextDoc,
        task: nextTask,
      }));
      setBannerMessage({ type: 'success', text: `第 ${pageIndex + 1} 页重处理完成。` });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: `第 ${pageIndex + 1} 页重处理失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsProcessing(false);
      refreshModelDashboard();
    }
  };

  const handleUpdateObject = (
    objectId: string,
    updater: (obj: DocumentObjectIR) => DocumentObjectIR
  ) => {
    if (!activeSession) return;
    const nextPages = activeSession.document.pages.map((p) => ({
      ...p,
      objects: p.objects.map((o) => (o.objectId === objectId ? updater(o) : o)),
    }));
    const nextDoc: DocumentIR = {
      ...activeSession.document,
      pages: nextPages,
      updatedAt: new Date().toISOString(),
    };
    const nextTask = documentPipeline.refreshTaskMetrics(nextDoc, activeSession.task);
    updateSession(nextDoc.documentId, (s) => ({
      ...s,
      document: nextDoc,
      task: nextTask,
    }));
  };

  const handleDeepVerifyObject = async (pageIndex: number, objectId: string) => {
    if (!activeSession || isVerifyingRegion) return;
    setIsVerifyingRegion(true);
    try {
      const updated = await documentPipeline.deepVerifyObject(
        activeSession.document,
        pageIndex,
        objectId,
        sourceLanguage
      );
      handleUpdateObject(objectId, () => updated);
      setBannerMessage({ type: 'success', text: '局部高精视觉重识别完成，请对照原图确认结果。' });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: `局部重识别失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsVerifyingRegion(false);
      refreshModelDashboard();
    }
  };

  const handleTranslateSingleObject = async (objectId: string) => {
    if (!activeSession || translatingObjectId) return;
    const targetObj = activeSession.document.pages
      .flatMap((p) => p.objects)
      .find((o) => o.objectId === objectId);
    if (!targetObj) return;

    setTranslatingObjectId(objectId);
    setBannerMessage(null);
    try {
      const updated = await documentPipeline.translateSingleObject(
        activeSession.document,
        { sourceLanguage, targetLanguage, domainHint },
        targetObj,
        terminology
      );
      handleUpdateObject(objectId, () => updated);
      setBannerMessage({ type: 'success', text: '该段落/对象译文已更新。' });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: `单段翻译失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setTranslatingObjectId(null);
      refreshModelDashboard();
    }
  };

  const handleRebuildDiagram = async (objectId: string) => {
    if (!activeSession) return;
    const targetObj = activeSession.document.pages
      .flatMap((p) => p.objects)
      .find((o) => o.objectId === objectId);
    if (!targetObj) return;

    try {
      const updated = await documentPipeline.rebuildDiagramFromOverlays(targetObj);
      handleUpdateObject(objectId, () => updated);
      setBannerMessage({ type: 'success', text: '已按最新标注译文重新渲染重建图表。' });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: `图表重绘失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleExperimentalReconstruct = async (pageIndex: number, objectId: string) => {
    if (!activeSession || reconstructingObjectId) return;
    setReconstructingObjectId(objectId);
    setBannerMessage(null);
    try {
      const updated = await documentPipeline.runExperimentalDiagramReconstruction(
        activeSession.document,
        pageIndex,
        objectId,
        { sourceLanguage, targetLanguage, domainHint },
        terminology
      );
      handleUpdateObject(objectId, () => updated);
      setBannerMessage({
        type: 'info',
        text: '已生成试验性重绘图，请对照原图核对并点击「确认通过」后方可在导出中替换原图。',
      });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: `试验性图表重绘失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setReconstructingObjectId(null);
      refreshModelDashboard();
    }
  };

  const handleSaveTask = async () => {
    if (!activeSession) return;
    try {
      await storageAdapter.saveSnapshot(
        activeSession.document,
        activeSession.task,
        activeSession.fileBuffer
      );
      const list = await storageAdapter.listSavedTasks();
      setSavedTasks(list);
      setBannerMessage({ type: 'success', text: '任务与 Document IR 已保存至本地持久化存储。' });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: `保存任务失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleRestoreSavedTask = async (taskId: string) => {
    try {
      const bundle = await storageAdapter.loadTaskBundle(taskId);
      if (!bundle) {
        setBannerMessage({ type: 'error', text: '未找到已保存的任务快照。' });
        return;
      }

      let pdfHandle: LoadedPdfHandle | undefined;
      if (bundle.document.fileType === 'pdf' && bundle.file?.buffer) {
        pdfHandle = await pdfJsAdapter.openPdf(bundle.file.buffer);
      }

      const existingIdx = sessions.findIndex(
        (s) => s.document.documentId === bundle.document.documentId
      );
      const restored: WorkspaceSession = {
        document: bundle.document,
        task: bundle.task,
        fileBuffer: bundle.file?.buffer,
        pdfHandle,
      };

      if (existingIdx >= 0) {
        setSessions((prev) => prev.map((s, idx) => (idx === existingIdx ? restored : s)));
      } else {
        setSessions((prev) => [...prev, restored]);
      }

      setActiveDocId(bundle.document.documentId);
      setCurrentPageIndex(0);
      setSelectedObjectId(null);
      setSourceLanguage((bundle.task.sourceLanguage as LanguageCode) || 'auto');
      setTargetLanguage((bundle.task.targetLanguage as LanguageCode) || 'zh');
      setBannerMessage({ type: 'success', text: `已恢复任务：${bundle.document.sourceFileName}` });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: `恢复任务失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleDeleteSavedTask = async (taskId: string, documentId: string) => {
    await storageAdapter.deleteTaskBundle(taskId, documentId);
    const list = await storageAdapter.listSavedTasks();
    setSavedTasks(list);
  };

  const handleExportResult = async (format: ExportFormat, mode: DocxExportMode) => {
    if (!activeDoc || exportingFormat) return;
    setExportingFormat(format);
    try {
      const targetLabel =
        TARGET_LANGUAGES.find((l) => l.code === targetLanguage)?.label || targetLanguage;
      const blob =
        format === 'pdf'
          ? await pdfExportAdapter.exportDocument(activeDoc, mode, targetLabel)
          : await docxExportAdapter.exportDocument(activeDoc, mode, targetLabel);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const baseName = activeDoc.sourceFileName.replace(/\.[^.]+$/, '');
      a.href = url;
      a.download = `${baseName}_${targetLanguage}_${mode}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setIsExportOpen(false);
      setBannerMessage({
        type: 'success',
        text: `${format === 'pdf' ? 'PDF' : 'Word'} 成果文档 (${a.download}) 已生成并开始下载。`,
      });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: `${format === 'pdf' ? 'PDF' : 'Word'} 导出失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setExportingFormat(null);
    }
  };

  const handleSaveTerminology = async (entries: TerminologyEntry[]) => {
    setTerminology(entries);
    await storageAdapter.saveTerminology(entries);
  };

  const handleJumpToNextReview = () => {
    if (!activeDoc) return;
    for (const page of activeDoc.pages) {
      for (const obj of page.objects) {
        if (obj.review.reviewStatus === 'NEEDS_REVIEW') {
          setCurrentPageIndex(page.pageIndex);
          setSelectedObjectId(obj.objectId);
          return;
        }
      }
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-50 text-slate-900">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,image/png,image/jpeg,image/webp"
        onChange={handleImportFiles}
        className="hidden"
      />

      {/* Top Action Bar */}
      <header className="min-h-13 py-2 px-4 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 shrink-0">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <span
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            GlobalCodeTrans
          </span>

          <span className="h-5 w-px bg-slate-200 shrink-0 hidden sm:inline-block" />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            导入文件
          </button>

          <div className="flex items-center gap-1.5 text-xs shrink-0">
            <label className="text-slate-500 whitespace-nowrap">源语言</label>
            <select
              value={sourceLanguage}
              onChange={(e) => setSourceLanguage(e.target.value as LanguageCode)}
              className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-blue-600 max-w-[138px]"
            >
              {SOURCE_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} ({l.nativeLabel})
                </option>
              ))}
            </select>

            <span className="text-slate-400">→</span>

            <label className="text-slate-500 whitespace-nowrap">目标语言</label>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value as LanguageCode)}
              className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-blue-600 max-w-[138px]"
            >
              {TARGET_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} ({l.nativeLabel})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <input
              type="text"
              value={domainHint}
              onChange={(e) => setDomainHint(e.target.value)}
              placeholder="专业领域提示 (如: 电力设备/化工可研)"
              className="w-40 sm:w-44 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
              title="专业领域与标准语境提示"
            />
            <button
              type="button"
              onClick={() => {
                refreshModelDashboard();
                setIsModelDashboardOpen(true);
              }}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              title="查看全部免费大模型与当日实时调用额度"
            >
              <Gauge className="w-3.5 h-3.5 text-blue-700 shrink-0" />
              <span>大模型看板</span>
              {modelDashboard && (
                <span className="text-[11px] font-mono tabular-nums text-blue-700">
                  ({modelDashboard.summary.totalRequestsToday})
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsTerminologyOpen(true)}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            术语库 ({terminology.length})
          </button>

          {!isProcessing ? (
            <button
              type="button"
              onClick={handleStartProcessing}
              className={`px-3.5 py-1.5 text-xs font-medium text-white rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeSession
                  ? 'bg-blue-700 hover:bg-blue-800'
                  : 'bg-blue-700/80 hover:bg-blue-700'
              }`}
              title={
                activeSession
                  ? '对当前文档执行多模态识别与专业翻译'
                  : '请先导入文件后再开始翻译'
              }
            >
              <Languages className="w-3.5 h-3.5" />
              {activeDoc && activeDoc.pages.every((p) => p.parseStatus === 'TRANSLATED')
                ? '重新翻译'
                : activeTask && activeTask.completedPages > 0
                  ? '继续翻译'
                  : '开始翻译'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                pauseRequestedRef.current = true;
              }}
              className="px-3.5 py-1.5 text-xs font-medium text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Pause className="w-3.5 h-3.5" />
              暂停翻译
            </button>
          )}

          <button
            type="button"
            disabled={!activeSession}
            onClick={handleSaveTask}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            保存任务
          </button>

          <button
            type="button"
            disabled={!activeDoc}
            onClick={() => setIsExportOpen(true)}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 disabled:opacity-40 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            导出成果
          </button>
        </div>
      </header>

      {/* Real Feedback Banner (if any) */}
      {bannerMessage && (
        <div
          className={`px-4 py-2 text-xs flex items-center justify-between border-b shrink-0 ${
            bannerMessage.type === 'error'
              ? 'bg-red-50 text-red-800 border-red-200'
              : bannerMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-blue-50 text-blue-800 border-blue-200'
          }`}
        >
          <span className="flex items-center gap-2">
            {bannerMessage.type === 'error' ? (
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{bannerMessage.text}</span>
            {!activeSession && bannerMessage.type === 'info' && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-2 py-0.5 text-[11px] font-medium bg-blue-700 text-white rounded hover:bg-blue-800 cursor-pointer"
              >
                立即导入文件
              </button>
            )}
          </span>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="text-xs underline ml-4 cursor-pointer"
          >
            关闭
          </button>
        </div>
      )}

      {/* Main Three-Column Workbench */}
      <main className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Sidebar: Files, Saved Tasks & Page Directory */}
        <aside className="w-68 shrink-0 bg-white border-r border-slate-200 flex flex-col min-h-0">
          {/* Imported File List */}
          <div className="p-3 border-b border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-800">当前工作区文件</h3>
              <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                {sessions.length} 份
              </span>
            </div>

            {sessions.length === 0 ? (
              <p className="text-[11px] text-slate-500 leading-relaxed">
                尚未选择文件。支持 PDF、PNG、JPG、WEBP。
              </p>
            ) : (
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {sessions.map((s) => {
                  const isActive = s.document.documentId === activeDocId;
                  return (
                    <button
                      key={s.document.documentId}
                      type="button"
                      onClick={() => {
                        setActiveDocId(s.document.documentId);
                        setCurrentPageIndex(0);
                        setSelectedObjectId(null);
                      }}
                      className={`w-full text-left px-2.5 py-2 rounded border text-xs transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-blue-50/70 border-blue-400 text-slate-900'
                          : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="font-medium truncate flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span className="truncate">{s.document.sourceFileName}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500 font-mono tabular-nums">
                        {s.document.pageCount} 页 · {s.task.completedPages}/{s.task.totalPages} 已处理
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Page Directory */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 border-b border-slate-200">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-800">页面目录与分类</h3>
              {activeDoc && (
                <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                  {activeDoc.pageCount} 页
                </span>
              )}
            </div>

            {!activeDoc ? (
              <div className="py-6 text-center text-[11px] text-slate-400">暂无页面</div>
            ) : (
              <div className="space-y-1.5">
                {activeDoc.pages.map((p) => {
                  const isCurrent = p.pageIndex === currentPageIndex;
                  return (
                    <button
                      key={p.pageId}
                      type="button"
                      onClick={() => {
                        setCurrentPageIndex(p.pageIndex);
                        setSelectedObjectId(null);
                      }}
                      className={`w-full text-left p-2 rounded border text-xs transition-colors cursor-pointer ${
                        isCurrent
                          ? 'border-blue-600 bg-blue-50/60'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between font-mono tabular-nums">
                        <span className="font-semibold text-slate-900">
                          第 {p.pageIndex + 1} 页
                        </span>
                        <span
                          className={`text-[10px] ${
                            p.parseStatus === 'TRANSLATED'
                              ? 'text-emerald-700'
                              : p.parseStatus === 'FAILED'
                                ? 'text-red-700'
                                : 'text-slate-500'
                          }`}
                        >
                          {p.parseStatus}
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] text-slate-500 font-mono truncate">
                        {p.tags.join(' · ')}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500 font-mono tabular-nums">
                        文本 {p.nativeStats.textItemCount} · 矢量 {p.nativeStats.vectorOpCount} · 对象 {p.objects.length}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Saved Tasks Recovery */}
          <div className="p-3 bg-slate-50/70 max-h-48 overflow-y-auto space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                <FolderOpen className="w-3.5 h-3.5 text-slate-500" />
                已保存任务 ({savedTasks.length})
              </h3>
            </div>
            {savedTasks.length === 0 ? (
              <p className="text-[11px] text-slate-400">点击顶部「保存任务」可持久化至本地。</p>
            ) : (
              <div className="space-y-1">
                {savedTasks.map((item) => (
                  <div
                    key={item.task.taskId}
                    className="flex items-center justify-between gap-1 px-2 py-1.5 bg-white border border-slate-200 rounded text-[11px]"
                  >
                    <button
                      type="button"
                      onClick={() => handleRestoreSavedTask(item.task.taskId)}
                      className="text-left min-w-0 flex-1 hover:text-blue-700 cursor-pointer"
                    >
                      <div className="font-medium truncate">{item.fileName}</div>
                      <div className="text-[10px] text-slate-500 font-mono tabular-nums">
                        {item.task.completedPages}/{item.pageCount} 页 ·{' '}
                        {new Date(item.task.updatedAt).toLocaleDateString()}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSavedTask(item.task.taskId, item.task.documentId)}
                      className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                      title="删除保存记录"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Center Pane: Document Preview & Bilingual View */}
        <DocumentPreviewPane
          document={activeDoc}
          currentPageIndex={currentPageIndex}
          selectedObjectId={selectedObjectId}
          zoom={zoom}
          showBoxes={showBoxes}
          viewMode={centerViewMode}
          onPageChange={(idx) => {
            setCurrentPageIndex(idx);
            setSelectedObjectId(null);
          }}
          onSelectObject={setSelectedObjectId}
          onZoomChange={setZoom}
          onToggleBoxes={() => setShowBoxes((v) => !v)}
          onViewModeChange={setCenterViewMode}
          onReprocessPage={handleReprocessPage}
          onEnsurePagePreview={ensurePreviewForPage}
          onImportFile={() => fileInputRef.current?.click()}
          isProcessing={isProcessing}
        />

        {/* Right Pane: Object Inspector, Quality Gate & Engine Telemetry */}
        <InspectorPane
          document={activeDoc}
          selectedObject={selectedObject}
          qualityItems={qualitySummary.items}
          engines={engines}
          logs={activeTask?.logs ?? []}
          onUpdateObject={handleUpdateObject}
          onDeepVerifyObject={handleDeepVerifyObject}
          onTranslateObject={handleTranslateSingleObject}
          onRebuildDiagram={handleRebuildDiagram}
          onExperimentalReconstruct={handleExperimentalReconstruct}
          onJumpToObject={(pIdx, objId) => {
            setCurrentPageIndex(pIdx);
            setSelectedObjectId(objId);
          }}
          isVerifyingRegion={isVerifyingRegion}
          translatingObjectId={translatingObjectId}
          reconstructingObjectId={reconstructingObjectId}
        />
      </main>

      {/* Bottom Real Status Bar */}
      <footer className="h-9 px-4 bg-white border-t border-slate-200 flex items-center justify-between text-xs text-slate-600 shrink-0">
        <div className="flex items-center gap-4 font-mono tabular-nums">
          <span>
            阶段：
            <strong className="text-slate-900 font-medium">
              {activeTask ? STAGE_LABELS[activeTask.currentStage] : '等待导入'}
            </strong>
          </span>
          <span>·</span>
          <span>
            页面进度：
            {activeTask
              ? `${activeTask.completedPages} / ${activeTask.totalPages} 页 (${
                  activeTask.totalPages > 0
                    ? Math.round((activeTask.completedPages / activeTask.totalPages) * 100)
                    : 0
                }%)`
              : '0 / 0 页'}
          </span>
          <span>·</span>
          <span>
            Gemini API：
            {health === null
              ? '检测中'
              : health.geminiConfigured
                ? `已连接 (${modelDashboard?.activeModel || health.model})`
                : '未检测到 GEMINI_API_KEY'}
          </span>
          {modelDashboard && (
            <>
              <span>·</span>
              <span>当日调用 {modelDashboard.summary.totalRequestsToday} 次</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-4 font-mono tabular-nums">
          {activeTask && activeTask.errorCount > 0 && (
            <span className="text-red-700 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              错误/告警: {activeTask.errorCount}
            </span>
          )}
          <button
            type="button"
            disabled={qualitySummary.needsReviewCount === 0}
            onClick={handleJumpToNextReview}
            className={`flex items-center gap-1 cursor-pointer disabled:cursor-default ${
              qualitySummary.needsReviewCount > 0
                ? 'text-amber-700 hover:underline font-medium'
                : 'text-slate-500'
            }`}
          >
            {qualitySummary.needsReviewCount > 0 && <AlertTriangle className="w-3.5 h-3.5" />}
            待人工复核对象: {qualitySummary.needsReviewCount}
          </button>
        </div>
      </footer>

      {/* Modals */}
      <TerminologyModal
        isOpen={isTerminologyOpen}
        entries={terminology}
        sourceLanguage={sourceLanguage}
        targetLanguage={targetLanguage}
        onClose={() => setIsTerminologyOpen(false)}
        onSaveEntries={handleSaveTerminology}
      />

      <ModelDashboardModal
        isOpen={isModelDashboardOpen}
        dashboard={modelDashboard}
        onClose={() => setIsModelDashboardOpen(false)}
        onRefresh={refreshModelDashboard}
        onSelectActiveModel={async (modelId) => {
          const updated = await geminiAdapter.selectActiveModel(modelId);
          setModelDashboard(updated);
          setBannerMessage({
            type: 'success',
            text: `已将主力模型切换为 ${updated.activeModel}。`,
          });
        }}
        onTestModel={async (modelId) => {
          const res = await geminiAdapter.testModelConnectivity(modelId);
          if (res.dashboard) {
            setModelDashboard(res.dashboard);
          } else {
            await refreshModelDashboard();
          }
          return { ok: res.ok, message: res.message };
        }}
        onUpdateQuotaLimit={async (modelId, limit) => {
          const updated = await geminiAdapter.updateModelQuotaLimit(modelId, limit);
          setModelDashboard(updated);
        }}
      />

      {activeDoc && (
        <ExportModal
          isOpen={isExportOpen}
          fileName={activeDoc.sourceFileName}
          quality={qualitySummary}
          exportingFormat={exportingFormat}
          onClose={() => setIsExportOpen(false)}
          onExport={handleExportResult}
        />
      )}
    </div>
  );
}
