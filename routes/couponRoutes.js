import express from 'express';
import { adminAuth, auth } from '../middleware/auth.js';
import {
  createCoupon,
  getAllCoupons,
  getCoupon,
  updateCoupon,
  deleteCoupon,
  validateCoupon,
  applyCoupon
} from '../controllers/couponController.js';

const router = express.Router();

// Admin routes
router.post('/', adminAuth, createCoupon);
router.get('/', adminAuth, getAllCoupons);
router.get('/:id', adminAuth, getCoupon);
router.put('/:id', adminAuth, updateCoupon);
router.delete('/:id', adminAuth, deleteCoupon);

// Customer routes (registration required)
// Primary POST validate endpoint (expects JSON body { code, totalAmount })
router.post('/validate', auth, validateCoupon);
// Convenience GET variant to reduce accidental 404s from incorrect method usage
router.get('/validate', auth, validateCoupon);
router.post('/:code/apply', auth, applyCoupon);

export default router;