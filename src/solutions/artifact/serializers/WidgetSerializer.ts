import { ConversationMessage } from 'src/types/types';
import {
  getWidgetFenceLanguage,
  WIDGET_TYPES,
  type WidgetType,
} from 'src/solutions/commands/agents/handlers/ShowWidget';
import { ArtifactSerializer, ArtifactType, WidgetArtifact } from '../types';

export class WidgetSerializer extends ArtifactSerializer {
  constructor(
    private getMessageById: (
      conversationTitle: string,
      messageId: string
    ) => Promise<ConversationMessage | null>
  ) {
    super();
  }

  serialize(artifact: WidgetArtifact): string {
    return '```stw-artifact\nmessageRef:' + artifact.contentMessageId + '\n```';
  }

  async deserialize(data: string): Promise<WidgetArtifact> {
    const contentMessageId = data.match(/```stw-artifact\nmessageRef:(.*?)\n```/)?.[1];
    if (!contentMessageId) {
      throw new Error('Invalid widget artifact: missing content message reference');
    }
    if (!this.title) {
      throw new Error('Conversation title is not set');
    }

    const message = await this.getMessageById(this.title, contentMessageId);
    const parsed = message?.content ? this.parseWidgetFence(message.content) : null;
    if (!parsed) {
      throw new Error(`Widget fence not found in message: ${contentMessageId}`);
    }

    return {
      artifactType: ArtifactType.WIDGET,
      contentMessageId,
      type: parsed.type,
      code: parsed.code,
    };
  }

  private parseWidgetFence(content: string): { type: WidgetType; code: string } | null {
    for (let i = 0; i < WIDGET_TYPES.length; i++) {
      const type = WIDGET_TYPES[i];
      const language = getWidgetFenceLanguage(type);
      const pattern = new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\\n\`\`\``);
      const match = content.match(pattern);
      if (match) {
        return { type, code: match[1] };
      }
    }
    return null;
  }
}
