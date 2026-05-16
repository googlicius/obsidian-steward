import { logger } from 'src/utils/logger';
import { IVersionedUserDefinedCommand } from './types';
import { z } from 'zod/v3';

/**
 * Result type for loading a versioned command
 */
export type LoadCommandResult =
  | { success: true; command: IVersionedUserDefinedCommand }
  | { success: false; errors: string[] };

/**
 * Detect and load the appropriate version of a user-defined command
 */
export async function loadUDCVersion(
  rawData: { command_name: string; version?: number; [key: string]: unknown },
  filePath: string,
  /** From the defining note's YAML frontmatter: omit / true → true, false → false. */
  noteEnabled = true
): Promise<LoadCommandResult> {
  try {
    // Check for explicit version field, default to version 2 if not specified
    const data = rawData as { version?: number; [key: string]: unknown };
    const explicitVersion = data.version ?? 2;

    if (explicitVersion === 1) {
      const { UserDefinedCommandV1 } = await import('./v1');
      const v1Data = UserDefinedCommandV1.validate(rawData);
      v1Data.file_path = filePath;
      return { success: true, command: new UserDefinedCommandV1(v1Data, noteEnabled) };
    }

    if (explicitVersion === 2) {
      const { UserDefinedCommandV2 } = await import('./v2');
      const v2Data = UserDefinedCommandV2.validate(rawData);
      v2Data.file_path = filePath;
      return { success: true, command: new UserDefinedCommandV2(v2Data, noteEnabled) };
    }

    // Unsupported version
    return {
      success: false,
      errors: [`Unsupported version: ${explicitVersion}.`],
    };
  } catch (error) {
    const errors: string[] = [];
    if (error instanceof z.ZodError) {
      const commandName = rawData.command_name || 'unknown';
      logger.error(`Invalid command ${commandName}:`);

      const addError = (path: string, message: string) => {
        const errorMsg = `${path}: ${message}`;
        errors.push(errorMsg);
        logger.error(`  - ${errorMsg}`);
      };

      for (const issue of error.errors) {
        // Handle invalid_union errors - extract nested errors
        if (issue.code === 'invalid_union') {
          for (const unionError of issue.unionErrors) {
            for (const nestedIssue of unionError.issues) {
              const path = nestedIssue.path.join('.');
              addError(path, nestedIssue.message);
            }
          }
        } else {
          // Handle regular errors
          const path = issue.path.join('.');
          addError(path, issue.message);
        }
      }
    } else {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(errorMsg);
      logger.error('Invalid command definition:', error);
    }
    return { success: false, errors };
  }
}
