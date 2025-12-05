import { tool } from 'ai';
import { z } from 'zod';
import { ArtifactType } from 'src/solutions/artifact';

const getMostRecentArtifactSchema = z.object({
  artifactTypes: z
    .array(z.nativeEnum(ArtifactType))
    .min(1)
    .describe(
      'List of artifact types to search for. Returns the most recent artifact matching any of these types.'
    ),
  explanation: z
    .string()
    .min(1)
    .describe('Brief explanation of why retrieving this artifact is needed.'),
});

const getArtifactByIdSchema = z.object({
  artifactId: z.string().min(1).describe('The ID of the artifact to retrieve.'),
  explanation: z
    .string()
    .min(1)
    .describe('Brief explanation of why retrieving this artifact is needed.'),
});

export type GetMostRecentArtifactArgs = z.infer<typeof getMostRecentArtifactSchema>;
export type GetArtifactByIdArgs = z.infer<typeof getArtifactByIdSchema>;

export const getMostRecentArtifact = tool({
  parameters: getMostRecentArtifactSchema,
});

export const getArtifactById = tool({
  parameters: getArtifactByIdSchema,
});
