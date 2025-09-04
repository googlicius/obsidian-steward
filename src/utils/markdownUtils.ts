export class MarkdownUtil {
  constructor(private text: string) {}

  /**
   * Escapes common Markdown special characters in a string by prepending a backslash.
   * This is useful for rendering text literally without Markdown processing.
   */
  escape(escapeNewlines = false) {
    const specialChars = /[\\`*_{}[\]()#+-.!|>~^]/g;

    this.text = this.text.replace(specialChars, '\\$&');

    if (escapeNewlines) {
      this.text = this.text.replace(/\n/g, '\\n');
    }

    return this;
  }

  unescape() {
    const escapedChars = /\\(?=[`*_{}[\]()#+-.!|>~^])/g;

    this.text = this.text.replace(escapedChars, '').replace(/\\n/g, '\n');

    this.decodeFromDataset();

    return this;
  }

  /**
   * Encodes special characters that would break dataset key:value parsing.
   * Specifically handles ':' and ',' which are used as delimiters in callout metadata.
   * @returns Encoded string safe for use in callout metadata
   */
  encodeForDataset() {
    this.text = this.text.replace(/:/g, '%3A').replace(/,/g, '%2C');
    return this;
  }

  /**
   * Decodes a string that was encoded with encodeForDataset.
   * @returns Decoded original string
   */
  decodeFromDataset() {
    this.text = this.text.replace(/%3A/g, ':').replace(/%2C/g, ',');
    return this;
  }

  decodeURI() {
    this.text = decodeURIComponent(this.text);
    return this;
  }

  getText() {
    return this.text;
  }
}
