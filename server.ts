import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_MODEL_ID = 'gemini-4-hydrogen';
const USAGE_FILE_PATH = path.join(os.tmpdir(), 'globalcodetrans_daily_usage.json');

interface FreeModelSpec {
  modelId: string;
  displayName: string;
  modality: string;
  role: string;
  supportsDocumentPipeline: boolean;
  defaultDailyQuotaLimit: number;
  rpmReference: number;
  notes: string;
}

const FREE_TIER_MODELS: FreeModelSpec[] = [
  {
    modelId: 'gemini-4-hydrogen',
    displayName: 'Gemini 4 Hydrogen (Flash)',
    modality: '文本 + 多模态视觉 + 结构化 JSON',
    role: '主力版面解析、公式/图表识别与专业翻译',
    supportsDocumentPipeline: true,
    defaultDailyQuotaLimit: 250,
    rpmReference: 10,
    notes: '免费层级可用，支持 ThinkingLevel.LOW/HIGH；默认工作台主力模型',
  },
  {
    modelId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash-Lite',
    modality: '文本 + 多模态视觉 + 结构化 JSON',
    role: '高配额轻量级解析与翻译备选（高并发/降级切换）',
    supportsDocumentPipeline: true,
    defaultDailyQuotaLimit: 1000,
    rpmReference: 15,
    notes: '免费层级可用，配额较高且延迟低，主模型限流或 503 时可即时切换',
  },
  {
    modelId: 'gemini-embedding-2',
    displayName: 'Gemini Embedding 2',
    modality: '多模态向量嵌入 (Embedding)',
    role: '术语库语义匹配与资料室向量检索（预留）',
    supportsDocumentPipeline: false,
    defaultDailyQuotaLimit: 1500,
    rpmReference: 100,
    notes: '免费层级可用；当前版本工作台尚未绑定该模态接口',
  },
  {
    modelId: 'gemini-decision-1',
    displayName: 'Gemini Decision 1',
    modality: 'Decisions API (校准分类/评分)',
    role: '文档质量准则二分类与置信度校准（预留）',
    supportsDocumentPipeline: false,
    defaultDailyQuotaLimit: 500,
    rpmReference: 15,
    notes: '免费层级可用；需 ai.decisions.create 调用，当前工作台尚未接入',
  },
  {
    modelId: 'gemini-3.5-transcribe',
    displayName: 'Gemini 3.5 Transcribe',
    modality: '音频转写 (Audio-to-Text)',
    role: '现场工程会议/设备验收录音转文字（预留）',
    supportsDocumentPipeline: false,
    defaultDailyQuotaLimit: 250,
    rpmReference: 10,
    notes: '免费层级可用；音频模态，不用于 PDF/图像文档解析',
  },
  {
    modelId: 'gemini-3.8-flash-lite-tts',
    displayName: 'Gemini 3.8 Flash-Lite TTS',
    modality: '单人语音合成 (Text-to-Speech)',
    role: '译文朗读与无障碍语音播报（预留）',
    supportsDocumentPipeline: false,
    defaultDailyQuotaLimit: 250,
    rpmReference: 10,
    notes: '免费层级可用；语音输出模态',
  },
  {
    modelId: 'gemini-3.8-flash-tts',
    displayName: 'Gemini 3.8 Flash TTS',
    modality: '多角色/高表现力语音合成 (TTS)',
    role: '双语对照语音简报生成（预留）',
    supportsDocumentPipeline: false,
    defaultDailyQuotaLimit: 100,
    rpmReference: 5,
    notes: '免费层级可用；语音输出模态',
  },
  {
    modelId: 'gemini-3.8-live',
    displayName: 'Gemini 3.8 Live',
    modality: '实时音视频双向流 (Live API)',
    role: '实时现场勘察视频与语音助手（预留）',
    supportsDocumentPipeline: false,
    defaultDailyQuotaLimit: 100,
    rpmReference: 5,
    notes: '免费层级可用；WebSocket 实时流模态',
  },
  {
    modelId: 'gemini-3.8-live-extended-thinking',
    displayName: 'Gemini 3.8 Live Extended Thinking',
    modality: '实时深度推理语音流 (Live API)',
    role: '复杂现场问题实时推理指导（预留）',
    supportsDocumentPipeline: false,
    defaultDailyQuotaLimit: 50,
    rpmReference: 3,
    notes: '免费层级可用；WebSocket 实时流模态',
  },
  {
    modelId: 'gemini-3.5-transcribe-live',
    displayName: 'Gemini 3.5 Transcribe Live',
    modality: '实时流式语音识别 (Live API)',
    role: '跨境工程会议实时字幕记录（预留）',
    supportsDocumentPipeline: false,
    defaultDailyQuotaLimit: 100,
    rpmReference: 5,
    notes: '免费层级可用；实时音频输入模态',
  },
  {
    modelId: 'gemini-3.5-live-translate-preview',
    displayName: 'Gemini 3.5 Live Translate Preview',
    modality: '实时语音同传 (Live API)',
    role: '跨境技术沟通实时语音同声传译（预留）',
    supportsDocumentPipeline: false,
    defaultDailyQuotaLimit: 100,
    rpmReference: 5,
    notes: '免费层级可用；实时语音对语音模态',
  },
];

const PIPELINE_MODEL_IDS = new Set(
  FREE_TIER_MODELS.filter((m) => m.supportsDocumentPipeline).map((m) => m.modelId)
);

interface DailyModelUsage {
  requestsToday: number;
  successToday: number;
  errorsToday: number;
  rateLimitedToday: number;
  promptTokensToday: number;
  outputTokensToday: number;
  totalTokensToday: number;
  lastLatencyMs: number | null;
  lastUsedAt: string | null;
  lastError: string | null;
}

interface QuotaStoreState {
  date: string;
  activeModel: string;
  customLimits: Record<string, number>;
  usage: Record<string, DailyModelUsage>;
}

