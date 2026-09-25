import express from 'express';
import { auth, adminAuth } from '../middleware/auth.js';
import {
  purchaseGiftCard,
  checkBalance,
  applyToOrder,
  applyToOrderGuest,
  getAllGiftCards,
  cancelGiftCard
} from '../controllers/giftCardController.js';

const router = express.Router();

// Public routes
router.get('/balance/:code', checkBalance);
router.post('/apply/guest', applyToOrderGuest);

// Protected routes
router.post('/purchase', auth, purchaseGiftCard);
router.post('/apply', auth, applyToOrder);

// Admin routes
router.get('/all', adminAuth, getAllGiftCards);
router.put('/:id/cancel', adminAuth, cancelGiftCard);

export default router;