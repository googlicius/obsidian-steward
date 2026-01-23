/**
 * Jest transformer for .md files.
 * Returns the raw file content as a string, mimicking esbuild's text loader.
 */
module.exports = {
  process(sourceText) {
    return {
      code: `module.exports = ${JSON.stringify(sourceText)};`,
    };
  },
};
