import multer from 'multer';

// Memory storage so we can stream directly to Cloudinary without persisting temp file
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!file.mimetype.startsWith('video/')) {
    return cb(new Error('Only video files are allowed'));
  }
  // Basic extension check (optional)
  const allowed = ['mp4', 'webm', 'ogg', 'quicktime', 'x-matroska'];
  const ext = (file.originalname.split('.').pop() || '').toLowerCase();
  if (!allowed.includes(ext)) {
    // Still allow if mimetype video/* but ext mismatch? We'll restrict.
    return cb(new Error('Unsupported video format'));
  }
  cb(null, true);
};

// ~100MB limit (adjust per plan). Cloudinary free tiers often have lower limits.
export const videoUpload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter
});

export default videoUpload;