import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
  getAnnouncements,
  getActiveAnnouncements,
  getActiveAnnouncementsMobile,
  getActiveAnnouncementsWeb,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  reorderAnnouncements
} from '../controllers/announcementController.js';

const router = express.Router();

// Public routes
router.get('/active', getActiveAnnouncements);
// Mobile alias route used by app (now platform-aware)
router.get('/mobile-active', getActiveAnnouncementsMobile);
// Optional web alias if needed in legacy clients
router.get('/web-active', getActiveAnnouncementsWeb);

// Admin routes
router.get('/', adminAuth, getAnnouncements);
router.post('/', adminAuth, createAnnouncement);
router.put('/reorder', adminAuth, reorderAnnouncements);
router.put('/:id([0-9a-fA-F]{24})', adminAuth, updateAnnouncement);
router.delete('/:id([0-9a-fA-F]{24})', adminAuth, deleteAnnouncement);

export default router;