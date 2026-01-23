import { ArtifactSerializer, ReadContentArtifact } from '../types';
import { IMAGE_EXTENSIONS, IMAGE_LINK_PATTERN } from 'src/constants';
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

    const addImagePathIfValid = (path: string | undefined) => {
      if (!path) return;
      const normalizedPath = path.toLowerCase();
      const lastIndex = normalizedPath.lastIndexOf('.');
      const extension = lastIndex > 0 ? normalizedPath.slice(lastIndex + 1) : null;
      if (extension && IMAGE_EXTENSIONS.includes(extension)) {
        imagePaths.add(path);
      }
    };

    // Extract images from all reading results
    for (const readingResult of artifactData.readingResults) {
      // Add file path if it's an image
      addImagePathIfValid(readingResult.file?.path);

      // Extract images from all blocks' content
      const allContent = readingResult.blocks.map(block => block.content).join('\n');

      // Extract image links
      const imageRegex = new RegExp(IMAGE_LINK_PATTERN, 'gi');
      const matches = allContent.matchAll(imageRegex);

      for (const match of matches) {
        if (match[1]) {
          addImagePathIfValid(match[1]);
        }
      }
    }

    // Create class instance with image paths
    return new ReadContentArtifactImpl({
      ...artifactData,
      imagePaths: imagePaths.size > 0 ? Array.from(imagePaths) : undefined,
    });
  }
}
