export enum EngineRuntimeState {
  DECLARED = 'DECLARED',
  INSTALLED = 'INSTALLED',
  LOADED = 'LOADED',
  CALLED = 'CALLED',
  EXECUTED = 'EXECUTED',
  OUTPUT_VALID = 'OUTPUT_VALID',
  SAMPLE_VERIFIED = 'SAMPLE_VERIFIED',
}

export interface EngineRecord {
  engineId: string;
  displayName: string;
  category: 'PARSER' | 'VISION_LAYOUT' | 'TRANSLATION' | 'DOCX_EXPORT' | 'PDF_EXPORT' | 'GEOMETRY';
  state: EngineRuntimeState;
  version: string;
  lastCallAt?: string;
  lastDurationMs?: number;
  callCount: number;
  successCount: number;
  errorCount: number;
  lastError?: string;
  capabilityNote: string;
}

export enum TaskStage {
  IDLE = 'IDLE',
  IMPORTING = 'IMPORTING',
  NATIVE_PARSING = 'NATIVE_PARSING',
  VISION_ANALYZING = 'VISION_ANALYZING',
  TRANSLATING = 'TRANSLATING',
  QUALITY_CHECKING = 'QUALITY_CHECKING',
  READY_FOR_REVIEW = 'READY_FOR_REVIEW',
  EXPORTING_DOCX = 'EXPORTING_DOCX',
  COMPLETED = 'COMPLETED',
  PAUSED = 'PAUSED',
  FAILED = 'FAILED',
}

export interface TaskLogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  taskId: string;
  stage: TaskStage;
  module: string;
  action: string;
  engineId?: string;
  pageIndex?: number;
  durationMs?: number;
  status: 'OK' | 'WARN' | 'FAIL';
  message: string;
}

export type DocxExportMode =
  | 'bilingual_interleaved'
  | 'bilingual_columns'
  | 'target_only'
  | 'bilingual_review';

export interface ProcessingTask {
  taskId: string;
  documentId: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  sourceLanguage: string;
  targetLanguage: string;
  domainHint: string;
  currentStage: TaskStage;
  completedPages: number;
  totalPages: number;
  completedWorkItems: number;
  totalWorkItems: number;
  status: 'CREATED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'PARTIAL_ERROR' | 'FAILED';
  errorCount: number;
  needsReviewCount: number;
  lastError?: string;
  logs: TaskLogEntry[];
}
