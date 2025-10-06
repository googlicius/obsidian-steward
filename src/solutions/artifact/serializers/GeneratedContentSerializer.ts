import { ConversationMessage } from 'src/types/types';
import { ArtifactSerializer, ArtifactType, GeneratedContentArtifact } from '../types';

export class GeneratedContentSerializer extends ArtifactSerializer {
  constructor(
    private getMessageById: (
      conversationTitle: string,
      messageId: string
    ) => Promise<ConversationMessage | null>
  ) {
    super();
  }

  serialize(artifact: GeneratedContentArtifact): string {
    return '```stw-artifact\nmessageRef:' + artifact.messageId + '\n```';
  }

  async deserialize(data: string): Promise<GeneratedContentArtifact> {
    const messageId = data.match(/```stw-artifact\nmessageRef:(.*?)\n```/)?.[1];
    if (!messageId) {
      throw new Error('Invalid message ID');
    }
    if (!this.title) {
      throw new Error('Conversation title is not set');
    }
    const message = await this.getMessageById(this.title, messageId);

    return {
      artifactType: ArtifactType.GENERATED_CONTENT,
      messageId,
      content: message?.content || '',
    };
  }
}
