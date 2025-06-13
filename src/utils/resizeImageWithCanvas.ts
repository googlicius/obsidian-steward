/**
 * Resizes an image using the Canvas API
 * @param imageData The binary image data
 * @param maxWidth The maximum width for the resized image
 * @param quality The JPEG quality (0-1)
 * @returns Promise resolving to the resized image data
 */
export async function resizeImageWithCanvas(
	imageData: ArrayBuffer,
	maxWidth = 800,
	quality = 0.8
): Promise<{
	imageData: ArrayBuffer;
	mimeType: string;
}> {
	const MIME_TYPE = 'image/jpeg';
	return new Promise((resolve, reject) => {
		try {
			// Create a blob from the array buffer
			const blob = new Blob([imageData]);
			const blobUrl = URL.createObjectURL(blob);

			// Create an image element and load the blob
			const img = new Image();
			img.onload = () => {
				// Calculate dimensions while maintaining aspect ratio
				const scale = Math.min(1, maxWidth / img.width);
				const width = Math.floor(img.width * scale);
				const height = Math.floor(img.height * scale);

				// Create a canvas and draw the resized image
				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext('2d');

				if (!ctx) {
					URL.revokeObjectURL(blobUrl);
					reject(new Error('Failed to get canvas context'));
					return;
				}

				// Draw the image on the canvas
				ctx.drawImage(img, 0, 0, width, height);
				URL.revokeObjectURL(blobUrl);

				// Convert to blob with compression
				canvas.toBlob(
					result => {
						if (!result) {
							reject(new Error('Failed to create blob from canvas'));
							return;
						}

						// Convert the blob to array buffer
						const reader = new FileReader();
						reader.onload = () => {
							if (reader.result instanceof ArrayBuffer) {
								resolve({
									imageData: reader.result,
									mimeType: MIME_TYPE,
								});
							} else {
								reject(new Error('Failed to convert blob to array buffer'));
							}
						};
						reader.onerror = () => reject(new Error('Failed to read blob'));
						reader.readAsArrayBuffer(result);
					},
					MIME_TYPE,
					quality
				);
			};

			img.onerror = () => {
				URL.revokeObjectURL(blobUrl);
				reject(new Error('Failed to load image'));
			};

			img.src = blobUrl;
		} catch (error) {
			reject(error);
		}
	});
}
