import express from 'express';
import { getActiveAnnouncementsMobile } from '../controllers/announcementController.js';

const router = express.Router();

// Public mobile announcement endpoints
// GET /api/mobile/announcements/active
router.get('/active', getActiveAnnouncementsMobile);

export default router;
