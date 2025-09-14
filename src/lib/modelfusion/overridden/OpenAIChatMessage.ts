import { DataContent, ImagePart, TextPart } from 'ai';
import { uint8ArrayToBase64 } from './Uint8Utils';

export function convertDataContentToBase64String(content: DataContent): string {
  if (typeof content === 'string') {
    return content;
  }

  if (content instanceof ArrayBuffer) {
    return uint8ArrayToBase64(new Uint8Array(content));
  }

  return uint8ArrayToBase64(content);
}

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
