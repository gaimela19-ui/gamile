import express from 'express';
import { recordLegalView, getLegalStats, getLegalViews, exportLegalViews } from '../controllers/legalController.js';

const router = express.Router();

router.post('/view', recordLegalView);
router.get('/stats', getLegalStats);
router.get('/views', getLegalViews);
router.get('/export', exportLegalViews);

export default router;
