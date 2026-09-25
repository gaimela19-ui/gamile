import express from 'express';
import { getActiveAnnouncementsWeb } from '../controllers/announcementController.js';

const router = express.Router();

// Public web announcement endpoints
// GET /api/web/announcements/active
router.get('/active', getActiveAnnouncementsWeb);

export default router;
