import type { BoundingBox } from '../geometry/CoordinateSpace';

export const DOCUMENT_IR_SCHEMA_VERSION = '1.0.0';

export enum ObjectType {
  TEXT = 'TEXT',
  PARAGRAPH = 'PARAGRAPH',
  HEADING = 'HEADING',
  LIST = 'LIST',
  TABLE = 'TABLE',
  TABLE_CELL = 'TABLE_CELL',
  FORMULA = 'FORMULA',
  CHART = 'CHART',
  PLOT = 'PLOT',
  DIAGRAM = 'DIAGRAM',
  FLOWCHART = 'FLOWCHART',
  CAD_DRAWING = 'CAD_DRAWING',
  IMAGE = 'IMAGE',
  CAPTION = 'CAPTION',
  FOOTNOTE = 'FOOTNOTE',
  HEADER = 'HEADER',
  FOOTER = 'FOOTER',
  PAGE_NUMBER = 'PAGE_NUMBER',
  UNKNOWN = 'UNKNOWN',
}

export enum RegionType {
  TITLE = 'TITLE',
  SECTION_HEADING = 'SECTION_HEADING',
  BODY = 'BODY',
  PARAGRAPH = 'PARAGRAPH',
  LIST = 'LIST',
  TABLE = 'TABLE',
  FORMULA = 'FORMULA',
  FIGURE = 'FIGURE',
  CHART = 'CHART',
  CAPTION = 'CAPTION',
  HEADER = 'HEADER',
  FOOTER = 'FOOTER',
  FOOTNOTE = 'FOOTNOTE',
  SIDEBAR = 'SIDEBAR',
  UNKNOWN = 'UNKNOWN',
}

export enum ObjectStatus {
  DETECTED = 'DETECTED',
  CLASSIFIED = 'CLASSIFIED',
  EXTRACTED = 'EXTRACTED',
  STRUCTURED = 'STRUCTURED',
  TRANSLATED = 'TRANSLATED',
  RECONSTRUCTED = 'RECONSTRUCTED',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  FAILED = 'FAILED',
  SKIPPED_WITH_REASON = 'SKIPPED_WITH_REASON',
}

export enum PageTag {
  TEXT_HEAVY = 'TEXT_HEAVY',
  IMAGE_HEAVY = 'IMAGE_HEAVY',
  VECTOR_HEAVY = 'VECTOR_HEAVY',
  TABLE_HEAVY = 'TABLE_HEAVY',
  FORMULA_HEAVY = 'FORMULA_HEAVY',
  DRAWING_HEAVY = 'DRAWING_HEAVY',
  MIXED = 'MIXED',
  LOW_QUALITY_SCAN = 'LOW_QUALITY_SCAN',
}

export enum RelationType {
  CAPTION_OF = 'CAPTION_OF',
  REFERENCED_BY = 'REFERENCED_BY',
  ANNOTATES = 'ANNOTATES',
  CONTINUES_ON_PAGE = 'CONTINUES_ON_PAGE',
  CONTAINS = 'CONTAINS',
  ADJACENT_TO = 'ADJACENT_TO',
}

export enum ReconstructionStrategy {
  A_NATIVE = 'A_NATIVE',
  B_VECTOR = 'B_VECTOR',
  C_PRESERVE_ORIGINAL = 'C_PRESERVE_ORIGINAL',
}

export type SourceType = 'PDF_NATIVE' | 'GEMINI_VISION' | 'HYBRID' | 'IMAGE_UPLOAD' | 'USER_EDIT';

export interface EvidenceIR {
  evidenceId: string;
  sourceFile: string;
  pageIndex: number;
  bbox: BoundingBox;
  rawContent: string;
  engineId: string;
  engineVersion: string;
  parameters?: Record<string, unknown>;
  timestamp: string;
}

export interface ReviewRecord {
  reviewStatus: 'UNREVIEWED' | 'APPROVED' | 'NEEDS_REVIEW' | 'EDITED' | 'SKIPPED';
  reviewer: string;
  reviewedAt: string;
  previousContent?: string;
  previousLatex?: string;
  changeSet?: string;
  reason?: string;
}

export interface FormulaData {
  latex: string;
  mathml?: string;
  displayMode: 'block' | 'inline';
  numbering?: string;
  rawImageRef?: string;
}

