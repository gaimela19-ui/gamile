export async function validateImageUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return false;

  // Accept data URLs immediately
  if (/^data:image\//i.test(url)) return true;

  // Accept obvious local/relative paths (handled by CDN/server)
  if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return true;

  // Basic extension heuristic as last resort
  const hasImageExtension = /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    // Try HEAD first
    const headResp = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    clearTimeout(timeout);
    const type = headResp.headers.get('content-type') || '';
    if (type.startsWith('image/')) return true;
    // Some servers don't return content-type on HEAD; fallback if status is OK and extension looks like image
    if (headResp.ok && hasImageExtension) return true;
  } catch (_) {
    // ignore and try GET
  } finally {
    clearTimeout(timeout);
  }

  // GET fallback with short timeout, without downloading full body intentionally
  const controllerGet = new AbortController();
  const timeoutGet = setTimeout(() => controllerGet.abort(), 3000);
  try {
    const getResp = await fetch(url, { method: 'GET', redirect: 'follow', signal: controllerGet.signal });
    const type = getResp.headers.get('content-type') || '';
    if (type.startsWith('image/')) return true;
    if (getResp.ok && hasImageExtension) return true;
  } catch (_) {
    // network or CORS issues – fall back to heuristic
  } finally {
    clearTimeout(timeoutGet);
  }

  return false;
}

export function validateProductData(data) {
  const errors = [];

  // Required fields
  if (!data.name?.trim()) {
    errors.push('Product name is required');
  }

  if (!data.description?.trim()) {
    errors.push('Product description is required');
  }

  if (!data.price || isNaN(parseFloat(data.price)) || parseFloat(data.price) <= 0) {
    errors.push('Valid price is required');
  }

  if (!data.category) {
    errors.push('Category is required');
  }

  // Two creation modes are supported now:
  // 1) Legacy variant-based creation (colors + sizes nested with images inside each color)
  // 2) Simple creation (no colors/sizes) where top-level images[] + stock are provided.
  const hasColorsArray = Array.isArray(data.colors) && data.colors.length > 0;

  if (hasColorsArray) {
    let hasAtLeastOneImage = false;
    let hasAtLeastOneSize = false;
    data.colors.forEach((color, colorIdx) => {
      if (!color.name?.trim()) {
        errors.push(`Color name is required for color #${colorIdx + 1}`);
      }
      if (!validateHexColor(color.code)) {
        errors.push(`Invalid color code for ${color.name || `color #${colorIdx + 1}`}`);
      }
      // Validate images for this color
      if (!Array.isArray(color.images) || color.images.length === 0) {
        errors.push(`At least one image is required for color ${color.name || `#${colorIdx + 1}`}`);
      } else {
        hasAtLeastOneImage = true;
      }
      // Validate sizes for this color
      if (!Array.isArray(color.sizes) || color.sizes.length === 0) {
        errors.push(`At least one size is required for color ${color.name || `#${colorIdx + 1}`}`);
      } else {
        hasAtLeastOneSize = true;
        color.sizes.forEach((size, sizeIdx) => {
          if (!size.name?.trim()) {
            errors.push(`Size name is required for color ${color.name || `#${colorIdx + 1}`}, size #${sizeIdx + 1}`);
          }
          if (typeof size.stock !== 'number' || size.stock < 0) {
            errors.push(`Invalid stock quantity for color ${color.name || `#${colorIdx + 1}`}, size ${size.name || `#${sizeIdx + 1}`}`);
          }
        });
      }
    });
    if (!hasAtLeastOneImage) {
      errors.push('At least one product image is required (in any color)');
    }
    if (!hasAtLeastOneSize) {
      errors.push('At least one size is required (in any color)');
    }
  } else {
    // Simple mode validation
    if (!Array.isArray(data.images) || data.images.length === 0) {
      errors.push('At least one product image is required');
    }
    if (data.stock == null || isNaN(Number(data.stock)) || Number(data.stock) < 0) {
      errors.push('Valid stock quantity is required');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export function validateHexColor(color) {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

export function validateReviewData(data) {
  const errors = [];

  if (!data.rating || isNaN(data.rating) || data.rating < 1 || data.rating > 5) {
    errors.push('Rating must be between 1 and 5');
  }

  if (!data.comment?.trim()) {
    errors.push('Review comment is required');
  } else if (data.comment.length < 10) {
    errors.push('Review comment must be at least 10 characters long');
  }

  if (data.photos) {
    if (!Array.isArray(data.photos)) {
      errors.push('Photos must be provided as an array');
    } else if (data.photos.length > 5) {
      errors.push('Maximum 5 photos allowed per review');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}