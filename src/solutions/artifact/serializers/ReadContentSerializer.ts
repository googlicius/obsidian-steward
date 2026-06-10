import { z } from 'zod/v3';
import { ArtifactSerializer, ArtifactType, ReadContentArtifact } from '../types';
import type StewardPlugin from 'src/main';
import { ReadContentArtifactImpl } from '../implements';

const editorPositionSchema = z.object({
  line: z.number(),
  ch: z.number(),
});

const editorRangeSchema = z.object({
  from: editorPositionSchema,
  to: editorPositionSchema,
});

const sectionDetailSchema = z.object({
  type: z.string(),
  startLine: z.number(),
  endLine: z.number(),
});

const contentBlockSchema = z.object({
  startLine: z.number(),
  endLine: z.number(),
  sections: z.array(sectionDetailSchema),
  content: z.string(),
});

const contentReadingResultSchema = z.object({
  blocks: z.array(contentBlockSchema),
  source: z.enum(['cursor', 'element', 'entire', 'frontmatter', 'unknown']),
  elementType: z.string().optional(),
  file: z
    .object({
      path: z.string(),
      name: z.string(),
    })
    .optional(),
  range: editorRangeSchema.optional(),
  instruction: z.string().optional(),
  imageVisionNotice: z.string().optional(),
});

const readContentArtifactSchema = z.object({
  artifactType: z.literal(ArtifactType.READ_CONTENT),
  readingResults: z.array(contentReadingResultSchema),
  imagePaths: z.array(z.string()).optional(),
  createdAt: z.number().optional(),
  id: z.string().optional(),
  messageId: z.string().optional(),
  deleteReason: z.string().optional(),
});

function parseReadContentArtifact(data: unknown): ReadContentArtifact {
  const parseResult = readContentArtifactSchema.safeParse(data);
  if (!parseResult.success) {
    throw new Error(`Invalid read content artifact: ${parseResult.error.message}`);
  }
  return parseResult.data;
}

function parseReadContentArtifactJson(data: string): ReadContentArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in read content artifact: ${error.message}`);
    }
    throw error;
  }
  return parseReadContentArtifact(parsed);
}

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
    const artifactData =
      typeof data === 'string'
        ? parseReadContentArtifactJson(data)
        : parseReadContentArtifact(data);

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

    return new ReadContentArtifactImpl({
      ...artifactData,
      imagePaths: imagePaths.size > 0 ? Array.from(imagePaths) : undefined,
    });
  }
}
