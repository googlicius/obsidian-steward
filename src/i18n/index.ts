import i18next from 'i18next';
import en from './locales/en';
import vi from './locales/vi';
import ja from './locales/ja';
import { getObsidianLanguage } from '../utils/getObsidianLanguage';

// Get the default language from Obsidian
const obsidianLang = getObsidianLanguage();
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
  return (key: string, options?: any): string => {
    // Change language temporarily, get translation, then restore
    const currentLang = i18next.language;
    i18next.changeLanguage(lang || 'en');
    updateLanguageAttribute(lang || 'en');
    const translation = i18next.t(key, options);
    i18next.changeLanguage(currentLang);
    updateLanguageAttribute(currentLang);
    return translation as unknown as string;
  };
}
