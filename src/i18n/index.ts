import i18next from 'i18next';
import en from './locales/en';
import vi from './locales/vi';
import ja from './locales/ja';
import { getLanguage } from 'obsidian';

// Get the default language from Obsidian
const obsidianLang = getLanguage();
// Map Obsidian language to our supported languages or fallback to English
const defaultLang = ['en', 'vi', 'ja'].includes(obsidianLang) ? obsidianLang : 'en';

// Function to update the language attribute on the HTML element
export function updateLanguageAttribute(lang: string) {
  document.documentElement.setAttribute('data-stw-language', lang);
}

// Initialize i18next
i18next.init({
  lng: defaultLang, // Use Obsidian's language if supported, otherwise English
  fallbackLng: 'en',
  resources: {
    en,
    vi,
    ja,
  },
  interpolation: {
    escapeValue: false, // React already escapes
  },
  returnObjects: false, // Always return strings
});

// Set initial language attribute
updateLanguageAttribute(i18next.language);

export default i18next;

// Utility function to get the translation function for a specific language
export function getTranslation(lang: string | null = 'en') {
  return i18next.getFixedT(lang || 'en');
}
