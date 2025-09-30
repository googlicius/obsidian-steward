import { Artifact, ArtifactSerializer, ArtifactType } from '../types';

/**
 * Serializer for JSON-based artifacts
 */
export class JsonArtifactSerializer implements ArtifactSerializer {
  constructor(private type: ArtifactType) {}

  /**
   * Serialize an artifact to a JSON string wrapped in stw-artifact block
   */
  serialize(artifact: Artifact): string {
    // Convert the artifact to JSON
    const serialized = JSON.stringify(artifact);

    // Wrap in a stw-artifact block
    return `\`\`\`stw-artifact\n${serialized}\n\`\`\``;
  }

  /**
   * Deserialize a string to an artifact
   * @param data The string to deserialize (possibly containing a stw-artifact block)
   * @returns The deserialized artifact
   */
  deserialize(data: string): Artifact | Promise<Artifact> {
    try {
      // Extract JSON from stw-artifact block if present
      const jsonString = data.includes('```stw-artifact')
        ? data.match(/```stw-artifact\n([\s\S]*?)\n```/)?.[1] || data
        : data;

      // Parse the JSON
      const parsed = JSON.parse(jsonString);

      // Validate the parsed data
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid artifact data: not an object');
      }

      if (parsed.artifactType !== this.type) {
        if (parsed.artifactType) {
          throw new Error(`Type mismatch: expected ${this.type}, got ${parsed.artifactType}`);
        } else {
          // It's OK to parsed without artifactType
        }
      }

      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in artifact data: ${error.message}`);
      }
      throw error;
    }
  }
}
