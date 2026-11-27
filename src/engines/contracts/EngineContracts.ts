import type { BoundingBox, CoordinateSpace } from '../../domain/geometry/CoordinateSpace';

export interface EngineInput<TPayload = unknown> {
  taskId: string;
  documentId: string;
  pageId?: string;
  objectId?: string;
  sourceType: 'pdf' | 'image' | 'ir';
  bbox?: BoundingBox;
  coordinateSpace?: CoordinateSpace;
  languageHints?: string[];
  payload: TPayload;
  correlationId: string;
}

export interface EngineOutput<TPayload = unknown> {
  engineId: string;
  engineVersion: string;
  executionId: string;
  status: 'OK' | 'PARTIAL' | 'ERROR';
  payload: TPayload | null;
  confidence: number | null;
  warnings: string[];
  errors: string[];
  durationMs: number;
  coordinateSpace?: CoordinateSpace;
}

export interface EngineAdapter<TInput = unknown, TOutput = unknown> {
  readonly engineId: string;
  readonly displayName: string;
  readonly version: string;
  getCapabilities(): string[];
  initialize(): Promise<boolean>;
  process(input: EngineInput<TInput>): Promise<EngineOutput<TOutput>>;
  validateOutput(output: EngineOutput<TOutput>): { valid: boolean; reason?: string };
}
