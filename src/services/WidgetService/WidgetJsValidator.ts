import { parse } from 'acorn';

export interface WidgetJsValidationError {
  filePath: string;
  message: string;
  line?: number;
  column?: number;
}

/** Parse-only JavaScript syntax checks for widget project files. */
export class WidgetJsValidator {
  /** Returns true when the path looks like a JavaScript source file. */
  public isJsFilePath(filePath: string): boolean {
    const fileName = filePath.split('/').pop() ?? filePath;
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex <= 0) {
      return false;
    }
    return fileName.slice(dotIndex + 1).toLowerCase() === 'js';
  }

  /** Parses JavaScript content without executing it. Returns null when valid. */
  public validateContent(params: {
    filePath: string;
    content: string;
  }): WidgetJsValidationError | null {
    try {
      parse(params.content, { ecmaVersion: 'latest', sourceType: 'script' });
      return null;
    } catch (error) {
      const syntaxError = error as SyntaxError & {
        loc?: { line: number; column: number };
      };

      return {
        filePath: params.filePath,
        message: syntaxError.message,
        line: syntaxError.loc?.line,
        column: syntaxError.loc?.column,
      };
    }
  }

  /** Validates every `.js` file in a path → content map (project-relative or vault paths). */
  public validateProjectFiles(files: Record<string, string>): WidgetJsValidationError[] {
    const errors: WidgetJsValidationError[] = [];
    const paths = Object.keys(files);

    for (let i = 0; i < paths.length; i++) {
      const filePath = paths[i];
      if (!this.isJsFilePath(filePath)) {
        continue;
      }

      const error = this.validateContent({ filePath, content: files[filePath] });
      if (error) {
        errors.push(error);
      }
    }

    return errors;
  }

  /** Formats validation errors for tool results and thrown errors. */
  public formatErrors(errors: WidgetJsValidationError[]): string {
    const lines: string[] = ['Invalid JavaScript in widget project:'];

    for (let i = 0; i < errors.length; i++) {
      const error = errors[i];
      const location =
        error.line !== undefined
          ? ` (${error.line}${error.column !== undefined ? `:${error.column}` : ''})`
          : '';
      lines.push(`- ${error.filePath}${location}: ${error.message}`);
    }

    return lines.join('\n');
  }
}