export interface TableData {
  headers: string[];
  rows: string[][];
  translatedHeaders?: string[];
  translatedRows?: string[][];
  mergedHint?: string;
  unitNotes?: string;
}

export interface ChartSeriesPoint {
  x: number | string;
  y: number | string;
}

export interface ChartData {
  chartType: string;
  title?: string;
  translatedTitle?: string;
  xAxisLabel?: string;
  translatedXAxisLabel?: string;
  yAxisLabel?: string;
  translatedYAxisLabel?: string;
  legendItems: string[];
  translatedLegendItems?: string[];
  extractionMethod: 'NATIVE_VECTOR' | 'MODEL_ESTIMATED' | 'USER_CALIBRATED';
  note: string;
  series?: Array<{ name: string; points: ChartSeriesPoint[] }>;
}

export interface CadData {
  peripheralLabels: string[];
  translatedPeripheralLabels?: string[];
  vectorOpCount: number;
  geometryPreserved: boolean;
}

export interface DocumentElementIR {
  elementId: string;
  objectId: string;
  elementType: string;
  text: string;
  translatedText?: string;
  fontName?: string;
  fontSize?: number;
  bbox?: BoundingBox;
  sequence: number;
}

export interface DiagramTextOverlay {
  id: string;
  bboxNormalized: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0..1000
  sourceText: string;
  translatedText: string;
  orientation: 'horizontal' | 'vertical';
  align: 'left' | 'center' | 'right';
  fontWeight: 'normal' | 'bold';
  textColor?: 'dark' | 'blue' | 'red';
}

export interface TranslatedTextPair {
  source: string;
  translated: string;
}

export type ProfileBandType =
  | 'STATION_NUMBERS'
  | 'INTERVAL_SPAN'
  | 'VERTICAL_VALUE'
  | 'SLOPE_SEGMENT'
  | 'CURVE_PLAN';

export interface ProfileBandCell {
  xStart?: number;
  xEnd?: number;
  xMeters?: number;
  text: string;
  color?: 'dark' | 'red' | 'blue';
}

export interface ProfileSlopeItem {
  xStart: number;
  xEnd: number;
  slopeValue: string;
  lengthValue: string;
  direction: 'up' | 'down' | 'flat';
}

export interface ProfileCurveSegment {
  xStart: number;
  xEnd: number;
  kind: 'straight' | 'curve_up' | 'curve_down';
  topLabels: TranslatedTextPair[];
  bottomLabels: TranslatedTextPair[];
  boxParams: TranslatedTextPair[];
}

export interface ProfileBandSpec {
  id: string;
  bandType: ProfileBandType;
  rowTitle: TranslatedTextPair;
  cells?: ProfileBandCell[];
  slopes?: ProfileSlopeItem[];
  curveSegments?: ProfileCurveSegment[];
}

export interface EngineeringProfileSpec {
  kind: 'ENGINEERING_PROFILE';
  title: TranslatedTextPair;
  scaleLines: TranslatedTextPair[];
  datumLabel: TranslatedTextPair;
  baselineValue: number;
  yMin: number;
  yMax: number;
  yStep: number;
  totalLength: number;
  stations: Array<{ label: string; xMeters: number }>;
  groundPoints: Array<{ xMeters: number; elevation: number }>;
  designPoints: Array<{ xMeters: number; elevation: number }>;
  verticalDiffs: Array<{ xMeters: number; text: string }>;
  bands: ProfileBandSpec[];
}

export interface DataChartSpec {
  kind: 'DATA_CHART';
  chartKind: 'line' | 'bar' | 'area' | 'scatter' | 'pie';
  title: TranslatedTextPair;
  subtitle?: TranslatedTextPair;
  xAxisLabel: TranslatedTextPair;
  yAxisLabel: TranslatedTextPair;
  xCategories: TranslatedTextPair[];
  yMin?: number;
  yMax?: number;
  yUnit?: string;
  series: Array<{
    name: TranslatedTextPair;
    colorHex?: string;
    points: Array<{ xIndex?: number; xValue?: number; yValue: number; label?: string }>;
  }>;
  annotations: Array<{
    source: string;
    translated: string;
    xIndex?: number;
    yValue?: number;
  }>;
}

