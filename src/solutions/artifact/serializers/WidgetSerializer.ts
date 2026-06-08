import {
  getWidgetFenceLanguage,
  WIDGET_TYPES,
  type WidgetType,
} from 'src/solutions/commands/agents/handlers/ShowWidget';
import { ArtifactSerializer, ArtifactType, WidgetArtifact } from '../types';
import type StewardPlugin from 'src/main';

export class WidgetSerializer extends ArtifactSerializer {
  constructor(private plugin: StewardPlugin) {
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

    const message = await this.plugin.conversationRenderer.getMessageById(
      this.title,
      contentMessageId
    );
    if (!message?.content) {
      throw new Error(`Widget fence not found in message: ${contentMessageId}`);
    }

    const projectParsed = this.plugin.widgetService.parseProjectFenceContent(message.content);
    if (projectParsed) {
      const files = await this.plugin.widgetService.listProjectFiles(projectParsed.projectPath);
      const { manifest } = await this.plugin.widgetService.definitionService.getWidgetDefinition(
        projectParsed.projectPath
      );

      return {
        artifactType: ArtifactType.WIDGET,
        contentMessageId,
        type: 'html',
        projectPath: projectParsed.projectPath,
        widgetId: projectParsed.widgetId,
        entry: manifest?.entry ?? 'index.html',
        files,
      };
    }

    const legacyParsed = this.parseLegacyWidgetFence(message.content);
    if (!legacyParsed) {
      throw new Error(`Widget fence not found in message: ${contentMessageId}`);
    }

    return {
      artifactType: ArtifactType.WIDGET,
      contentMessageId,
      type: legacyParsed.type,
      code: legacyParsed.code,
    };
  }

  private parseLegacyWidgetFence(content: string): { type: WidgetType; code: string } | null {
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
