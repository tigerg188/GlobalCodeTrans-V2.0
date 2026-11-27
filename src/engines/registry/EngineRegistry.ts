import { EngineRuntimeState, type EngineRecord } from '../../domain/task/TaskTypes';

type Listener = (records: EngineRecord[]) => void;

const INITIAL_ENGINES: EngineRecord[] = [
  {
    engineId: 'pdfjs-native',
    displayName: 'PDF.js 原生解析与渲染引擎',
    category: 'PARSER',
    state: EngineRuntimeState.DECLARED,
    version: 'pdfjs-dist@6.5',
    callCount: 0,
    successCount: 0,
    errorCount: 0,
    capabilityNote: '提取 MediaBox/CropBox、旋转矩阵、原生文本变换、矢量路径操作与图像对象',
  },
  {
    engineId: 'geometry-affine',
    displayName: '仿射坐标变换与矢量网格引擎',
    category: 'GEOMETRY',
    state: EngineRuntimeState.DECLARED,
    version: '1.0.0',
    callCount: 0,
    successCount: 0,
    errorCount: 0,
    capabilityNote: 'PDF_USER_SPACE ↔ PDF_PAGE_SPACE ↔ VIEWPORT_SPACE 矩阵转换与原生矢量线段分析',
  },
  {
    engineId: 'gemini-vision-layout',
    displayName: 'Gemini 多模态版面 / OCR / 公式 / 图表引擎',
    category: 'VISION_LAYOUT',
    state: EngineRuntimeState.DECLARED,
    version: 'gemini-4-hydrogen',
    callCount: 0,
    successCount: 0,
    errorCount: 0,
    capabilityNote: '服务端代理调用，执行区域级版面识别、扫描件 OCR、公式 LaTeX 提取与图表语义解析',
  },
  {
    engineId: 'gemini-translator',
    displayName: 'Gemini 专业多语种翻译引擎',
    category: 'TRANSLATION',
    state: EngineRuntimeState.DECLARED,
    version: 'gemini-4-hydrogen',
    callCount: 0,
    successCount: 0,
    errorCount: 0,
    capabilityNote: '文档级上下文翻译、术语约束、数字/单位/标准编号保护与语义风险提示',
  },
  {
    engineId: 'docx-builder',
    displayName: 'DOCX 文档结构化重建引擎',
    category: 'DOCX_EXPORT',
    state: EngineRuntimeState.DECLARED,
    version: 'docx@9.16',
    callCount: 0,
    successCount: 0,
    errorCount: 0,
    capabilityNote: '支持双语对照、表格结构、公式表达、高分辨率原图保真保留及页眉页脚导出',
  },
  {
    engineId: 'pdf-builder',
    displayName: 'PDF 版式成果导出引擎',
    category: 'PDF_EXPORT',
    state: EngineRuntimeState.DECLARED,
    version: 'jspdf + Canvas2D',
    callCount: 0,
    successCount: 0,
    errorCount: 0,
    capabilityNote: '高分 A4 分页排版，原生支持中文/老挝语/英文混排、双栏对照、表格、公式与原图保真导出',
  },
];

class EngineRegistryService {
  private engines: Map<string, EngineRecord> = new Map();
  private listeners: Set<Listener> = new Set();

  constructor() {
    for (const e of INITIAL_ENGINES) {
      this.engines.set(e.engineId, { ...e });
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getAll());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.getAll();
    for (const l of this.listeners) {
      l(snapshot);
    }
  }

  getAll(): EngineRecord[] {
    return Array.from(this.engines.values()).map((e) => ({ ...e }));
  }

  get(engineId: string): EngineRecord | undefined {
    const item = this.engines.get(engineId);
    return item ? { ...item } : undefined;
  }

  markState(engineId: string, state: EngineRuntimeState, note?: string): void {
    const existing = this.engines.get(engineId);
    if (!existing) return;
    existing.state = state;
    if (note) existing.lastError = note;
    this.emit();
  }

  recordCallStart(engineId: string): void {
    const existing = this.engines.get(engineId);
    if (!existing) return;
    existing.state = EngineRuntimeState.CALLED;
    existing.callCount += 1;
    existing.lastCallAt = new Date().toISOString();
    this.emit();
  }

  recordCallSuccess(engineId: string, durationMs: number, outputValid: boolean): void {
    const existing = this.engines.get(engineId);
    if (!existing) return;
    existing.state = outputValid ? EngineRuntimeState.OUTPUT_VALID : EngineRuntimeState.EXECUTED;
    existing.successCount += 1;
    existing.lastDurationMs = durationMs;
    existing.lastError = undefined;
    this.emit();
  }

  recordCallError(engineId: string, durationMs: number, errorMessage: string): void {
    const existing = this.engines.get(engineId);
    if (!existing) return;
    existing.errorCount += 1;
    existing.lastDurationMs = durationMs;
    existing.lastError = errorMessage;
    this.emit();
  }
}

export const engineRegistry = new EngineRegistryService();
