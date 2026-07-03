import type { ToolCallPart as AI_ToolCallPart, ToolResultPart as AI_ToolResultPart } from 'ai';
import { ToolName } from '../toolNames';
import type { ActivateToolsArgs } from './activateTools';
import type { SpawnSubagentArgs } from '../agents/handlers/SpawnSubagent';
import type { TodoWriteArgs } from '../agents/handlers/TodoList';
import type { ExistsToolArgs } from '../agents/handlers/VaultExists';
import type { ContentReadingArgs } from '../agents/handlers/ReadContent';
import type { GrepToolArgs } from '../agents/handlers/VaultGrep';
import type { ListToolArgs } from '../agents/handlers/VaultList';

export type ToolInvocation<T, ARGS = Record<string, unknown>> = {
  toolName: string;
  toolCallId: string;
  args: ARGS;
  result?: T;
};

export type ToolInvocationResult<T, ARGS = Record<string, unknown>> = {
  toolName: string;
  toolCallId: string;
  args: ARGS;
  result: T;
};

//-----------------
// AI SDK Version 6
//-----------------

export type ToolCallPart<INPUT = Record<string, unknown>> = AI_ToolCallPart & {
  input: INPUT;
  toolName: ToolName;
};

export type ToolResultPart<OUTPUT = unknown> = AI_ToolResultPart & {
  output: OUTPUT;
};

/**
 * A ToolCallPart with a specific toolName literal and a typed input.
 * Use this as the building block for discriminated union members.
 */
export type ToolCallPartOf<N extends ToolName, INPUT> = Omit<AI_ToolCallPart, 'toolName'> & {
  toolName: N;
  input: INPUT;
};

/** Input shape for the CONFIRMATION tool. */
export interface ConfirmationInput {
  message: string;
  [key: string]: unknown;
}

/** A single question within an ask_user_preference call. */
export interface UserPreferenceQuestion {
  question: string;
  options: string[];
}

/** Input shape for ask_user_preference. */
export interface AskUserPreferenceInput {
  questions: UserPreferenceQuestion[];
  [key: string]: unknown;
}

/**
 * Discriminated union of all tool calls whose input types are known.
 * Adding a new handled tool: add a new `| ToolCallPartOf<ToolName.FOO, FooArgs>` member.
 */
export type KnownToolCallPart =
  | ToolCallPartOf<ToolName.CONFIRMATION, ConfirmationInput>
  | ToolCallPartOf<ToolName.ASK_USER_PREFERENCE, AskUserPreferenceInput>
  | ToolCallPartOf<ToolName.ACTIVATE, ActivateToolsArgs>
  | ToolCallPartOf<ToolName.SPAWN_SUBAGENT, SpawnSubagentArgs>
  | ToolCallPartOf<ToolName.TODO_WRITE, TodoWriteArgs>
  | ToolCallPartOf<ToolName.EXISTS, ExistsToolArgs>
  | ToolCallPartOf<ToolName.CONTENT_READING, ContentReadingArgs>
  | ToolCallPartOf<ToolName.GREP, GrepToolArgs>
  | ToolCallPartOf<ToolName.LIST, ListToolArgs>;

/** Catch-all for tool calls whose input type is not specifically modelled above. */
export type UnknownToolCallPart = ToolCallPartOf<
  Exclude<ToolName, KnownToolCallPart['toolName']>,
  Record<string, unknown>
>;

/**
 * The full discriminated union used by ToolCallExecutor.
 * TypeScript narrows `input` automatically inside each `case` arm.
 */
export type TypedToolCallPart = KnownToolCallPart | UnknownToolCallPart;
