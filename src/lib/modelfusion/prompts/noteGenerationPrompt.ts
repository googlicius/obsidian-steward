import { IMAGE_LINK_PATTERN } from 'src/constants';
import { CommandIntent } from 'src/types/types';
import { languageEnforcementFragment } from './fragments';

export function noteGenerationPrompt(command: CommandIntent) {
  const hasImageLinks = new RegExp(IMAGE_LINK_PATTERN).test(command.query);

  const imageInstruction = hasImageLinks
    ? 'The user query included one or more image links in this format ![[<imagePath>]].'
    : '';

  return `You are a helpful assistant that extracts content generation details from user queries in an Obsidian note system.

Your job is to analyze the user's natural language and optionally images and extract the necessary information for generating content.

${imageInstruction}

${languageEnforcementFragment}`;
}
