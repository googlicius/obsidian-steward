export function getObsidianLanguage(): string {
  // Get the language from localStorage
  const lang = localStorage.getItem('language');

  // If language is null, Obsidian defaults to English
  return lang || 'en';
}
