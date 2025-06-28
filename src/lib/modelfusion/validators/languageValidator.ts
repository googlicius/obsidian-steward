/**
 * Validates that the language code is a string and normalizes it.
 * If the language is not provided or invalid, defaults to 'en'
 * @param lang The language code to validate
 * @returns A normalized language code or 'en' if invalid
 */
export function validateLanguage(lang: any): string {
  if (lang && typeof lang === 'string' && lang.trim()) {
    return lang.trim().toLowerCase();
  }
  return 'en';
}
