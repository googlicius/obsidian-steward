import { IMAGE_LINK_PATTERN } from 'src/constants';
import { Intent } from 'src/solutions/commands/types';
import { languageEnforcementFragment } from './fragments';

export function noteGenerationPrompt(intent: Intent) {
  const hasImageLinks = new RegExp(IMAGE_LINK_PATTERN).test(intent.query);

  const imageInstruction = hasImageLinks
    ? '\nThe user query included one or more image links in this format ![[<imagePath>]].\n'
    : '';

  return `You are a helpful assistant that extracts content generation details from user queries in an Obsidian note system.

Your job is to analyze the user's natural language and optionally images and extract the necessary information for generating content.
${imageInstruction}
${languageEnforcementFragment}`;
}
