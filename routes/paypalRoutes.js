import express from 'express';
import { createPayPalOrder, capturePayPalOrder } from '../controllers/paypalController.js';

const router = express.Router();

// Public endpoints for client-side SDK integration
router.post('/create-order', createPayPalOrder);
router.post('/capture-order', capturePayPalOrder);

// Card authorize placeholder for mobile screen; respond 501 to indicate not implemented
router.post('/card/authorize', (req, res) => {
	return res.status(501).json({ message: 'Direct card authorization not configured. Use create-order/capture-order or configure PayPal Advanced Card Processing.' });
});

export default router;
