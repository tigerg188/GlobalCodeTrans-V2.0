import { EngineRuntimeState } from '../../../domain/task/TaskTypes';
import type {
  DiagramReconstructionSpec,
  DiagramTextOverlay,
  EngineeringProfileSpec,
  DataChartSpec,
  SchematicDiagramSpec,
  TranslatedTextPair,
} from '../../../domain/document/DocumentIR';
import { engineRegistry } from '../../registry/EngineRegistry';

export interface ServerHealthResponse {
  ok: boolean;
  geminiConfigured: boolean;
  model: string;
  runtime: string;
  timestamp: string;
}

export interface FreeModelUsage {
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

export interface FreeModelEntry {
  modelId: string;
  displayName: string;
  modality: string;
  role: string;
  supportsDocumentPipeline: boolean;
  defaultDailyQuotaLimit: number;
  rpmReference: number;
  notes: string;
  isActive: boolean;
  dailyQuotaLimit: number;
  remainingReference: number;
  usage: FreeModelUsage;
}

export interface ModelDashboardResponse {
  date: string;
  geminiConfigured: boolean;
  activeModel: string;
  models: FreeModelEntry[];
  summary: {
    freeModelCount: number;
    pipelineModelCount: number;
    totalRequestsToday: number;
    totalSuccessToday: number;
    totalErrorsToday: number;
    totalTokensToday: number;
  };
}

export interface GeminiAnalyzedObject {
  objectType: string;
  readingOrder: number;
  bboxNormalized: [number, number, number, number];
  rawText?: string;
  latex?: string;
  tableHeaders?: string[];
  tableRows?: string[][];
  chartTitle?: string;
  chartType?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  legendItems?: string[];
  chartNote?: string;
  peripheralLabels?: string[];
  confidence: number;
  needsReview: boolean;
  reviewReason?: string;
}

export interface GeminiAnalyzePageResponse {
  model: string;
  durationMs: number;
  result: {
    pageSummary?: string;
    detectedLanguage?: string;
    pageTitle?: string;
    objects: GeminiAnalyzedObject[];
  };
}

export interface GeminiTranslateResponse {
  model: string;
  durationMs: number;
  result: {
    inferredDomain?: string;
    inferredStandardSystem?: string;
    translations: Array<{
      id: string;
      targetText: string;
      terminologyApplied?: string[];
      riskFlags?: string[];
      semanticNotes?: string;
      confidence: number;
    }>;
  };
}

export interface GeminiVerifyRegionResponse {
  model: string;
  durationMs: number;
  result: {
    rawText?: string;
    latex?: string;
    tableHeaders?: string[];
    tableRows?: string[][];
    chartMeta?: {
      title?: string;
      xAxis?: string;
      yAxis?: string;
      legends?: string[];
      notes?: string;
    };
    peripheralLabels?: string[];
    confidence: number;
    needsReview: boolean;
    reviewReason?: string;
  };
}

export interface GeminiReconstructDiagramResponse {
  model: string;
  durationMs: number;
  result: {
    diagramKind: 'ENGINEERING_PROFILE' | 'DATA_CHART' | 'SCHEMATIC_DIAGRAM';
    diagramTitle?: string;
    diagramSummary?: string;
    engineeringProfile?: Omit<EngineeringProfileSpec, 'kind'>;
    dataChart?: Omit<DataChartSpec, 'kind'>;
    schematicDiagram?: Omit<SchematicDiagramSpec, 'kind'>;
  };
}

function makeOverlay(id: string, pair?: TranslatedTextPair): DiagramTextOverlay | null {
  if (!pair || (!pair.source && !pair.translated)) return null;
  return {
    id,
    bboxNormalized: [0, 0, 0, 0],
    sourceText: pair.source || '',
    translatedText: pair.translated || pair.source || '',
    orientation: 'horizontal',
    align: 'center',
    fontWeight: 'normal',
    textColor: 'dark',
  };
}

export function extractOverlaysFromSpec(spec: DiagramReconstructionSpec): DiagramTextOverlay[] {
  const list: DiagramTextOverlay[] = [];
  const push = (id: string, pair?: TranslatedTextPair) => {
    const ov = makeOverlay(id, pair);
    if (ov) list.push(ov);
  };

  if (spec.kind === 'ENGINEERING_PROFILE') {
    push('ep_title', spec.title);
    spec.scaleLines.forEach((s, i) => push(`ep_scale_${i}`, s));
    push('ep_datum', spec.datumLabel);
    spec.bands.forEach((band, bIdx) => {
      push(`ep_band_${bIdx}_title`, band.rowTitle);
      (band.curveSegments || []).forEach((seg, sIdx) => {
        (seg.topLabels || []).forEach((lbl, lIdx) =>
          push(`ep_band_${bIdx}_seg_${sIdx}_top_${lIdx}`, lbl)
        );
        (seg.bottomLabels || []).forEach((lbl, lIdx) =>
          push(`ep_band_${bIdx}_seg_${sIdx}_bot_${lIdx}`, lbl)
        );
        (seg.boxParams || []).forEach((p, pIdx) =>
          push(`ep_band_${bIdx}_seg_${sIdx}_param_${pIdx}`, p)
        );
      });
    });
  } else if (spec.kind === 'DATA_CHART') {
    push('dc_title', spec.title);
    push('dc_subtitle', spec.subtitle);
    push('dc_xaxis', spec.xAxisLabel);
    push('dc_yaxis', spec.yAxisLabel);
    spec.xCategories.forEach((c, i) => push(`dc_xcat_${i}`, c));
    spec.series.forEach((s, i) => push(`dc_series_${i}`, s.name));
    spec.annotations.forEach((a, i) =>
      push(`dc_ann_${i}`, { source: a.source, translated: a.translated })
    );
  } else if (spec.kind === 'SCHEMATIC_DIAGRAM') {
    push('sd_title', spec.title);
    spec.nodes.forEach((n, i) => push(`sd_node_${i}`, n.label));
    spec.edges.forEach((e, i) => {
      if (e.label) push(`sd_edge_${i}`, e.label);
    });
    spec.callouts.forEach((c, i) => push(`sd_callout_${i}`, c.text));
  }

  return list;
}

export function applyOverlaysToSpec(
  spec: DiagramReconstructionSpec,
  overlays: DiagramTextOverlay[]
): DiagramReconstructionSpec {
  const map = new Map<string, string>();
  overlays.forEach((ov) => map.set(ov.id, ov.translatedText));
  const clone = JSON.parse(JSON.stringify(spec)) as DiagramReconstructionSpec;

  const upd = (id: string, pair?: TranslatedTextPair) => {
    if (!pair) return;
    const val = map.get(id);
    if (typeof val === 'string') pair.translated = val;
  };

  if (clone.kind === 'ENGINEERING_PROFILE') {
    upd('ep_title', clone.title);
    clone.scaleLines.forEach((s, i) => upd(`ep_scale_${i}`, s));
    upd('ep_datum', clone.datumLabel);
    clone.bands.forEach((band, bIdx) => {
      upd(`ep_band_${bIdx}_title`, band.rowTitle);
      (band.curveSegments || []).forEach((seg, sIdx) => {
        (seg.topLabels || []).forEach((lbl, lIdx) =>
          upd(`ep_band_${bIdx}_seg_${sIdx}_top_${lIdx}`, lbl)
        );
        (seg.bottomLabels || []).forEach((lbl, lIdx) =>
          upd(`ep_band_${bIdx}_seg_${sIdx}_bot_${lIdx}`, lbl)
        );
        (seg.boxParams || []).forEach((p, pIdx) =>
          upd(`ep_band_${bIdx}_seg_${sIdx}_param_${pIdx}`, p)
        );
      });
    });
  } else if (clone.kind === 'DATA_CHART') {
    upd('dc_title', clone.title);
    upd('dc_subtitle', clone.subtitle);
    upd('dc_xaxis', clone.xAxisLabel);
    upd('dc_yaxis', clone.yAxisLabel);
    clone.xCategories.forEach((c, i) => upd(`dc_xcat_${i}`, c));
    clone.series.forEach((s, i) => upd(`dc_series_${i}`, s.name));
    clone.annotations.forEach((a, i) => {
      const val = map.get(`dc_ann_${i}`);
      if (typeof val === 'string') a.translated = val;
    });
  } else if (clone.kind === 'SCHEMATIC_DIAGRAM') {
    upd('sd_title', clone.title);
    clone.nodes.forEach((n, i) => upd(`sd_node_${i}`, n.label));
    clone.edges.forEach((e, i) => {
      if (e.label) upd(`sd_edge_${i}`, e.label);
    });
    clone.callouts.forEach((c, i) => upd(`sd_callout_${i}`, c.text));
  }

  return clone;
}

export const geminiAdapter = {
  async checkHealth(): Promise<ServerHealthResponse> {
    const res = await fetch('/api/health');
    if (!res.ok) {
      throw new Error(`健康检查失败 (HTTP ${res.status})`);
    }
    const data = (await res.json()) as ServerHealthResponse;
    if (data.ok && data.geminiConfigured) {
      engineRegistry.markState('gemini-vision-layout', EngineRuntimeState.LOADED);
      engineRegistry.markState('gemini-translator', EngineRuntimeState.LOADED);
    } else {
      engineRegistry.markState(
        'gemini-vision-layout',
        EngineRuntimeState.INSTALLED,
        '未配置 GEMINI_API_KEY'
      );
      engineRegistry.markState(
        'gemini-translator',
        EngineRuntimeState.INSTALLED,
        '未配置 GEMINI_API_KEY'
      );
    }
    return data;
  },

  async getModelDashboard(): Promise<ModelDashboardResponse> {
    const res = await fetch('/api/models/dashboard');
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.message || `获取大模型看板失败 (HTTP ${res.status})`);
    }
    return json as ModelDashboardResponse;
  },

  async selectActiveModel(modelId: string): Promise<ModelDashboardResponse> {
    const res = await fetch('/api/models/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.message || `切换主力模型失败 (HTTP ${res.status})`);
    }
    return json as ModelDashboardResponse;
  },

  async updateModelQuotaLimit(
    modelId: string,
    dailyQuotaLimit: number
  ): Promise<ModelDashboardResponse> {
    const res = await fetch('/api/models/quota-limit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId, dailyQuotaLimit }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.message || `更新当日参考限额失败 (HTTP ${res.status})`);
    }
    return json as ModelDashboardResponse;
  },

  async testModelConnectivity(
    modelId: string
  ): Promise<{ ok: boolean; message: string; dashboard?: ModelDashboardResponse }> {
    const res = await fetch('/api/models/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId }),
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) {
      return {
        ok: false,
        message: json?.message || `模型 ${modelId} 连通性探测失败 (HTTP ${res.status})`,
        dashboard: json?.dashboard as ModelDashboardResponse | undefined,
      };
    }
    return {
      ok: true,
      message: `模型 ${modelId} 响应正常（${json.durationMs} ms，回复 "${json.reply || 'OK'}"），已计入当日调用额度。`,
      dashboard: json.dashboard as ModelDashboardResponse | undefined,
    };
  },

  async analyzePage(payload: {
    model?: string;
    pageIndex: number;
    imageBase64: string;
    mimeType: string;
    pageWidthPt: number;
    pageHeightPt: number;
    sourceLanguage: string;
    domainHint: string;
    nativeHints: {
      textSampleCount: number;
      vectorLineCount: number;
      imageCount: number;
      nativeTextSnippets: string[];
    };
  }): Promise<GeminiAnalyzePageResponse> {
    engineRegistry.recordCallStart('gemini-vision-layout');
    const t0 = performance.now();
    try {
      const res = await fetch('/api/gemini/analyze-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.message || `视觉解析失败 (HTTP ${res.status})`);
      }
      const data = json as GeminiAnalyzePageResponse;
      const valid = Array.isArray(data?.result?.objects);
      engineRegistry.recordCallSuccess(
        'gemini-vision-layout',
        data.durationMs || Math.round(performance.now() - t0),
        valid
      );
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      engineRegistry.recordCallError('gemini-vision-layout', Math.round(performance.now() - t0), msg);
      throw err;
    }
  },

  async translateUnits(payload: {
    model?: string;
    units: Array<{
      id: string;
      objectType: string;
      protectedText: string;
      contextBefore?: string;
      contextAfter?: string;
      sectionHeading?: string;
    }>;
    sourceLanguage: string;
    targetLanguage: string;
    documentContext: {
      title?: string;
      domain?: string;
      standardSystem?: string;
      summary?: string;
    };
    terminology: Array<{
      sourceTerm: string;
      targetTerm: string;
      domain?: string;
      preferred?: boolean;
    }>;
  }): Promise<GeminiTranslateResponse> {
    engineRegistry.recordCallStart('gemini-translator');
    const t0 = performance.now();
    try {
      const res = await fetch('/api/gemini/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.message || `翻译接口失败 (HTTP ${res.status})`);
      }
      const data = json as GeminiTranslateResponse;
      const valid = Array.isArray(data?.result?.translations);
      engineRegistry.recordCallSuccess(
        'gemini-translator',
        data.durationMs || Math.round(performance.now() - t0),
        valid
      );
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      engineRegistry.recordCallError('gemini-translator', Math.round(performance.now() - t0), msg);
      throw err;
    }
  },

  async verifyRegion(payload: {
    model?: string;
    objectType: string;
    imageBase64: string;
    mimeType?: string;
    existingText?: string;
    sourceLanguage?: string;
  }): Promise<GeminiVerifyRegionResponse> {
    engineRegistry.recordCallStart('gemini-vision-layout');
    const t0 = performance.now();
    try {
      const res = await fetch('/api/gemini/verify-region', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.message || `区域重识别失败 (HTTP ${res.status})`);
      }
      const data = json as GeminiVerifyRegionResponse;
      engineRegistry.recordCallSuccess(
        'gemini-vision-layout',
        data.durationMs || Math.round(performance.now() - t0),
        true
      );
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      engineRegistry.recordCallError('gemini-vision-layout', Math.round(performance.now() - t0), msg);
      throw err;
    }
  },

  async reconstructDiagram(payload: {
    model?: string;
    imageBase64: string;
    mimeType?: string;
    sourceLanguage?: string;
    targetLanguage: string;
    domainHint?: string;
    terminology?: Array<{ sourceTerm: string; targetTerm: string }>;
  }): Promise<{
    model: string;
    durationMs: number;
    diagramTitle?: string;
    diagramSummary?: string;
    diagramSpec?: DiagramReconstructionSpec;
    overlays: DiagramTextOverlay[];
  }> {
    engineRegistry.recordCallStart('gemini-vision-layout');
    const t0 = performance.now();
    try {
      const res = await fetch('/api/gemini/reconstruct-diagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.message || `图表结构化重建失败 (HTTP ${res.status})`);
      }
      const data = json as GeminiReconstructDiagramResponse;
      const r = data?.result;
      let diagramSpec: DiagramReconstructionSpec | undefined;

      if (r?.diagramKind === 'ENGINEERING_PROFILE' && r.engineeringProfile) {
        const ep = r.engineeringProfile;
        diagramSpec = {
          kind: 'ENGINEERING_PROFILE',
          title: ep.title || { source: '', translated: r.diagramTitle || '纵断面图' },
          scaleLines: Array.isArray(ep.scaleLines) ? ep.scaleLines : [],
          datumLabel: ep.datumLabel || { source: '', translated: '' },
          baselineValue: Number.isFinite(ep.baselineValue) ? ep.baselineValue : (ep.yMin ?? 0) - 1,
          yMin: Number.isFinite(ep.yMin) ? ep.yMin : 0,
          yMax: Number.isFinite(ep.yMax) ? ep.yMax : 100,
          yStep: Number.isFinite(ep.yStep) && ep.yStep > 0 ? ep.yStep : 1,
          totalLength: Number.isFinite(ep.totalLength) && ep.totalLength > 0 ? ep.totalLength : 800,
          stations: Array.isArray(ep.stations) ? ep.stations : [],
          groundPoints: Array.isArray(ep.groundPoints) ? ep.groundPoints : [],
          designPoints: Array.isArray(ep.designPoints) ? ep.designPoints : [],
          verticalDiffs: Array.isArray(ep.verticalDiffs) ? ep.verticalDiffs : [],
          bands: Array.isArray(ep.bands) ? ep.bands : [],
        };
      } else if (r?.diagramKind === 'DATA_CHART' && r.dataChart) {
        const dc = r.dataChart;
        diagramSpec = {
          kind: 'DATA_CHART',
          chartKind: dc.chartKind || 'line',
          title: dc.title || { source: '', translated: r.diagramTitle || '统计图表' },
          subtitle: dc.subtitle,
          xAxisLabel: dc.xAxisLabel || { source: '', translated: '' },
          yAxisLabel: dc.yAxisLabel || { source: '', translated: '' },
          xCategories: Array.isArray(dc.xCategories) ? dc.xCategories : [],
          yMin: dc.yMin,
          yMax: dc.yMax,
          yUnit: dc.yUnit,
          series: Array.isArray(dc.series) ? dc.series : [],
          annotations: Array.isArray(dc.annotations) ? dc.annotations : [],
        };
      } else if (r?.diagramKind === 'SCHEMATIC_DIAGRAM' && r.schematicDiagram) {
        const sd = r.schematicDiagram;
        diagramSpec = {
          kind: 'SCHEMATIC_DIAGRAM',
          aspectRatio: sd.aspectRatio,
          title: sd.title || { source: '', translated: r.diagramTitle || '技术示意图' },
          nodes: Array.isArray(sd.nodes) ? sd.nodes : [],
          edges: Array.isArray(sd.edges) ? sd.edges : [],
          callouts: Array.isArray(sd.callouts) ? sd.callouts : [],
        };
      }

      const overlays = diagramSpec ? extractOverlaysFromSpec(diagramSpec) : [];

      engineRegistry.recordCallSuccess(
        'gemini-vision-layout',
        data.durationMs || Math.round(performance.now() - t0),
        true
      );
      return {
        model: data.model,
        durationMs: data.durationMs,
        diagramTitle: data.result.diagramTitle,
        diagramSummary: data.result.diagramSummary,
        diagramSpec,
        overlays,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      engineRegistry.recordCallError('gemini-vision-layout', Math.round(performance.now() - t0), msg);
      throw err;
    }
  },
};
