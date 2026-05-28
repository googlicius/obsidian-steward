import { ArtifactSerializer, ReadContentArtifact } from '../types';
import type StewardPlugin from 'src/main';
import { ReadContentArtifactImpl } from '../implements';

/**
 * Serializer for read content artifacts that extracts images during deserialization
 */
export class ReadContentSerializer extends ArtifactSerializer {
  constructor(private plugin: StewardPlugin) {
    super();
  }

  /**
   * Serialize a read content artifact (pass through, handled by JSON serializer)
   */
  serialize(artifact: ReadContentArtifact): ReadContentArtifact {
    return artifact;
  }

  /**
   * Deserialize a read content artifact and extract images from the content
   */
  async deserialize(data: string | ReadContentArtifact): Promise<ReadContentArtifact> {
    // If data is already an artifact, use it directly
    const artifactData: ReadContentArtifact = typeof data === 'string' ? JSON.parse(data) : data;

    const imagePaths = new Set<string>();

    for (const readingResult of artifactData.readingResults) {
      if (readingResult.imageVisionNotice) {
        continue;
      }
      for (const path of this.plugin.contentReadingService.collectImagePathsFromReadingResult(
        readingResult
      )) {
        imagePaths.add(path);
      }
    }

    // Create class instance with image paths
    return new ReadContentArtifactImpl({
      ...artifactData,
      imagePaths: imagePaths.size > 0 ? Array.from(imagePaths) : undefined,
    });
  }
}
