import express from 'express';
import {
  createSessionHandler,
  createSessionFromCartHandler,
  getStatusHandler,
  getSessionOrderHandler,
  createInvoiceFromOrderHandler,
  confirmSessionHandler,
  resendNotificationHandler,
  successCallbackHandler,
  failureCallbackHandler
} from '../controllers/zcreditController.js';
import { adminAuth } from '../middleware/auth.js';

const router = express.Router();

// Create WebCheckout session
router.post('/session', createSessionHandler);

// Create session directly from checkout payload (no order pre-create)
router.post('/session-from-cart', createSessionFromCartHandler);

// Admin: create an invoice/payment session for an existing order
router.post('/orders/:orderId/create-invoice', adminAuth, createInvoiceFromOrderHandler);

// Get session status
router.post('/status', getStatusHandler);

// Confirm a session and create the order after successful payment
router.post('/session/confirm', confirmSessionHandler);

// Fetch session + order linkage (used by return page polling)
router.get('/session/:sessionId/order', getSessionOrderHandler);

// Resend callback notification
router.post('/resend', resendNotificationHandler);

// Z-Credit server-to-server callbacks (success/failure)
router.post('/callback/success', successCallbackHandler);
router.post('/callback/failure', failureCallbackHandler);

export default router;
