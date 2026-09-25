import express from 'express';
import { adminAuth, maybeAuth } from '../middleware/auth.js';
import { logSearch, getSearchLogs, clearSearchLogs } from '../controllers/searchAnalyticsController.js';

const router = express.Router();

// Public: log a search (optionally attaches user if token present)
router.post('/', maybeAuth, logSearch);

// Admin: list / aggregate logs
router.get('/', adminAuth, getSearchLogs);

// Admin: clear all logs
router.delete('/', adminAuth, clearSearchLogs);

export default router;