function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function createEmptyUsage(): DailyModelUsage {
  return {
    requestsToday: 0,
    successToday: 0,
    errorsToday: 0,
    rateLimitedToday: 0,
    promptTokensToday: 0,
    outputTokensToday: 0,
    totalTokensToday: 0,
    lastLatencyMs: null,
    lastUsedAt: null,
    lastError: null,
  };
}

function loadQuotaStore(): QuotaStoreState {
  const today = getTodayDateString();
  try {
    if (fs.existsSync(USAGE_FILE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(USAGE_FILE_PATH, 'utf-8')) as QuotaStoreState;
      const activeModel = PIPELINE_MODEL_IDS.has(raw.activeModel)
        ? raw.activeModel
        : DEFAULT_MODEL_ID;
      if (raw.date === today) {
        return {
          date: today,
          activeModel,
          customLimits: raw.customLimits || {},
          usage: raw.usage || {},
        };
      }
      // New day: preserve activeModel & customLimits, reset daily counters
      return {
        date: today,
        activeModel,
        customLimits: raw.customLimits || {},
        usage: {},
      };
    }
  } catch {
    // Fallback to clean store
  }
  return {
    date: today,
    activeModel: DEFAULT_MODEL_ID,
    customLimits: {},
    usage: {},
  };
}

let quotaStore: QuotaStoreState = loadQuotaStore();

function ensureTodayStore(): QuotaStoreState {
  const today = getTodayDateString();
  if (quotaStore.date !== today) {
    quotaStore = {
      date: today,
      activeModel: quotaStore.activeModel,
      customLimits: quotaStore.customLimits,
      usage: {},
    };
    saveQuotaStore();
  }
  return quotaStore;
}

function saveQuotaStore(): void {
  try {
    fs.writeFileSync(USAGE_FILE_PATH, JSON.stringify(quotaStore, null, 2), 'utf-8');
  } catch (err) {
    console.error('[QuotaStore] Failed to persist daily usage:', err);
  }
}

function resolvePipelineModel(requestedModel?: string): string {
  ensureTodayStore();
  if (requestedModel && PIPELINE_MODEL_IDS.has(requestedModel)) {
    return requestedModel;
  }
  return quotaStore.activeModel;
}

function recordModelCallResult(params: {
  modelId: string;
  success: boolean;
  durationMs: number;
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  errorMsg?: string;
  isRateOrUnavailable?: boolean;
}): void {
  const store = ensureTodayStore();
  const entry = store.usage[params.modelId] ?? createEmptyUsage();
  entry.requestsToday += 1;
  entry.lastLatencyMs = params.durationMs;
  entry.lastUsedAt = new Date().toISOString();

  if (params.success) {
    entry.successToday += 1;
    entry.lastError = null;
    entry.promptTokensToday += params.promptTokens ?? 0;
    entry.outputTokensToday += params.outputTokens ?? 0;
    entry.totalTokensToday +=
      params.totalTokens ?? (params.promptTokens ?? 0) + (params.outputTokens ?? 0);
  } else {
    entry.errorsToday += 1;
    if (params.isRateOrUnavailable) {
      entry.rateLimitedToday += 1;
    }
    entry.lastError = params.errorMsg ?? 'Unknown error';
  }

  store.usage[params.modelId] = entry;
  saveQuotaStore();
}

