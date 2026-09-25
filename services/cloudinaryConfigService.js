import cloudinary from './cloudinaryClient.js';
import Settings from '../models/Settings.js';

function getEnvCreds() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME || '';
  const apiKey = process.env.CLOUDINARY_API_KEY || process.env.VITE_CLOUDINARY_API_KEY || '';
  const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.VITE_CLOUDINARY_API_SECRET || '';
  return { cloudName, apiKey, apiSecret };
}

export async function loadCredsFromDbOrEnv() {
  try {
    // Prefer the most recently updated Settings doc in case multiple were accidentally created
    const docs = await Settings.find().sort({ updatedAt: -1 }).limit(2).select('cloudinary updatedAt');
    const s = docs[0];
    if (docs.length > 1) {
      console.warn(`[cloudinaryConfig] Multiple Settings documents detected (${docs.length}). Using the most recently updated one (${s?._id}). Consider cleaning up duplicates to guarantee persistence.`);
    }
    const db = (s && s.cloudinary) ? s.cloudinary : {};
    const { cloudName, apiKey, apiSecret } = {
      cloudName: db.cloudName || '',
      apiKey: db.apiKey || '',
      apiSecret: db.apiSecret || ''
    };
    if (cloudName && apiKey && apiSecret) return { cloudName, apiKey, apiSecret, source: 'db' };
  } catch {}
  return { ...getEnvCreds(), source: 'env' };
}

export async function ensureCloudinaryConfig() {
  const { cloudName, apiKey, apiSecret } = await loadCredsFromDbOrEnv();
  if (!cloudName || !apiKey || !apiSecret) return false;
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  return true;
}

// Helper used by routes to decide whether to attempt Cloudinary upload.
// Unlike previous in-route checks that only looked at environment variables,
// this also considers credentials saved in the Settings collection.
export async function hasCloudinaryCredentials() {
  try {
    const { cloudName, apiKey, apiSecret } = await loadCredsFromDbOrEnv();
    return !!(cloudName && apiKey && apiSecret);
  } catch {
    return false;
  }
}

// Diagnostics: returns how many Settings docs exist and which one provides Cloudinary creds
export async function cloudinarySettingsDiagnostics() {
  const docs = await Settings.find().sort({ updatedAt: -1 }).select('cloudinary updatedAt');
  const active = docs[0];
  return {
    totalSettingsDocs: docs.length,
    activeSettingsId: active?._id || null,
    hasCloudinary: !!(active?.cloudinary?.cloudName && active?.cloudinary?.apiKey && active?.cloudinary?.apiSecret),
    cloudName: active?.cloudinary?.cloudName || null,
    updatedAt: active?.updatedAt || null
  };
}

export default { ensureCloudinaryConfig, loadCredsFromDbOrEnv, hasCloudinaryCredentials, cloudinarySettingsDiagnostics };
