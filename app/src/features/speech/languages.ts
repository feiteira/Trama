import type { SelectOption } from '../../ui/components/Field';

// The languages offered for transcription. The model understands about a hundred; these are the
// ones a researcher here is most likely to record, Trama's own three first. Their names come
// from the browser (Intl.DisplayNames), in the interface's language.

const FIRST = ['pt', 'es', 'en'] as const;
const OTHERS = [
  'ar', 'bn', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'eu', 'fa', 'fi', 'fr', 'gl', 'he', 'hi', 'hu', 'id', 'it', 'ja', 'ko',
  'nl', 'no', 'pl', 'ro', 'ru', 'sk', 'sv', 'sw', 'th', 'tr', 'uk', 'ur', 'vi', 'zh',
] as const;

export function languageName(code: string, bcp47: string): string {
  try {
    const name = new Intl.DisplayNames([bcp47], { type: 'language' }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(bcp47) + name.slice(1) : code;
  } catch {
    return code;
  }
}

/** For a Select: '' is "detect automatically". */
export function languageOptions(bcp47: string, autoLabel: string): SelectOption<string>[] {
  const named = (codes: readonly string[]) => codes.map((value) => ({ value, label: languageName(value, bcp47) }));
  const rest = named(OTHERS).sort((a, b) => a.label.localeCompare(b.label, bcp47));
  return [{ value: '', label: autoLabel }, ...named(FIRST), ...rest];
}
