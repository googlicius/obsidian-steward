import {
	convertDataContentToBase64String,
	ImagePart,
	OpenAIChatMessage,
	TextPart,
} from 'modelfusion';

export function user(
	content: string | Array<TextPart | ImagePart>,
	options?: { name?: string }
): OpenAIChatMessage {
	return {
		role: 'user',
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
										};base64,${convertDataContentToBase64String(part.image)}`,
										detail: 'high',
									},
								};
							}
						}
					}),
		name: options?.name,
	};
}
