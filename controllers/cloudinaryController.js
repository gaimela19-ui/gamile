import cloudinary from '../services/cloudinaryClient.js';
import { ensureCloudinaryConfig, cloudinarySettingsDiagnostics } from '../services/cloudinaryConfigService.js';

function classifyCloudinaryApiError(rawMsg = '') {
  const message = String(rawMsg || 'unknown_error');
  if (/disabled\s+customer|account\s+disabled|suspended/i.test(message)) {
    return {
      status: 403,
      payload: {
        message: 'Cloudinary account is disabled. Re-enable the account or update credentials to an active Cloudinary product environment.',
        code: 'cloudinary_account_disabled',
        detail: message
      }
    };
  }
  if (/api_key|signature|authorization|not allowed|invalid/i.test(message)) {
    return {
      status: 400,
      payload: {
        message: 'Cloudinary authentication failed. Verify cloud name, API key, and API secret.',
        code: 'cloudinary_auth_failed',
        detail: message
      }
    };
  }
  return {
    status: 502,
    payload: {
      message: 'Failed to fetch resources from Cloudinary',
      code: 'cloudinary_api_error',
      detail: message
    }
  };
}

// List resources with optional folder, type, and pagination
export const listResources = async (req, res) => {
  try {
    const configured = await ensureCloudinaryConfig();
    if (!configured) {
      console.warn('[cloudinary][listResources] Request received but Cloudinary credentials are not configured');
      return res.status(400).json({
        message: 'Cloudinary is not configured. Please add credentials in Settings > Integrations > Cloudinary.',
        code: 'cloudinary_not_configured'
      });
    }
    const { folder, next_cursor, max_results = 30, resource_type = 'image', prefix, tags } = req.query;
    const options = {
      type: 'upload',
      resource_type,
      max_results: Math.min(Number(max_results) || 30, 100),
    };
    if (next_cursor) options.next_cursor = next_cursor;
    // Use prefix to limit to folder if provided
    if (folder) options.prefix = folder.endsWith('/') ? folder : `${folder}/`;
    if (prefix) options.prefix = prefix;
    if (tags) options.tags = tags;

    let result;
    try {
      result = await cloudinary.api.resources(options);
    } catch (apiErr) {
      const rawMsg = apiErr?.error?.message || apiErr?.message || 'unknown_error';
      console.error('[cloudinary][listResources] Cloudinary API error:', rawMsg, { options });
      const classified = classifyCloudinaryApiError(rawMsg);
      return res.status(classified.status).json(classified.payload);
    }
    return res.json(result);
  } catch (err) {
    console.error('[cloudinary][listResources] Unexpected server error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to list resources', error: err.message || 'unknown_error' });
  }
};

// List folders optionally under a parent folder
export const listFolders = async (req, res) => {
  try {
    await ensureCloudinaryConfig();
    const { next_cursor, max_results = 100, parent_folder } = req.query;
    const options = { max_results: Math.min(Number(max_results) || 100, 200) };
    if (next_cursor) options.next_cursor = next_cursor;
    if (parent_folder) options.folder = parent_folder;

    const result = await cloudinary.api.root_folders(options);
    // If parent_folder provided, fetch subfolders
    if (parent_folder) {
      const sub = await cloudinary.api.sub_folders(parent_folder, options);
      return res.json(sub);
    }
    return res.json(result);
  } catch (err) {
    console.error('Cloudinary listFolders error:', err);
    return res.status(500).json({ message: 'Failed to list folders', error: err.message });
  }
};

// Delete one or many resources by public_ids
export const deleteResources = async (req, res) => {
  try {
    await ensureCloudinaryConfig();
    const { public_ids = [], resource_type = 'image', invalidate = true } = req.body || {};
    if (!Array.isArray(public_ids) || public_ids.length === 0) {
      return res.status(400).json({ message: 'public_ids array is required' });
    }
    const result = await cloudinary.api.delete_resources(public_ids, { resource_type, invalidate });
    return res.json(result);
  } catch (err) {
    console.error('Cloudinary deleteResources error:', err);
    return res.status(500).json({ message: 'Failed to delete resources', error: err.message });
  }
};

// Optional: rename/move resource
export const renameResource = async (req, res) => {
  try {
    await ensureCloudinaryConfig();
    const { from_public_id, to_public_id, resource_type = 'image', overwrite = false } = req.body || {};
    if (!from_public_id || !to_public_id) return res.status(400).json({ message: 'from_public_id and to_public_id are required' });
    const result = await cloudinary.uploader.rename(from_public_id, to_public_id, { resource_type, overwrite });
    return res.json(result);
  } catch (err) {
    console.error('Cloudinary renameResource error:', err);
    return res.status(500).json({ message: 'Failed to rename resource', error: err.message });
  }
};

// Health check for Cloudinary configuration and API connectivity
export const health = async (req, res) => {
  const timestamp = new Date().toISOString();
  try {
    const diag = await cloudinarySettingsDiagnostics().catch(() => null);
    const configured = await ensureCloudinaryConfig();
    if (!configured) {
      return res.status(200).json({ ok: false, status: 'not_configured', timestamp, diag });
    }
    // Try Cloudinary ping (Admin API). If not available, fallback to listing a single resource.
    try {
      if (typeof cloudinary.api.ping === 'function') {
        const ping = await cloudinary.api.ping();
        return res.json({ ok: true, status: 'ok', timestamp, ping, diag });
      }
    } catch (e) {
      // ignore and fallback
    }
    try {
      const sample = await cloudinary.api.resources({ type: 'upload', resource_type: 'image', max_results: 1 });
      return res.json({ ok: true, status: 'ok', timestamp, sampleCount: Array.isArray(sample?.resources) ? sample.resources.length : 0, diag });
    } catch (apiErr) {
      const msg = apiErr?.error?.message || apiErr?.message || 'cloudinary_api_error';
      const classified = classifyCloudinaryApiError(msg);
      const statusByCode = {
        cloudinary_auth_failed: 'auth_failed',
        cloudinary_account_disabled: 'account_disabled',
        cloudinary_api_error: 'api_error'
      };
      return res.status(classified.status).json({
        ok: false,
        status: statusByCode[classified.payload.code] || 'api_error',
        message: classified.payload.detail || classified.payload.message,
        code: classified.payload.code,
        timestamp,
        diag
      });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, status: 'error', message: err?.message || 'unknown_error', timestamp });
  }
};
