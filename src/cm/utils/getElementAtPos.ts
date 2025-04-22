import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

export function getElementAtPos(state: EditorState, pos: number) {
	const tree = syntaxTree(state);
	const node = tree.resolveInner(pos, 0);

	switch (node.type.name) {
		case 'list':
			return 'list';

		case 'table':
			return 'table';

		case 'code_block':
			return 'codeblock';

		default:
			break;
	}
	// Add more checks as needed

	return 'paragraph'; // default
}
