import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cloudinary from '../services/cloudinaryClient.js';
import { ensureCloudinaryConfig } from '../services/cloudinaryConfigService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Memory storage for quick pass-through to Cloudinary
const storage = multer.memoryStorage();
export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) {
      return cb(new Error('Only image uploads allowed'));
    }
    cb(null, true);
  }
});

export const uploadProductImage = async (req, res) => {
  try {
    const configured = await ensureCloudinaryConfig();
    if (!req.file) {
      return res.status(400).json({ message: 'No file received' });
    }
    // Allow clients to specify a target folder (e.g., 'footer') via body or query; default to 'products'
    const rawFolder = (req.body && (req.body.folder || req.body.path)) || (req.query && (req.query.folder || req.query.path)) || 'products';
    const folder = typeof rawFolder === 'string' && rawFolder.trim() ? rawFolder.trim() : 'products';
    if (!configured) {
      // Fallback to local filesystem storage when Cloudinary is not configured
      // Save under project/uploads/<folder>/filename
      const uploadsRoot = path.resolve(__dirname, '../../uploads'); // project/uploads
      const safeFolder = folder.replace(/\\+/g, '/').split('/').filter(Boolean).join('/');
      const destDir = path.join(uploadsRoot, safeFolder);
      await fs.promises.mkdir(destDir, { recursive: true }).catch(() => {});
      const extFromName = path.extname(req.file.originalname || '').toLowerCase();
      const mimeExt = (() => {
        if (/png$/i.test(req.file.mimetype)) return '.png';
        if (/jpe?g$/i.test(req.file.mimetype)) return '.jpg';
        if (/webp$/i.test(req.file.mimetype)) return '.webp';
        if (/gif$/i.test(req.file.mimetype)) return '.gif';
        return extFromName || '.png';
      })();
      const basename = (path.basename(req.file.originalname || 'image', extFromName) || 'image')
        .toString()
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'image';
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${basename}${mimeExt}`;
      const filePath = path.join(destDir, filename);
      await fs.promises.writeFile(filePath, req.file.buffer);
      const publicUrl = `/uploads/${safeFolder ? safeFolder + '/' : ''}${filename}`;
      return res.status(201).json({
        url: publicUrl,
        storage: 'local',
        folder: safeFolder,
        bytes: req.file.size,
        mimetype: req.file.mimetype,
        originalname: req.file.originalname
      });
    }

    // Cloudinary upload path (preferred)
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        folder,
        resource_type: 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }]
      }, (err, uploaded) => {
        if (err) return reject(err);
        resolve(uploaded);
      });
      stream.end(req.file.buffer);
    });
    res.status(201).json({
      url: result.secure_url,
      public_id: result.public_id,
      folder: result.folder || folder,
      format: result.format,
      bytes: result.bytes,
      width: result.width,
      height: result.height
    });
  } catch (error) {
    console.error('uploadProductImage error:', error);
    res.status(500).json({ message: 'Failed to upload', error: error.message });
  }
};

export default { uploadProductImage };