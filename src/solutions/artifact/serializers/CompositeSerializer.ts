import { Artifact, ArtifactSerializer } from '../types';

/**
 * A serializer that chains multiple serializers together
 * For serialization, it applies the serializers in order
 * For deserialization, it applies the serializers in reverse order
 */
export class CompositeSerializer implements ArtifactSerializer {
  private serializers: ArtifactSerializer[];

  /**
   * Create a new composite serializer
   * @param serializers The serializers to chain, in the order they should be applied for serialization
   */
  constructor(...serializers: ArtifactSerializer[]) {
    if (serializers.length === 0) {
      throw new Error('CompositeSerializer requires at least one serializer');
    }
    this.serializers = serializers;
  }

  /**
   * Serialize an artifact by applying each serializer in order
   * @param artifact The artifact to serialize
   * @returns The serialized artifact
   */
  serialize(artifact: Artifact): string {
    let result = this.serializers[0].serialize(artifact);

    // Apply each serializer in order, except the first one
    for (const serializer of this.serializers.slice(1)) {
      result = serializer.serialize(JSON.parse(result));
    }

    return result;
  }

  /**
   * Deserialize a string by applying each serializer in reverse order
   * @param data The string to deserialize
   * @returns The deserialized artifact
   */
  async deserialize(data: string): Promise<Artifact> {
    // Start with the last serializer
    let result: string | Artifact = data;
    const lastIndex = this.serializers.length - 1;

    // Handle the last serializer first (usually JsonSerializer that extracts from stw-artifact block)
    const lastSerializer = this.serializers[lastIndex];
    result = await lastSerializer.deserialize(result);

    // Apply remaining serializers in reverse order
    for (let i = lastIndex - 1; i >= 0; i--) {
      const serializer = this.serializers[i];

      // For intermediate serializers, we need to convert the artifact to string
      // because serializers expect string input
      const intermediateData: string = typeof result === 'string' ? result : JSON.stringify(result);
      result = await serializer.deserialize(intermediateData);
    }

    return result;
  }
}
