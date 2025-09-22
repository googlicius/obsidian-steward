import { explanationFragment } from 'src/lib/modelfusion/prompts/fragments';
import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';
import { z } from 'zod';

/**
 * Represents a single search operation with v2 parameters
 */
export interface SearchOperationV2 {
  keywords: string[];
  filenames: string[];
  folders: string[];
  properties: Array<{ name: string; value: string }>;
}

/**
 * Represents the extracted search parameters from a natural language request (v2)
 */
export interface SearchQueryExtractionV2 {
  operations: SearchOperationV2[];
  explanation: string;
  lang?: string;
  confidence: number;
  needsLLM: boolean;
}

// Define the Zod schema for search operation validation
const searchOperationSchema = z.object({
  keywords: z.array(z.string()).describe(`General terms or concepts to search for in file content.
If a term or phrase is wrapped in quotation marks (e.g., "cat or dog"),
preserve the quotes exactly as is for exact match queries.`),
  filenames: z.array(z.string()).describe(`Specific file names to search for (without .md extension)
- Includes only when the user explicitly mentions a file name or note name`),
  folders: z.array(z.string()).describe(`Specific folder paths to search within
- If the user wants to search in the root folder, use ^/$`),
  properties: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
    })
  ).describe(`Properties to search for in files:
- For tags: use name: "tag" and value without # symbol
- For file types: use name: "file_type" and value: extension (e.g., "md", "pdf", "jpg")
- For file categories: use name: "file_category" and value: category (e.g., "document", "image", "audio", "video", "data", "code")
- For frontmatter properties: use the property name and value
Examples:
- For images: {name: "file_category", value: "image"}
- For PDFs: {name: "file_type", value: "pdf"}
- For notes: {name: "file_type", value: "md"}
- For documents with status "completed": {name: "status", value: "completed"}`),
});

// Define the Zod schema for search query extraction validation
export const searchQueryExtractionSchema = z.object({
  operations: z.array(searchOperationSchema).describe(`An array of search operations.
If the user wants to search with different criteria in different locations, return multiple operations.
  `),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
  lang: z
    .string()
    .optional()
    .describe(userLanguagePrompt.content as string),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(`A number from 0 to 1 indicating confidence in this interpretation`),
});
