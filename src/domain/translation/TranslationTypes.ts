export type LanguageCode = 'auto' | 'zh' | 'en' | 'lo' | 'de' | 'ja' | 'ko' | 'fr';

export interface LanguageOption {
  code: LanguageCode;
  label: string;
  nativeLabel: string;
}

export const SOURCE_LANGUAGES: LanguageOption[] = [
  { code: 'auto', label: '自动检测', nativeLabel: 'Auto' },
  { code: 'zh', label: '中文', nativeLabel: '简体中文' },
  { code: 'en', label: '英文', nativeLabel: 'English' },
  { code: 'lo', label: '老挝语', nativeLabel: 'ພາສາລາວ' },
  { code: 'de', label: '德语', nativeLabel: 'Deutsch' },
  { code: 'ja', label: '日语', nativeLabel: '日本語' },
  { code: 'ko', label: '韩语', nativeLabel: '한국어' },
  { code: 'fr', label: '法语', nativeLabel: 'Français' },
];

export const TARGET_LANGUAGES: LanguageOption[] = [
  { code: 'zh', label: '中文', nativeLabel: '简体中文' },
  { code: 'en', label: '英文', nativeLabel: 'English' },
  { code: 'lo', label: '老挝语', nativeLabel: 'ພາສາລາວ' },
  { code: 'de', label: '德语', nativeLabel: 'Deutsch' },
  { code: 'ja', label: '日语', nativeLabel: '日本語' },
  { code: 'fr', label: '法语', nativeLabel: 'Français' },
];

export interface TerminologyEntry {
  id: string;
  sourceTerm: string;
  targetTerm: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  domain: string;
  definition?: string;
  preferred: boolean;
  approvalStatus: 'APPROVED' | 'DRAFT';
  version: number;
}

export interface ProtectedToken {
  placeholder: string;
  original: string;
  category: 'STANDARD' | 'NUMBER_UNIT' | 'CODE_MODEL' | 'FORMULA' | 'URL_EMAIL';
}

export interface ProtectionResult {
  protectedText: string;
  tokens: ProtectedToken[];
}

export interface QualityCheckItem {
  code:
    | 'TOKEN_LOST'
    | 'NUMBER_MISMATCH'
    | 'UNIT_CHANGED'
    | 'LOW_CONFIDENCE'
    | 'MISSING_TRANSLATION'
    | 'HIGH_RISK_SEMANTIC'
    | 'FORMULA_UNVERIFIED'
    | 'CHART_ESTIMATED'
    | 'CAD_PRESERVED';
  severity: 'error' | 'warning' | 'info';
  message: string;
  objectId: string;
  pageIndex: number;
}

export interface TranslationRecord {
  unitId: string;
  objectId: string;
  sourceText: string;
  targetText: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  terminologyApplied: string[];
  riskFlags: string[];
  provider: string;
  model: string;
  timestamp: string;
  durationMs: number;
}

export interface DocumentContextPack {
  title: string;
  domain: string;
  standardSystem: string;
  summary: string;
}