export interface SchematicDiagramSpec {
  kind: 'SCHEMATIC_DIAGRAM';
  aspectRatio?: number;
  title: TranslatedTextPair;
  nodes: Array<{
    id: string;
    bboxNormalized: [number, number, number, number];
    shape: 'rect' | 'rounded' | 'diamond' | 'circle' | 'ellipse' | 'cylinder' | 'text_box';
    label: TranslatedTextPair;
    fillHex?: string;
    strokeHex?: string;
  }>;
  edges: Array<{
    id: string;
    fromId?: string;
    toId?: string;
    pointsNormalized?: Array<[number, number]>;
    style: 'solid' | 'dashed';
    arrowEnd?: boolean;
    label?: TranslatedTextPair;
  }>;
  callouts: Array<{
    id: string;
    bboxNormalized: [number, number, number, number];
    text: TranslatedTextPair;
    align?: 'left' | 'center' | 'right';
    bold?: boolean;
  }>;
}

export type DiagramReconstructionSpec =
  | EngineeringProfileSpec
  | DataChartSpec
  | SchematicDiagramSpec;

export interface DocumentObjectIR {
  objectId: string;
  pageId: string;
  pageIndex: number;
  parentId?: string;
  objectType: ObjectType;
  regionType: RegionType;
  readingOrder: number;
  bbox: BoundingBox;
  sourceType: SourceType;
  sourceReference: string;
  confidence: number | null; // null represents UNKNOWN; never hardcode fake numbers
  status: ObjectStatus;
  strategy: ReconstructionStrategy;
  rawText: string;
  translatedText?: string;
  rawImageDataUrl?: string; // preserved visual crop evidence from real canvas
  reconstructedImageDataUrl?: string; // full vector/Canvas reconstructed diagram image
  diagramOverlays?: DiagramTextOverlay[];
  diagramSpec?: DiagramReconstructionSpec;
  formulaData?: FormulaData;
  tableData?: TableData;
  chartData?: ChartData;
  cadData?: CadData;
  elements: DocumentElementIR[];
  evidenceIds: string[];
  needsReviewReason?: string;
  qualityWarnings: string[];
  review: ReviewRecord;
}

export interface RegionIR {
  regionId: string;
  pageId: string;
  regionType: RegionType;
  bbox: BoundingBox;
  readingOrder: number;
  parentId?: string;
  objectIds: string[];
}

export interface RelationIR {
  relationId: string;
  fromId: string;
  toId: string;
  relationType: RelationType;
  confidence: number | null;
  evidenceIds: string[];
}

export interface PageRenderInfo {
  renderScale: number;
  pixelWidth: number;
  pixelHeight: number;
  previewDataUrl?: string;
}

export interface PageNativeStats {
  textItemCount: number;
  vectorOpCount: number;
  vectorLineCount: number;
  imageCount: number;
  coordinateRoundTripMaxErrorPt: number;
}

export interface PageIR {
  pageId: string;
  documentId: string;
  pageIndex: number;
  widthPt: number;
  heightPt: number;
  rotation: number;
  mediaBox: [number, number, number, number];
  cropBox: [number, number, number, number];
  tags: PageTag[];
  nativeStats: PageNativeStats;
  renderInfo: PageRenderInfo;
  regions: RegionIR[];
  objects: DocumentObjectIR[];
  parseStatus: 'PENDING' | 'NATIVE_PARSED' | 'VISION_ANALYZED' | 'TRANSLATED' | 'FAILED';
  errorMessage?: string;
}

export interface DocumentMetadata {
  title?: string;
  author?: string;
  pdfVersion?: string;
  detectedLanguage?: string;
  inferredDomain?: string;
  inferredStandardSystem?: string;
  sourceCountryHint?: string;
}

export interface DocumentIR {
  schemaVersion: string;
  documentId: string;
  sourceFileName: string;
  fileSizeBytes: number;
  fileHash: string;
  fileType: 'pdf' | 'image';
  mimeType: string;
  languageHints: string[];
  pageCount: number;
  createdAt: string;
  updatedAt: string;
  status: 'IMPORTED' | 'PARSING' | 'ANALYZED' | 'TRANSLATING' | 'READY' | 'FAILED';
  metadata: DocumentMetadata;
  pages: PageIR[];
  evidences: Record<string, EvidenceIR>;
  relations: RelationIR[];
}
