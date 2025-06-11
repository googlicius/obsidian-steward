import { extractImageLinks } from './imageUtils';

describe('imageUtils', () => {
	describe('extractImageLinks', () => {
		it('should extract image links', () => {
			const content = `Read content:
["![[Pasted image 20250611021640.png]]"]

Is the image above a lake, pond, reservoir, or sea?`;
			const imageLinks = extractImageLinks(content);
			expect(imageLinks).toEqual(['Pasted image 20250611021640.png']);
		});
	});
});
