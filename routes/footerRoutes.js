import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
  getFooterSettings,
  updateFooterSettings,
  getFooterLinks,
  createFooterLink,
  updateFooterLink,
  deleteFooterLink,
  reorderFooterLinks
} from '../controllers/footerController.js';

const router = express.Router();

// Settings routes
// Accepts optional ?lang=xx to localize description/newsletter fields using DeepSeek when configured
router.get('/settings', getFooterSettings);
router.put('/settings', adminAuth, updateFooterSettings);

// Links routes
// Accepts optional ?lang=xx to localize link names using DeepSeek when configured
router.get('/links', getFooterLinks);
router.post('/links', adminAuth, createFooterLink);
router.put('/links/:id', adminAuth, updateFooterLink);
router.delete('/links/:id', adminAuth, deleteFooterLink);
router.put('/links/reorder', adminAuth, reorderFooterLinks);

export default router;