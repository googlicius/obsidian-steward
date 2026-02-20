export type { InputNormalizer } from './InputNormalizer';

import type { InputNormalizer } from './InputNormalizer';
import { EditInputNormalizer } from './EditInputNormalizer';
import { SearchInputNormalizer } from './SearchInputNormalizer';
import { DeleteInputNormalizer } from './DeleteInputNormalizer';
import { MoveInputNormalizer } from './MoveInputNormalizer';
import { RenameInputNormalizer } from './RenameInputNormalizer';
import { ReadContentInputNormalizer } from './ReadContentInputNormalizer';

const ALL_INPUT_NORMALIZERS: InputNormalizer[] = [
  new ReadContentInputNormalizer(),
  new EditInputNormalizer(),
  new SearchInputNormalizer(),
  new DeleteInputNormalizer(),
  new MoveInputNormalizer(),
  new RenameInputNormalizer(),
];

const NORMALIZER_MAP = new Map<string, InputNormalizer>(
  ALL_INPUT_NORMALIZERS.map(n => [n.toolName, n]),
);

/**
 * Get the input normalizer for a given tool name, or `undefined` if no
 * special normalization is needed.
 */
export function getInputNormalizer(toolName: string): InputNormalizer | undefined {
  return NORMALIZER_MAP.get(toolName);
}
