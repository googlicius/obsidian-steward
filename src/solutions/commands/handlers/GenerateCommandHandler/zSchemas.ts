import { z } from 'zod';

export const fileIncludingSchema = z.object({
  filePath: z.string().describe(`The path of the file to read.`),
  explanation: z.string().describe(`A brief explanation of why reading this file is necessary.`),
});

export type FileIncludingArgs = z.infer<typeof fileIncludingSchema>;
