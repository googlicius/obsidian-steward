import { z } from 'zod/v3';
import { getCdnLib } from 'src/utils/cdnUrls';

const getMostRecentArtifactSchema = z.object({});

const getArtifactByIdSchema = z.object({
  artifactId: z.string().min(1).describe('The ID of the artifact to retrieve.'),
});

export type GetMostRecentArtifactArgs = z.infer<typeof getMostRecentArtifactSchema>;
export type GetArtifactByIdArgs = z.infer<typeof getArtifactByIdSchema>;

export async function getMostRecentArtifact() {
  const { tool } = await getCdnLib('ai');
  return tool({ inputSchema: getMostRecentArtifactSchema });
}

export async function getArtifactById() {
  const { tool } = await getCdnLib('ai');
  return tool({ inputSchema: getArtifactByIdSchema });
}
