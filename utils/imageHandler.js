import { validateImageUrl } from './validation.js';

export async function handleProductImages(images) {
  if (!Array.isArray(images)) {
    throw new Error('Images must be provided as an array');
  }

  // Validate and process each image
  const validatedImages = await Promise.all(
    images.map(async (image) => {
      if (!await validateImageUrl(image)) {
        throw new Error(`Invalid image URL: ${image}`);
      }
      return image;
    })
  );

  return validatedImages;
}