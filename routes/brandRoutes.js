import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { adminAuth } from '../middleware/auth.js';
import { listBrands, listActiveBrands, createBrand, updateBrand, deleteBrand, reorderBrands, getBrandBySlug } from '../controllers/brandController.js';

const router = express.Router();

// Upload dir (project-level /uploads)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

// Public
router.get('/', listBrands);
router.get('/active', listActiveBrands);
router.get('/slug/:slug', getBrandBySlug);

// Admin-only
router.post('/', adminAuth, createBrand);
router.put('/:id', adminAuth, updateBrand);
router.delete('/:id', adminAuth, deleteBrand);
router.post('/reorder', adminAuth, reorderBrands);

// Image upload endpoint (returns URL)
router.post('/upload', adminAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

// Label image upload endpoint (returns URL)
router.post('/upload-label', adminAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

export default router;
