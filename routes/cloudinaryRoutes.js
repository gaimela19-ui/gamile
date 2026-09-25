import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import { listResources, listFolders, deleteResources, renameResource, health } from '../controllers/cloudinaryController.js';

const router = express.Router();

// All routes require admin
router.get('/resources', adminAuth, listResources);
router.get('/folders', adminAuth, listFolders);
router.post('/delete', adminAuth, deleteResources);
router.post('/rename', adminAuth, renameResource);
router.get('/health', adminAuth, health);
// Public health endpoint (read-only diagnostics)
router.get('/health/public', health);

export default router;
