/**
 * Stateful parser that incrementally extracts a target string field value
 * from streaming JSON `argsTextDelta` chunks (as emitted by AI SDK tool-call-delta).
 *
 * For edit tool calls, it tracks the `mode` field per object and only extracts
 * `content` when mode is `replace_by_lines`. For other tools (e.g., create),
 * it extracts `content` unconditionally.
 */
export class PartialJsonFieldExtractor {
  private buffer = '';
  private pos = 0;

  // JSON structural state
  private depth = 0;
  private inString = false;
  private escapeNext = false;
  private currentKey = '';
  private buildingKey = false;
  private buildingValue = false;

  // Target field extraction state
  private extracting = false;
  private skippingValue = false;

  // Mode tracking for edit tool (only extract content when mode matches)
  private currentMode = '';
  private buildingModeValue = false;
  private modeBuffer = '';
  private objectDepthForMode = -1;

  constructor(
    private readonly targetField: string,
    private readonly options: {
      /** When set, only extract targetField when this mode value is active in the same object */
      requiredMode?: string;
    } = {}
  ) {}

  /**
   * Feed a chunk of argsTextDelta JSON text.
   * Returns any extracted target field content decoded from JSON string escapes.
   */
  public feed(delta: string): string {
    this.buffer += delta;
    let result = '';

    while (this.pos < this.buffer.length) {
      const ch = this.buffer[this.pos];
      this.pos++;

      if (this.escapeNext) {
        if (this.extracting) {
          result += this.decodeEscape(ch);
        } else if (this.buildingModeValue) {
          this.modeBuffer += this.decodeEscape(ch);
        } else if (this.buildingKey) {
          this.currentKey += ch;
        }
        this.escapeNext = false;
        continue;
      }

      if (ch === '\\' && this.inString) {
        this.escapeNext = true;
        continue;
      }

      if (this.skippingValue) {
        if (ch === '"') {
          this.skippingValue = false;
          this.inString = false;
          this.buildingValue = false;
        }
        continue;
      }

      if (this.extracting) {
        if (ch === '"') {
          this.extracting = false;
          this.inString = false;
          this.buildingValue = false;
          continue;
        }
        result += ch;
        continue;
      }

      if (this.buildingModeValue) {
        if (ch === '"') {
          this.currentMode = this.modeBuffer;
          this.modeBuffer = '';
          this.buildingModeValue = false;
          this.inString = false;
          this.buildingValue = false;
          continue;
        }
        this.modeBuffer += ch;
        continue;
      }

      if (this.buildingKey) {
        if (ch === '"') {
          this.buildingKey = false;
          this.inString = false;
          continue;
        }
        this.currentKey += ch;
        continue;
      }

      if (ch === '"') {
        this.inString = true;

        if (this.buildingValue) {
          if (this.currentKey === this.targetField && this.shouldExtract()) {
            this.extracting = true;
            continue;
          }
          if (this.currentKey === 'mode' && this.options.requiredMode) {
            this.buildingModeValue = true;
            this.modeBuffer = '';
            continue;
          }
          this.skippingValue = true;
          continue;
        }

        // Starting a key
        this.buildingKey = true;
        this.currentKey = '';
        continue;
      }

      if (ch === ':' && !this.inString) {
        this.buildingValue = true;
        continue;
      }

      if (ch === '{' && !this.inString) {
        this.depth++;
        if (this.options.requiredMode && this.objectDepthForMode < 0) {
          this.objectDepthForMode = this.depth;
          this.currentMode = '';
        }
        this.buildingValue = false;
        continue;
      }

      if (ch === '}' && !this.inString) {
        if (this.options.requiredMode && this.depth === this.objectDepthForMode) {
          this.objectDepthForMode = -1;
          this.currentMode = '';
        }
        this.depth--;
        this.buildingValue = false;
        continue;
      }

      if (ch === '[' && !this.inString) {
        this.buildingValue = false;
        continue;
      }

      if (ch === ']' && !this.inString) {
        this.buildingValue = false;
        continue;
      }

      if (ch === ',' && !this.inString) {
        this.buildingValue = false;
        continue;
      }
    }

    // Compact the buffer to avoid unbounded growth
    if (this.pos > 4096) {
      this.buffer = this.buffer.slice(this.pos);
      this.pos = 0;
    }

    return result;
  }

  private shouldExtract(): boolean {
    if (!this.options.requiredMode) {
      return true;
    }
    return this.currentMode === this.options.requiredMode;
  }

  private decodeEscape(ch: string): string {
    switch (ch) {
      case '"':
        return '"';
      case '\\':
        return '\\';
      case '/':
        return '/';
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case 'u':
        return this.decodeUnicodeEscape();
      default:
        return ch;
    }
  }

  private decodeUnicodeEscape(): string {
    const remaining = this.buffer.slice(this.pos, this.pos + 4);
    if (remaining.length < 4) {
      // Not enough data yet - store what we have and return placeholder
      return `\\u${remaining}`;
    }
    this.pos += 4;
    const codePoint = parseInt(remaining, 16);
    if (isNaN(codePoint)) {
      return `\\u${remaining}`;
    }
    return String.fromCharCode(codePoint);
  }
}
