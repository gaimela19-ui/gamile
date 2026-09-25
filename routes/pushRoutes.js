import express from 'express';
import { getPublicKey, saveSubscription, deleteSubscription, sendTestNotification, listSubscriptions } from '../controllers/pushController.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

router.get('/public-key', getPublicKey);
router.post('/subscribe', auth, saveSubscription);
router.post('/unsubscribe', auth, deleteSubscription);
router.post('/test', auth, sendTestNotification);
router.get('/mine', auth, listSubscriptions);

export default router;
