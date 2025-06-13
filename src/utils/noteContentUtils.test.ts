import { extractImageLinks, extractWikilinks } from './noteContentUtils';

describe('noteContentUtils', () => {
  describe('extractImageLinks', () => {
    it('should extract image links', () => {
      const content = `Read content:
["![[Pasted image 20250611021640.png]]"]

Is the image above a lake, pond, reservoir, or sea?`;
      const imageLinks = extractImageLinks(content);
      expect(imageLinks).toEqual(['Pasted image 20250611021640.png']);
    });

    it('should extract image with custom size', () => {
      const content = `![[Image.png|400]]\nDescribe the image`;
      const imageLinks = extractImageLinks(content);
      expect(imageLinks).toEqual(['Image.png']);
    });

    it('should extract the image from a complex text', () => {
      const content = `Read content:\n["Describe this image:\\n![[Pasted image 20250222171626.png|400]]\\n?\\nA Chinese fishing boat [[ram|rammed]] a Japanese [[coastguard patrol]]\\n<!--SR:!2025-08-21,108,250-->"]\n\nRead the text above and tell me what is the image about?`;
      const imageLinks = extractImageLinks(content);
      expect(imageLinks).toEqual(['Pasted image 20250222171626.png']);
    });
  });

  describe('extractWikilinks', () => {
    it('should extract wikilinks and exclude media links', () => {
      const content = `Here is a wikilink [[Note1]] and an embedded link ![[Note2]]. Also, a media file [[Image.png]] should be excluded.`;
      const wikilinks = extractWikilinks(content);
      expect(wikilinks).toEqual(['Note1', 'Note2']);
    });
  });
});
