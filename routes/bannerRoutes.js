import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import { videoUpload } from '../middleware/videoUpload.js';
import {
  getBanners,
  getActiveBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  reorderBanners,
  getMobileBanners,
  getMobileBannersByCategory,
  getMobileBannersByTag,
  uploadBannerVideo,
  uploadTempBannerVideo
} from '../controllers/bannerController.js';

const router = express.Router();

// Public
router.get('/active', getActiveBanners);
// Mobile optimized payloads (public)
router.get('/mobile', getMobileBanners);
router.get('/mobile/by-category/:slug', getMobileBannersByCategory);
router.get('/mobile/by-tag/:tag', getMobileBannersByTag);

// Admin
router.get('/', adminAuth, getBanners);
router.post('/', adminAuth, createBanner);
// Pre-create standalone video upload (returns URL only) before dynamic id routes
router.post('/videos/temp', adminAuth, videoUpload.single('video'), uploadTempBannerVideo);
// Upload and attach video to a specific banner
router.post('/:id([0-9a-fA-F]{24})/video', adminAuth, videoUpload.single('video'), uploadBannerVideo);
router.put('/reorder', adminAuth, reorderBanners);
router.put('/:id([0-9a-fA-F]{24})', adminAuth, updateBanner);
router.delete('/:id([0-9a-fA-F]{24})', adminAuth, deleteBanner);

export default router;
