import { DataContent, ImagePart, TextPart } from 'ai';
import { convertDataContentToBase64String } from 'modelfusion';

export function user(content: string | Array<TextPart | ImagePart>, options?: { name?: string }) {
  return {
    role: 'user' as const,
    content:
      typeof content === 'string'
        ? content
        : content.map(part => {
            switch (part.type) {
              case 'text': {
                return { type: 'text', text: part.text };
              }
              case 'image': {
                return {
                  type: 'image_url',
                  image_url: {
                    url: `data:${
                      part.mimeType ?? 'image/jpeg'
                    };base64,${convertDataContentToBase64String(part.image as DataContent)}`,
                    detail: 'high',
                  },
                };
              }
            }
          }),
    name: options?.name,
  };
}
