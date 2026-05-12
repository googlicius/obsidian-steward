/**
 * First-party modules bundled by `scripts/build-bundled-libs.mjs`, LZ-compressed to Base64,
 * and evaluated from `src/utils/bundledInternals.ts` so `main.js` does not parse them at startup.
 *
 * Add more namespaces (services, solutions, …) here as they move into this payload.
 */
import i18next, { getTranslation, updateLanguageAttribute } from './i18n';

const bundledInternals = {
  i18n: {
    i18next,
    getTranslation,
    updateLanguageAttribute,
  },
};

export type BundledInternals = typeof bundledInternals;

export default bundledInternals;
