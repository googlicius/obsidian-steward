import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolCallPart } from 'src/solutions/commands/tools/types';
import type { CreateToolArgs } from 'src/solutions/commands/agents/handlers/VaultCreate';
import type { ToolCallContentReducer } from './types';

/** Model-facing only (never shown to the user), so this is not localized. */
const CONTENT_OMITTED_NOTICE = `Content was omitted to save tokens. Use the ${ToolName.CONTENT_READING} tool to inspect it if needed.`;

/** Reduces `create` tool calls: replaces new-file content with a short placeholder pointing at content_reading. */
export class CreateContentReducer implements ToolCallContentReducer {
  readonly toolName = ToolName.CREATE;

  reduceToolCall(params: {
    toolCall: ToolCallPart;
    messageId: string;
    lang?: string | null;
  }): ToolCallPart {
    const toolCall = params.toolCall as ToolCallPart<CreateToolArgs>;

    return {
      ...toolCall,
      input: {
        ...toolCall.input,
        newFiles: (toolCall.input.newFiles ?? []).map(file => ({
          ...file,
          content: file.content ? CONTENT_OMITTED_NOTICE : undefined,
        })),
      },
    };
  }
}
