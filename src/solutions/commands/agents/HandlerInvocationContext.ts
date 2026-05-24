import type { AgentHandlerContext } from './AgentHandlerContext';
import type { AgentHandlerParams, Intent } from '../types';
import type { ToolCallPart, ToolResultPart } from '../tools/types';
import { ConversationRenderer } from 'src/services/ConversationRenderer';

export class HandlerInvocationContext {
  private _lang: string | null | undefined;
  private _step: number;

  /**
   * Same object as the agent's current handle() params (e.g. for mutating `activeTools` during tool execution).
   */
  readonly agentHandlerParams: AgentHandlerParams;

  constructor(
    private readonly params: {
      title: string;
      handlerId: string;
      step: number;
      lang: string | null | undefined;
      intent: Intent;
      agent: AgentHandlerContext;
      agentHandlerParams: AgentHandlerParams;
    }
  ) {
    this._lang = params.lang;
    this._step = params.step;
    this.agentHandlerParams = params.agentHandlerParams;
  }

  get title() {
    return this.params.title;
  }

  get handlerId() {
    return this.params.handlerId;
  }

  get step() {
    return this._step;
  }

  get lang() {
    return this._lang;
  }

  get intent() {
    return this.params.intent;
  }

  get agent() {
    return this.params.agent;
  }

  setLang(lang: string | null) {
    this._lang = lang;
  }

  incrementStep() {
    this._step += 1;
  }

  async serializeInvocation<T>(params: {
    command: string;
    toolCall: ToolCallPart<T>;
    result: ToolResultPart['output'];
  }): Promise<void> {
    await this.agent.renderer.serializeToolInvocation({
      path: this.title,
      command: params.command,
      handlerId: this.handlerId,
      step: this.step,
      toolInvocations: [
        {
          ...params.toolCall,
          type: 'tool-result',
          output: params.result,
        },
      ],
    });
  }

  async updateConversationNote(
    params: Pick<
      Parameters<ConversationRenderer['updateConversationNote']>[0],
      | 'agent'
      | 'newContent'
      | 'command'
      | 'replacePlaceHolder'
      | 'messageId'
      | 'role'
      | 'includeHistory'
      | 'artifactContent'
    >
  ): Promise<string | undefined> {
    return this.agent.renderer.updateConversationNote({
      path: this.title,
      handlerId: this.handlerId,
      step: this.step,
      lang: this.lang,
      ...params,
    });
  }

  streamConversationNote(params: { stream: AsyncIterable<string> }) {
    return this.agent.renderer.streamConversationNote({
      path: this.title,
      handlerId: this.handlerId,
      step: this.step,
      stream: params.stream,
    });
  }
}
