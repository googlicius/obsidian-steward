import i18next from 'i18next';
import en from './locales/en';
import vi from './locales/vi';
import ja from './locales/ja';
import { getObsidianLanguage } from '../utils/getObsidianLanguage';

// Get the default language from Obsidian
const obsidianLang = getObsidianLanguage();
// Map Obsidian language to our supported languages or fallback to English
const defaultLang = ['en', 'vi', 'ja'].includes(obsidianLang) ? obsidianLang : 'en';

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

export default i18next;

// Utility function to get the translation function for a specific language
export function getTranslation(lang = 'en') {
  return (key: string, options?: any): string => {
    // Change language temporarily, get translation, then restore
    const currentLang = i18next.language;
    i18next.changeLanguage(lang);
    const translation = i18next.t(key, options);
    i18next.changeLanguage(currentLang);
    return translation as unknown as string;
  };
}
