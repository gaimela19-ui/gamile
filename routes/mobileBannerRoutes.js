import express from 'express';
import { getMobileBanners, getMobileBannersByCategory, getMobileBannersByTag } from '../controllers/bannerController.js';

const router = express.Router();

// Public mobile-optimized banner endpoints
router.get('/', getMobileBanners);
router.get('/by-category/:slug', getMobileBannersByCategory);
router.get('/by-tag/:tag', getMobileBannersByTag);

export default router;
