import express from 'express';
import { auth, adminAuth, maybeAuth } from '../middleware/auth.js';
import { registerToken, deregisterToken, sendTestToMe, broadcastToAdmins, broadcastAll, sendToUser, listTokens, recordOpen, getStats, schedulePush, listScheduled, cancelScheduled, listHistory, getAnalytics, getMyBadge } from '../controllers/mobilePushController.js';

const router = express.Router();

// Register/deregister the device push token (associate to logged-in user if available)
router.post('/register', maybeAuth, registerToken);
router.post('/deregister', maybeAuth, deregisterToken);

// Send a test push to current user
router.post('/test', auth, sendTestToMe);

// Broadcast to admins only (protected)
router.post('/broadcast-admins', adminAuth, broadcastToAdmins);

// Broadcast to all users (protected)
router.post('/broadcast', adminAuth, broadcastAll);

// Send to a specific user by id or email (protected)
router.post('/send-to-user', adminAuth, sendToUser);

// List registered tokens for admin UI (protected)
router.get('/tokens', adminAuth, listTokens);

// Track opens (auth optional)
router.post('/open', maybeAuth, recordOpen);
// Current unread badge count
router.get('/badge', auth, getMyBadge);

// Stats and scheduling (admin)
router.get('/stats', adminAuth, getStats);
router.get('/history', adminAuth, listHistory);
router.get('/analytics', adminAuth, getAnalytics);
router.post('/schedule', adminAuth, schedulePush);
router.get('/schedule', adminAuth, listScheduled);
router.post('/schedule/:id/cancel', adminAuth, cancelScheduled);

export default router;