function buildDashboardPayload() {
  const store = ensureTodayStore();
  let totalRequestsToday = 0;
  let totalSuccessToday = 0;
  let totalErrorsToday = 0;
  let totalTokensToday = 0;

  const models = FREE_TIER_MODELS.map((spec) => {
    const usage = store.usage[spec.modelId] ?? createEmptyUsage();
    const dailyQuotaLimit = store.customLimits[spec.modelId] ?? spec.defaultDailyQuotaLimit;
    totalRequestsToday += usage.requestsToday;
    totalSuccessToday += usage.successToday;
    totalErrorsToday += usage.errorsToday;
    totalTokensToday += usage.totalTokensToday;

    return {
      ...spec,
      isActive: store.activeModel === spec.modelId,
      dailyQuotaLimit,
      remainingReference: Math.max(0, dailyQuotaLimit - usage.requestsToday),
      usage,
    };
  });

  return {
    date: store.date,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    activeModel: store.activeModel,
    models,
    summary: {
      freeModelCount: FREE_TIER_MODELS.length,
      pipelineModelCount: PIPELINE_MODEL_IDS.size,
      totalRequestsToday,
      totalSuccessToday,
      totalErrorsToday,
      totalTokensToday,
    },
  };
}

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildThinkingConfig(modelId: string) {
  if (modelId === 'gemini-4-hydrogen') {
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  return undefined;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 1): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Gemini] attempt ${attempt + 1} failed:`, msg);
      const isRetryable =
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('503') ||
        msg.includes('500') ||
        msg.includes('UNAVAILABLE');
      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }
      const delayMs = 600 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

const FALLBACK_MODEL_ID = 'gemini-3.1-flash-lite';

async function executePipelineCall(
  primaryModelId: string,
  allowAutoFallback: boolean,
  runForModel: (modelId: string) => Promise<{
    text?: string;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  }>
): Promise<{
  modelId: string;
  durationMs: number;
  text: string;
  fallbackFrom?: string;
}> {
  const t0 = Date.now();
  try {
    const response = await withRetry(() => runForModel(primaryModelId), 1);
    const durationMs = Date.now() - t0;
    const usageMeta = response.usageMetadata;
    recordModelCallResult({
      modelId: primaryModelId,
      success: true,
      durationMs,
      promptTokens: usageMeta?.promptTokenCount,
      outputTokens: usageMeta?.candidatesTokenCount,
      totalTokens: usageMeta?.totalTokenCount,
    });
    return {
      modelId: primaryModelId,
      durationMs,
      text: (response.text ?? '{}').trim(),
    };
  } catch (err: unknown) {
    const primaryDuration = Date.now() - t0;
    const formatted = formatApiError(err, primaryModelId);
    const isRateOrUnavailable = formatted.status === 429 || formatted.status === 503;
    recordModelCallResult({
      modelId: primaryModelId,
      success: false,
      durationMs: primaryDuration,
      errorMsg: formatted.message,
      isRateOrUnavailable,
    });

    if (allowAutoFallback && isRateOrUnavailable && primaryModelId !== FALLBACK_MODEL_ID) {
      const tFallback = Date.now();
      try {
        const fbResponse = await withRetry(() => runForModel(FALLBACK_MODEL_ID), 1);
        const fbDuration = Date.now() - tFallback;
        const fbUsage = fbResponse.usageMetadata;
        recordModelCallResult({
          modelId: FALLBACK_MODEL_ID,
          success: true,
          durationMs: fbDuration,
          promptTokens: fbUsage?.promptTokenCount,
          outputTokens: fbUsage?.candidatesTokenCount,
          totalTokens: fbUsage?.totalTokenCount,
        });
        return {
          modelId: FALLBACK_MODEL_ID,
          durationMs: primaryDuration + fbDuration,
          text: (fbResponse.text ?? '{}').trim(),
          fallbackFrom: primaryModelId,
        };
      } catch (fbErr: unknown) {
        const fbDuration = Date.now() - tFallback;
        const fbFormatted = formatApiError(fbErr, FALLBACK_MODEL_ID);
        recordModelCallResult({
          modelId: FALLBACK_MODEL_ID,
          success: false,
          durationMs: fbDuration,
          errorMsg: fbFormatted.message,
          isRateOrUnavailable: fbFormatted.status === 429 || fbFormatted.status === 503,
        });
        throw { formatted: fbFormatted, durationMs: primaryDuration + fbDuration };
      }
    }

    throw { formatted, durationMs: primaryDuration };
  }
}

function formatApiError(err: unknown, modelId: string): { status: number; code: string; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('GEMINI_API_KEY is not configured')) {
    return {
      status: 503,
      code: 'API_KEY_MISSING',
      message: '未检测到服务器端 GEMINI_API_KEY，请在 AI Studio Settings > Secrets 中配置后再试。',
    };
  }
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return {
      status: 403,
      code: 'API_KEY_INVALID',
      message: 'Gemini API Key 无效或权限不足，请检查 Secrets 配置。',
    };
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      code: 'RATE_LIMITED',
      message: `模型 ${modelId} 请求频次达到上限（429），已重试但仍受限，可在大模型看板切换至轻量模型或稍候继续。`,
    };
  }
  if (raw.includes('404') || raw.includes('NOT_FOUND')) {
    return {
      status: 404,
      code: 'MODEL_NOT_FOUND',
      message: `请求的模型 ${modelId} 不可用：${raw}`,
    };
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE')) {
    return {
      status: 503,
      code: 'MODEL_UNAVAILABLE',
      message: `模型 ${modelId} 当前负载较高（503 UNAVAILABLE），已自动重试但暂未恢复，可在大模型看板切换备选免费模型或稍候重试。`,
    };
  }
  return {
    status: 500,
    code: 'GEMINI_EXECUTION_ERROR',
    message: raw,
  };
}

interface NativeHintSummary {
  textSampleCount: number;
  vectorLineCount: number;
  imageCount: number;
  nativeTextSnippets: string[];
}

interface AnalyzePageBody {
  model?: string;
  pageIndex: number;
  imageBase64: string;
  mimeType?: string;
  pageWidthPt: number;
  pageHeightPt: number;
  sourceLanguage?: string;
  domainHint?: string;
  nativeHints?: NativeHintSummary;
}

interface TranslateUnitInput {
  id: string;
  objectType: string;
  protectedText: string;
  contextBefore?: string;
  contextAfter?: string;
  sectionHeading?: string;
}

interface TerminologyInput {
  sourceTerm: string;
  targetTerm: string;
  domain?: string;
  preferred?: boolean;
}

interface TranslateBody {
  model?: string;
  units: TranslateUnitInput[];
  sourceLanguage: string;
  targetLanguage: string;
  documentContext?: {
    title?: string;
    domain?: string;
    standardSystem?: string;
    summary?: string;
  };
  terminology?: TerminologyInput[];
}

interface VerifyRegionBody {
  model?: string;
  objectType: string;
  imageBase64: string;
  mimeType?: string;
  existingText?: string;
  sourceLanguage?: string;
}

interface ReconstructDiagramBody {
  model?: string;
  imageBase64: string;
  mimeType?: string;
  sourceLanguage?: string;
  targetLanguage: string;
  domainHint?: string;
  terminology?: TerminologyInput[];
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    const store = ensureTodayStore();
    res.json({
      ok: true,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      model: store.activeModel,
      runtime: 'node-express',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/models/dashboard', (_req: Request, res: Response) => {
    res.json(buildDashboardPayload());
  });

  app.post('/api/models/select', (req: Request, res: Response) => {
    const modelId = typeof req.body?.modelId === 'string' ? req.body.modelId : '';
    if (!PIPELINE_MODEL_IDS.has(modelId)) {
      res.status(400).json({
        code: 'UNSUPPORTED_PIPELINE_MODEL',
        message: `模型 ${modelId} 不支持当前文档多模态解析与翻译接口，仅可切换至：${Array.from(PIPELINE_MODEL_IDS).join(', ')}`,
      });
      return;
    }
    ensureTodayStore();
    quotaStore.activeModel = modelId;
    saveQuotaStore();
    res.json(buildDashboardPayload());
  });

  app.post('/api/models/quota-limit', (req: Request, res: Response) => {
    const modelId = typeof req.body?.modelId === 'string' ? req.body.modelId : '';
    const limit = Number(req.body?.dailyQuotaLimit);
    const exists = FREE_TIER_MODELS.some((m) => m.modelId === modelId);
    if (!exists || !Number.isFinite(limit) || limit < 1 || limit > 100000) {
      res.status(400).json({
        code: 'INVALID_QUOTA_LIMIT',
        message: '请提供有效的免费模型 ID 与正整数当日参考额度（1 - 100000）。',
      });
      return;
    }
    ensureTodayStore();
    quotaStore.customLimits[modelId] = Math.round(limit);
    saveQuotaStore();
    res.json(buildDashboardPayload());
  });

  app.post('/api/models/test', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const requested = typeof req.body?.modelId === 'string' ? req.body.modelId : '';
    if (!PIPELINE_MODEL_IDS.has(requested)) {
      res.status(400).json({
        code: 'UNSUPPORTED_TEST_MODEL',
        message: `模型 ${requested} 为专用模态模型，无法通过文本 generateContent 接口直接探活。`,
      });
      return;
    }

    try {
      const ai = createGeminiClient();
      const response = await ai.models.generateContent({
        model: requested,
        contents: 'Reply with exactly: OK',
        config: {
          thinkingConfig: buildThinkingConfig(requested),
        },
      });
      const durationMs = Date.now() - startTime;
      const usageMeta = response.usageMetadata;
      recordModelCallResult({
        modelId: requested,
        success: true,
        durationMs,
        promptTokens: usageMeta?.promptTokenCount,
        outputTokens: usageMeta?.candidatesTokenCount,
        totalTokens: usageMeta?.totalTokenCount,
      });
      res.json({
        ok: true,
        modelId: requested,
        durationMs,
        reply: (response.text ?? '').trim(),
        dashboard: buildDashboardPayload(),
      });
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const formatted = formatApiError(err, requested);
      recordModelCallResult({
        modelId: requested,
        success: false,
        durationMs,
        errorMsg: formatted.message,
        isRateOrUnavailable: formatted.status === 429 || formatted.status === 503,
      });
      res.status(formatted.status).json({
        ok: false,
        code: formatted.code,
        message: formatted.message,
        durationMs,
        dashboard: buildDashboardPayload(),
      });
    }
  });

  app.post('/api/gemini/analyze-page', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const body = req.body as AnalyzePageBody;
    const modelId = resolvePipelineModel(body?.model);
    try {
      if (!body || typeof body.imageBase64 !== 'string' || body.imageBase64.length < 32) {
        res.status(400).json({
          code: 'INVALID_INPUT',
          message: '缺少有效的页面渲染图像数据 (imageBase64)。',
        });
        return;
      }

      const ai = createGeminiClient();
      const mimeType = body.mimeType || 'image/jpeg';
      const cleanBase64 = body.imageBase64.replace(/^data:[^;]+;base64,/, '');

      const nativeContextStr = body.nativeHints
        ? `PDF.js 原生提取参考：文本片段数=${body.nativeHints.textSampleCount}，矢量线段/路径操作=${body.nativeHints.vectorLineCount}，嵌入图像数=${body.nativeHints.imageCount}。部分原生文本样本：${body.nativeHints.nativeTextSnippets.slice(0, 12).join(' | ')}`
        : '无 PDF 原生文本参考（图像或扫描件模式）。';

      const prompt = [
        `你是一个严谨的工程与技术文档版面结构与多模态解析引擎，正在分析第 ${(body.pageIndex ?? 0) + 1} 页（页面尺寸 ${body.pageWidthPt}x${body.pageHeightPt} pt）。`,
        `文档源语言提示：${body.sourceLanguage || 'auto'}；专业领域提示：${body.domainHint || '工程与设备技术文档'}。`,
        nativeContextStr,
        '请按阅读顺序识别该页中的所有主要语义区域与专业对象（如 HEADING, PARAGRAPH, LIST, TABLE, FORMULA, CHART, DIAGRAM, FLOWCHART, CAD_DRAWING, IMAGE, CAPTION, HEADER, FOOTER, FOOTNOTE, UNKNOWN）。',
        '严格要求：',
        '1. 坐标 bboxNormalized 必须采用 [ymin, xmin, ymax, xmax] 格式，范围 0 到 1000 的整数（相对于当前整页图像）。',
        '2. 禁止伪造或补全原图中看不清的数字、单位、尺寸、公式或曲线数据点。如果区域模糊、复杂工程图或存在歧义，请将 needsReview 设为 true 并说明 reviewReason。',
        '3. 对于工程纵断面图、施工图、工艺流程图、带下方参数带的图表（如上部分为曲线/断面图，下方紧连桩号/高程/坡度/平曲线参数表）：必须将整张图及其四周坐标刻度、图例、比例尺、标高基准（如 УГ = 125 м）与下方附属参数表带作为一个完整的 CAD_DRAWING 或 CHART 对象框出（bboxNormalized 必须包含最外层刻度数字与边框，宁可略宽勿裁切文字），不要把附属参数表带拆成独立的错位 TABLE！',
        '4. 对于独立 TABLE：tableHeaders 仅放顶部横向列头；如果是左侧为行标题的横向数据表，请将 tableHeaders 设为空数组 []，把行标题放入每行 tableRows[r][0]，确保所有行列数对齐，不要把行标题硬塞进 tableHeaders。',
        '5. 对于 FORMULA：仅在确认为独立或行内数学公式时标记为 FORMULA，不要将章节编号（如 1.2.3）、目录、普通标准号（如 ISO 128-1）或页码误判为 FORMULA；输出 latex 字符串及是否需复核。',
        '6. 对于 CHART / PLOT：提取图表类型、标题、xAxisLabel、yAxisLabel、legendItems 和可读出的关键数据点摘要（必须在 chartNote 中注明为“视觉模型估读，非精确矢量采样”）。',
        '7. 对于 CAD_DRAWING / FLOWCHART / DIAGRAM：保持图形整体边界，提取图中可辨识的关键标注文本列表（peripheralLabels），不重绘几何体。',
        '8. confidence 取值 0.0 到 1.0，必须反映真实清晰度与识别把握，禁止统一填固定值。',
      ].join('\n');

      const outcome = await executePipelineCall(modelId, !body?.model, (targetModel) =>
        ai.models.generateContent({
          model: targetModel,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: cleanBase64,
                },
              },
              { text: prompt },
            ],
          },
          config: {
            thinkingConfig: buildThinkingConfig(targetModel),
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                pageSummary: { type: Type.STRING },
                detectedLanguage: { type: Type.STRING },
                pageTitle: { type: Type.STRING },
                objects: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      objectType: {
                        type: Type.STRING,
                        description:
                          'One of HEADING, PARAGRAPH, LIST, TABLE, FORMULA, CHART, DIAGRAM, FLOWCHART, CAD_DRAWING, IMAGE, CAPTION, HEADER, FOOTER, FOOTNOTE, UNKNOWN',
                      },
                      readingOrder: { type: Type.INTEGER },
                      bboxNormalized: {
                        type: Type.ARRAY,
                        items: { type: Type.INTEGER },
                        description: '[ymin, xmin, ymax, xmax] in 0..1000',
                      },
                      rawText: { type: Type.STRING },
                      latex: { type: Type.STRING },
                      tableHeaders: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      tableRows: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                        },
                      },
                      chartTitle: { type: Type.STRING },
                      chartType: { type: Type.STRING },
                      xAxisLabel: { type: Type.STRING },
                      yAxisLabel: { type: Type.STRING },
                      legendItems: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      chartNote: { type: Type.STRING },
                      peripheralLabels: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      confidence: { type: Type.NUMBER },
                      needsReview: { type: Type.BOOLEAN },
                      reviewReason: { type: Type.STRING },
                    },
                    required: ['objectType', 'readingOrder', 'bboxNormalized', 'confidence', 'needsReview'],
                  },
                },
              },
              required: ['objects', 'detectedLanguage'],
            },
          },
        })
      );

      const parsed = JSON.parse(outcome.text);
      res.json({
        model: outcome.modelId,
        fallbackFrom: outcome.fallbackFrom,
        durationMs: outcome.durationMs,
        result: parsed,
      });
    } catch (err: unknown) {
      const wrapped = err as { formatted?: { status: number; code: string; message: string }; durationMs?: number };
      const formatted = wrapped?.formatted ?? formatApiError(err, modelId);
      const durationMs = wrapped?.durationMs ?? Date.now() - startTime;
      if (!wrapped?.formatted) {
        recordModelCallResult({
          modelId,
          success: false,
          durationMs,
          errorMsg: formatted.message,
          isRateOrUnavailable: formatted.status === 429 || formatted.status === 503,
        });
      }
      res.status(formatted.status).json({
        code: formatted.code,
        message: formatted.message,
        durationMs,
      });
    }
  });

  app.post('/api/gemini/translate', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const body = req.body as TranslateBody;
    const modelId = resolvePipelineModel(body?.model);
    try {
      if (!body || !Array.isArray(body.units) || body.units.length === 0) {
        res.status(400).json({
          code: 'INVALID_INPUT',
          message: '缺少待翻译的文本单元列表 (units)。',
        });
        return;
      }

      const ai = createGeminiClient();
      const glossaryText =
        body.terminology && body.terminology.length > 0
          ? body.terminology
              .map(
                (t) =>
                  `- "${t.sourceTerm}" => "${t.targetTerm}"${t.domain ? ` (${t.domain})` : ''}${t.preferred === false ? ' [禁用/避免]' : ' [首选]'}`
              )
              .join('\n')
          : '暂无预设术语表，请依据工程、设备、法律及国际标准（ISO/IEC/GB/ASME/DIN）惯例保持全篇术语高度一致。';

      const docCtx = body.documentContext
        ? `文档标题：${body.documentContext.title || '未知'}；专业领域：${body.documentContext.domain || '工程与技术资料'}；标准体系：${body.documentContext.standardSystem || '未指定'}；摘要：${body.documentContext.summary || '无'}`
        : '无额外文档级上下文';

      const prompt = [
        `你是一名资深跨境工程、设备制造、工业投资与法律技术专业翻译专家。`,
        `任务：将以下翻译单元从源语言 [${body.sourceLanguage}] 精准翻译为目标语言 [${body.targetLanguage}]。`,
        `文档上下文：${docCtx}`,
        `术语表约束：\n${glossaryText}`,
        '严格翻译与保真规范：',
        '1. 所有形如 [[GCT_...]] 的保护占位符必须原封不动保留在译文的正确语法位置，绝对禁止修改、翻译、删减或拆分占位符。',
        '2. 绝对禁止私自换算计量单位（如不得把 mm 换算成 inch，不得把 MPa 换算成 bar）或改变小数位数。',
        '3. 保留型号、标准号（ISO/IEC/GB/ASTM/DIN）、设备位号、否定词、安全警示（WARNING/CAUTION/DANGER）及法律责任边界。',
        '4. 如遇高风险语义（安全警告、公差限制、法律免责、电气参数、材料牌号），请在 riskFlags 中标出原因。',
        '5. 如果目标语言是老挝语（lo），请使用规范、正式的工业/法律/工程老挝语书面语，并保留必要的技术型号和标准编号原文。',
        '6. 输出必须与输入 units 的 id 一一对应，不遗漏、不合并、不重复。',
        '',
        '待翻译单元 JSON：',
        JSON.stringify(body.units),
      ].join('\n');

      const outcome = await executePipelineCall(modelId, !body?.model, (targetModel) =>
        ai.models.generateContent({
          model: targetModel,
          contents: prompt,
          config: {
            thinkingConfig: buildThinkingConfig(targetModel),
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                inferredDomain: { type: Type.STRING },
                inferredStandardSystem: { type: Type.STRING },
                translations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      targetText: { type: Type.STRING },
                      terminologyApplied: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      riskFlags: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      semanticNotes: { type: Type.STRING },
                      confidence: { type: Type.NUMBER },
                    },
                    required: ['id', 'targetText', 'confidence'],
                  },
                },
              },
              required: ['translations'],
            },
          },
        })
      );

      const parsed = JSON.parse(outcome.text);
      res.json({
        model: outcome.modelId,
        fallbackFrom: outcome.fallbackFrom,
        durationMs: outcome.durationMs,
        result: parsed,
      });
    } catch (err: unknown) {
      const wrapped = err as { formatted?: { status: number; code: string; message: string }; durationMs?: number };
      const formatted = wrapped?.formatted ?? formatApiError(err, modelId);
      const durationMs = wrapped?.durationMs ?? Date.now() - startTime;
      if (!wrapped?.formatted) {
        recordModelCallResult({
          modelId,
          success: false,
          durationMs,
          errorMsg: formatted.message,
          isRateOrUnavailable: formatted.status === 429 || formatted.status === 503,
        });
      }
      res.status(formatted.status).json({
        code: formatted.code,
        message: formatted.message,
        durationMs,
      });
    }
  });

  app.post('/api/gemini/verify-region', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const body = req.body as VerifyRegionBody;
    const modelId = resolvePipelineModel(body?.model);
    try {
      if (!body || typeof body.imageBase64 !== 'string' || body.imageBase64.length < 32) {
        res.status(400).json({
          code: 'INVALID_INPUT',
          message: '缺少区域裁剪图像数据 (imageBase64)。',
        });
        return;
      }

      const ai = createGeminiClient();
      const mimeType = body.mimeType || 'image/png';
      const cleanBase64 = body.imageBase64.replace(/^data:[^;]+;base64,/, '');

      const prompt = [
        `你正在对一个局部高精度裁剪区域进行专项结构复核。对象类型：${body.objectType}；源语言：${body.sourceLanguage || 'auto'}。`,
        body.existingText ? `已有初步提取文本参考：${body.existingText}` : '',
        '请仔细检查局部图像中的每一个字符、上下标、单位、正负号、小数点、表头结构或坐标刻度：',
        '- 如果是 FORMULA：输出精确的 LaTeX 表达式，并说明任何模糊字符。',
        '- 如果是 TABLE：输出完整准确的 headers 和 rows。',
        '- 如果是 CHART / PLOT：提取坐标轴标签、刻度范围、单位、图例及能清晰读出的关键点（明确标明为视觉读数，如有遮挡或模糊则标记 needsReview=true）。',
        '- 如果是 CAD_DRAWING / DIAGRAM：提取图中所有可辨识的尺寸标注、设备位号与注释文字，不编造任何不存在的尺寸。',
      ].join('\n');

      const outcome = await executePipelineCall(modelId, !body?.model, (targetModel) => {
        const verifyThinkingConfig =
          targetModel === 'gemini-4-hydrogen' ? { thinkingLevel: ThinkingLevel.MEDIUM } : undefined;
        return ai.models.generateContent({
          model: targetModel,
          contents: {
            parts: [
              { inlineData: { mimeType, data: cleanBase64 } },
              { text: prompt },
            ],
          },
          config: {
            thinkingConfig: verifyThinkingConfig,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                rawText: { type: Type.STRING },
                latex: { type: Type.STRING },
                tableHeaders: { type: Type.ARRAY, items: { type: Type.STRING } },
                tableRows: {
                  type: Type.ARRAY,
                  items: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                chartMeta: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    xAxis: { type: Type.STRING },
                    yAxis: { type: Type.STRING },
                    legends: { type: Type.ARRAY, items: { type: Type.STRING } },
                    notes: { type: Type.STRING },
                  },
                },
                peripheralLabels: { type: Type.ARRAY, items: { type: Type.STRING } },
                confidence: { type: Type.NUMBER },
                needsReview: { type: Type.BOOLEAN },
                reviewReason: { type: Type.STRING },
              },
              required: ['confidence', 'needsReview'],
            },
          },
        });
      });

      const parsed = JSON.parse(outcome.text);
      res.json({
        model: outcome.modelId,
        fallbackFrom: outcome.fallbackFrom,
        durationMs: outcome.durationMs,
        result: parsed,
      });
    } catch (err: unknown) {
      const wrapped = err as { formatted?: { status: number; code: string; message: string }; durationMs?: number };
      const formatted = wrapped?.formatted ?? formatApiError(err, modelId);
      const durationMs = wrapped?.durationMs ?? Date.now() - startTime;
      if (!wrapped?.formatted) {
        recordModelCallResult({
          modelId,
          success: false,
          durationMs,
          errorMsg: formatted.message,
          isRateOrUnavailable: formatted.status === 429 || formatted.status === 503,
        });
      }
      res.status(formatted.status).json({
        code: formatted.code,
        message: formatted.message,
        durationMs,
      });
    }
  });

  app.post('/api/gemini/reconstruct-diagram', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const body = req.body as ReconstructDiagramBody;
    const modelId = resolvePipelineModel(body?.model);
    try {
      if (!body || typeof body.imageBase64 !== 'string' || body.imageBase64.length < 32) {
        res.status(400).json({
          code: 'INVALID_INPUT',
          message: '缺少有效的图表图像数据 (imageBase64)。',
        });
        return;
      }

      const ai = createGeminiClient();
      const mimeType = body.mimeType || 'image/jpeg';
      const cleanBase64 = body.imageBase64.replace(/^data:[^;]+;base64,/, '');

      const glossaryText =
        body.terminology && body.terminology.length > 0
          ? body.terminology
              .map((t) => `- "${t.sourceTerm}" => "${t.targetTerm}"`)
              .join('\n')
          : '无额外术语表';

      const textPairSchema = {
        type: Type.OBJECT,
        properties: {
          source: { type: Type.STRING },
          translated: { type: Type.STRING },
        },
        required: ['source', 'translated'],
      };

      const prompt = [
        `你是一个专业工程图表全量解析、翻译与整图重建引擎。`,
        `严禁使用“在原图上盖补丁”的思路！你的任务是完整读取整张图表的几何数据、坐标轴、曲线折点、参数带/表格行、流程节点与所有文字标签，将全部非纯数字文字从源语言 [${body.sourceLanguage || 'auto'}] 精准翻译为目标语言 [${body.targetLanguage}]，输出完整的结构化图表重建规范，由前端从零绘制一张全新的矢量级高清图表。`,
        `专业领域：${body.domainHint || '工程建设与设备技术文档'}。`,
        `术语参考：\n${glossaryText}`,
        '',
        '请先判断图表类型 diagramKind（只能选其一：ENGINEERING_PROFILE | DATA_CHART | SCHEMATIC_DIAGRAM，并完整填充对应字段）：',
        '【类型 1：ENGINEERING_PROFILE】（纵断面图 / 地质剖面图 / 带有下方带状参数表的工程曲线图，如俄语 Профиль трассы 等）',
        '必须严格遵守以下数学与对齐规则提取 engineeringProfile：',
        '1. title, scaleLines, datumLabel 全部提供 {source, translated}（如 "Профиль трассы" -> "路线纵断面"，"Масштабы: гор.: 1:5000" -> "比例尺: 水平 1:5000"，"УГ = 125 м" -> "基准高程 = 125 米"）。',
        '2. 纵轴：提取 baselineValue（底线基准高程，如 125）、yMin（最低刻度如 126）、yMax（最高刻度如 135）、yStep（步长如 1）。',
        '3. 横轴总长度 totalLength 与里程桩 stations（必填）：根据桩号间距计算累计里程 xMeters（米）。例如桩号 0..8 每段 100m，则 totalLength=800，stations 为 [{label:"0",xMeters:0}, {label:"1",xMeters:100}, ..., {label:"8",xMeters:800}]。',
        '4. groundPoints（地面线全部折点，按 xMeters 升序，不得遗漏起点 xMeters=0 及中间拐点）与 designPoints（设计线/坡度线折点，按 xMeters 升序）：',
        '   - 必须依据下方“间距/距离”行逐段累加得到精确 xMeters！例如第0-1桩段标有 38, 62 则该段拐点位于 0, 38, 100。',
        '   - elevation 必须逐个核对地面高程行和设计高程行上的竖排数值（如 132.11, 131.51... 与 131.50, 132.30...），全部将小数逗号转为小数点！',
        '5. verticalDiffs（必填）：图中竖直引线旁标注的填挖高差数值（如 "0.61", "0.39", "0.66", "0.26", "1.34", "3.27"...），按对应 xMeters 全部列出。',
        '6. bands（严禁合并或遗漏任何一行！原图底部参数带有几行，bands 就必须输出完全相同的行数，逐行独立输出）：',
        '   - STATION_NUMBERS（里程桩号行）：cells 给出每个桩号 {xMeters, text}',
        '   - INTERVAL_SPAN（间距/距离行，若有两行距离行则分别独立输出为两个 INTERVAL_SPAN 对象）：cells 必须同时给出每个分段区间的 {xStart, xEnd, text}，确保各分段首尾相接覆盖 0..totalLength',
        '   - VERTICAL_VALUE（地面高程行与设计高程行必须拆分为两个独立的 VERTICAL_VALUE band！）：分别给出每个刻度处的 {xMeters, text, color}（地面高程 color="dark"，设计高程 color="red"）',
        '   - SLOPE_SEGMENT（设计线坡度行，若有坡度三角形必须输出）：slopes 给出每段 {xStart, xEnd, slopeValue, lengthValue, direction}，direction 为 "up" / "down" / "flat"',
        '   - CURVE_PLAN（直线与曲线平面图行，若有直线曲线图必须输出）：curveSegments 给出每段 {xStart, xEnd, kind ("straight"|"curve_up"|"curve_down"), topLabels, bottomLabels, boxParams}；把方位角(ЮЗ->西南)、转角(УП->转角)、切线长(T->切线长)、外距(Б->外距)、半径(R->半径)、曲线长(K->曲线长)、参数(A->缓和曲线参数A)全部翻译为简洁中文并保留精确数值！',
        '',
        '【类型 2：DATA_CHART】（折线图、柱状图、面积图、散点图、饼图等通用数据统计/工程性能曲线图）',
        '填充 dataChart：提取 chartKind、title、xAxisLabel、yAxisLabel、xCategories（翻译）、yMin/yMax/yUnit、全部 series（名称翻译+全部数据点 yValue/xValue）以及关键 annotations。',
        '',
        '【类型 3：SCHEMATIC_DIAGRAM】（工艺流程图、系统框图、设备原理示意图、拓扑图等非数值坐标类图纸）',
        '填充 schematicDiagram：提取 aspectRatio、title、全部 nodes（id, bboxNormalized [ymin,xmin,ymax,xmax] 0..1000, shape, 翻译后的 label, fillHex/strokeHex）、edges（连接关系、线型、箭头、翻译后的线上文字）以及 callouts。',
        '',
        '通用硬性要求：',
        '1. 严禁虚构或猜测不存在的数值；欧洲格式小数逗号（如 132,11）保留原数值精度（可转为 132.11）。',
        '2. 所有 translated 字段必须使用地道、简洁的专业目标语言（如中文工程规范术语），不保留未翻译的源语言词句。',
      ].join('\n');

      const outcome = await executePipelineCall(modelId, !body?.model, (targetModel) =>
        ai.models.generateContent({
          model: targetModel,
          contents: {
            parts: [
              { inlineData: { mimeType, data: cleanBase64 } },
              { text: prompt },
            ],
          },
          config: {
            thinkingConfig: buildThinkingConfig(targetModel),
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                diagramKind: { type: Type.STRING },
                diagramTitle: { type: Type.STRING },
                diagramSummary: { type: Type.STRING },
                engineeringProfile: {
                  type: Type.OBJECT,
                  properties: {
                    title: textPairSchema,
                    scaleLines: { type: Type.ARRAY, items: textPairSchema },
                    datumLabel: textPairSchema,
                    baselineValue: { type: Type.NUMBER },
                    yMin: { type: Type.NUMBER },
                    yMax: { type: Type.NUMBER },
                    yStep: { type: Type.NUMBER },
                    totalLength: { type: Type.NUMBER },
                    stations: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          label: { type: Type.STRING },
                          xMeters: { type: Type.NUMBER },
                        },
                        required: ['label', 'xMeters'],
                      },
                    },
                    groundPoints: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          xMeters: { type: Type.NUMBER },
                          elevation: { type: Type.NUMBER },
                        },
                        required: ['xMeters', 'elevation'],
                      },
                    },
                    designPoints: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          xMeters: { type: Type.NUMBER },
                          elevation: { type: Type.NUMBER },
                        },
                        required: ['xMeters', 'elevation'],
                      },
                    },
                    verticalDiffs: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          xMeters: { type: Type.NUMBER },
                          text: { type: Type.STRING },
                        },
                        required: ['xMeters', 'text'],
                      },
                    },
                    bands: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          bandType: { type: Type.STRING },
                          rowTitle: textPairSchema,
                          cells: {
                            type: Type.ARRAY,
                            items: {
                              type: Type.OBJECT,
                              properties: {
                                xStart: { type: Type.NUMBER },
                                xEnd: { type: Type.NUMBER },
                                xMeters: { type: Type.NUMBER },
                                text: { type: Type.STRING },
                                color: { type: Type.STRING },
                              },
                              required: ['text'],
                            },
                          },
                          slopes: {
                            type: Type.ARRAY,
                            items: {
                              type: Type.OBJECT,
                              properties: {
                                xStart: { type: Type.NUMBER },
                                xEnd: { type: Type.NUMBER },
                                slopeValue: { type: Type.STRING },
                                lengthValue: { type: Type.STRING },
                                direction: { type: Type.STRING },
                              },
                              required: ['xStart', 'xEnd', 'slopeValue', 'lengthValue', 'direction'],
                            },
                          },
                          curveSegments: {
                            type: Type.ARRAY,
                            items: {
                              type: Type.OBJECT,
                              properties: {
                                xStart: { type: Type.NUMBER },
                                xEnd: { type: Type.NUMBER },
                                kind: { type: Type.STRING },
                                topLabels: { type: Type.ARRAY, items: textPairSchema },
                                bottomLabels: { type: Type.ARRAY, items: textPairSchema },
                                boxParams: { type: Type.ARRAY, items: textPairSchema },
                              },
                              required: ['xStart', 'xEnd', 'kind'],
                            },
                          },
                        },
                        required: ['id', 'bandType', 'rowTitle'],
                      },
                    },
                  },
                  required: ['title', 'scaleLines', 'datumLabel', 'baselineValue', 'yMin', 'yMax', 'totalLength', 'stations', 'groundPoints', 'designPoints', 'verticalDiffs', 'bands'],
                },
                dataChart: {
                  type: Type.OBJECT,
                  properties: {
                    chartKind: { type: Type.STRING },
                    title: textPairSchema,
                    subtitle: textPairSchema,
                    xAxisLabel: textPairSchema,
                    yAxisLabel: textPairSchema,
                    xCategories: { type: Type.ARRAY, items: textPairSchema },
                    yMin: { type: Type.NUMBER },
                    yMax: { type: Type.NUMBER },
                    yUnit: { type: Type.STRING },
                    series: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          name: textPairSchema,
                          colorHex: { type: Type.STRING },
                          points: {
                            type: Type.ARRAY,
                            items: {
                              type: Type.OBJECT,
                              properties: {
                                xIndex: { type: Type.NUMBER },
                                xValue: { type: Type.NUMBER },
                                yValue: { type: Type.NUMBER },
                                label: { type: Type.STRING },
                              },
                              required: ['yValue'],
                            },
                          },
                        },
                        required: ['name', 'points'],
                      },
                    },
                    annotations: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          source: { type: Type.STRING },
                          translated: { type: Type.STRING },
                          xIndex: { type: Type.NUMBER },
                          yValue: { type: Type.NUMBER },
                        },
                        required: ['source', 'translated'],
                      },
                    },
                  },
                  required: ['chartKind', 'title', 'series'],
                },
                schematicDiagram: {
                  type: Type.OBJECT,
                  properties: {
                    aspectRatio: { type: Type.NUMBER },
                    title: textPairSchema,
                    nodes: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          bboxNormalized: { type: Type.ARRAY, items: { type: Type.INTEGER } },
                          shape: { type: Type.STRING },
                          label: textPairSchema,
                          fillHex: { type: Type.STRING },
                          strokeHex: { type: Type.STRING },
                        },
                        required: ['id', 'bboxNormalized', 'shape', 'label'],
                      },
                    },
                    edges: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          fromId: { type: Type.STRING },
                          toId: { type: Type.STRING },
                          pointsNormalized: {
                            type: Type.ARRAY,
                            items: { type: Type.ARRAY, items: { type: Type.INTEGER } },
                          },
                          style: { type: Type.STRING },
                          arrowEnd: { type: Type.BOOLEAN },
                          label: textPairSchema,
                        },
                        required: ['id', 'style'],
                      },
                    },
                    callouts: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          bboxNormalized: { type: Type.ARRAY, items: { type: Type.INTEGER } },
                          text: textPairSchema,
                          align: { type: Type.STRING },
                          bold: { type: Type.BOOLEAN },
                        },
                        required: ['id', 'bboxNormalized', 'text'],
                      },
                    },
                  },
                  required: ['title', 'nodes', 'edges'],
                },
              },
              required: ['diagramKind', 'diagramTitle'],
            },
          },
        })
      );

      const parsed = JSON.parse(outcome.text);
      res.json({
        model: outcome.modelId,
        fallbackFrom: outcome.fallbackFrom,
        durationMs: outcome.durationMs,
        result: parsed,
      });
    } catch (err: unknown) {
      const wrapped = err as { formatted?: { status: number; code: string; message: string }; durationMs?: number };
      const formatted = wrapped?.formatted ?? formatApiError(err, modelId);
      const durationMs = wrapped?.durationMs ?? Date.now() - startTime;
      if (!wrapped?.formatted) {
        recordModelCallResult({
          modelId,
          success: false,
          durationMs,
          errorMsg: formatted.message,
          isRateOrUnavailable: formatted.status === 429 || formatted.status === 503,
        });
      }
      res.status(formatted.status).json({
        code: formatted.code,
        message: formatted.message,
        durationMs,
      });
    }
  });

  // Vite dev middleware or production static serving
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GlobalCodeTrans V2.0 server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start GlobalCodeTrans server:', err);
  process.exit(1);
});
