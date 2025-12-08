import { tool } from 'ai';
import { z } from 'zod';

const getMostRecentArtifactSchema = z.object({
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
