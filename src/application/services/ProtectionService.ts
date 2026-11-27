import type { ProtectedToken, ProtectionResult } from '../../domain/translation/TranslationTypes';

const STANDARD_PATTERN =
  /\b(?:ISO|IEC|GB\/T|GB|ASME|ASTM|API|NFPA|DIN(?:\s+EN(?:\s+ISO)?)?|JIS|KS|EN(?:\s+ISO)?|IEEE|UL|SAE)\s*[-:]?\s*\d+(?:[.\-:]\d+)*(?:\s*:\s*\d{4})?\b/g;

const URL_EMAIL_PATTERN =
  /(?:https?:\/\/[^\s<>()]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

const NUMBER_UNIT_PATTERN =
  /[±+\-]?\d+(?:[.,]\d+)?(?:\s*[×xX*]\s*10\^[+\-]?\d+|\s*±\s*\d+(?:[.,]\d+)?)?\s*(?:kV|MV|mV|V|kA|mA|A|kW|MW|GW|W|kVA|MVA|Hz|kHz|MHz|MPa|kPa|Pa|GPa|bar|mbar|psi|mm|cm|m|km|μm|um|nm|kg|g|mg|t|L|mL|m³|m3|m²|m2|°C|℃|K|℉|rpm|r\/min|dB|Ω|kΩ|MΩ|%|ppm|mol\/L)\b/g;

const MODEL_CODE_PATTERN =
  /\b[A-Z]{1,6}[-_/]?\d{2,}[A-Z0-9\-_/.]*\b/g;

export const protectionService = {
  protect(text: string): ProtectionResult {
    if (!text) return { protectedText: '', tokens: [] };

    let working = text;
    const tokens: ProtectedToken[] = [];
    let counter = 0;

    const replaceWithPlaceholder = (
      pattern: RegExp,
      category: ProtectedToken['category']
    ) => {
      working = working.replace(pattern, (match) => {
        // Avoid double-wrapping placeholders
        if (match.includes('[[GCT_')) return match;
        counter += 1;
        const placeholder = `[[GCT_${category}_${counter}]]`;
        tokens.push({ placeholder, original: match, category });
        return placeholder;
      });
    };

    replaceWithPlaceholder(URL_EMAIL_PATTERN, 'URL_EMAIL');
    replaceWithPlaceholder(STANDARD_PATTERN, 'STANDARD');
    replaceWithPlaceholder(NUMBER_UNIT_PATTERN, 'NUMBER_UNIT');
    replaceWithPlaceholder(MODEL_CODE_PATTERN, 'CODE_MODEL');

    return { protectedText: working, tokens };
  },

  restore(
    translatedText: string,
    tokens: ProtectedToken[]
  ): { restoredText: string; missingTokens: ProtectedToken[] } {
    let output = translatedText;
    const missingTokens: ProtectedToken[] = [];

    for (const token of tokens) {
      if (output.includes(token.placeholder)) {
        output = output.split(token.placeholder).join(token.original);
      } else {
        // Also check if the original text survived directly without placeholder
        if (!output.includes(token.original)) {
          missingTokens.push(token);
        }
      }
    }

    return { restoredText: output, missingTokens };
  },

  extractNumericTokens(text: string): string[] {
    const matches = text.match(/[±+\-]?\d+(?:[.,]\d+)?/g);
    return matches ? matches : [];
  },
};
