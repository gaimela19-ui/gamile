import express from 'express';
import { getAvailability, createBooking, listBookings, updateBookingStatus, getBookingById, deleteBooking, cancelBooking, getBookingAudit, getMyBookings, rescheduleBooking } from '../controllers/groomingController.js';
import { adminAuth, auth } from '../middleware/auth.js';
import { protectOptional } from '../middleware/authOptional.js';

const router = express.Router();

// Optional auth: allow logged-in user association, but not required
router.get('/availability', getAvailability);
router.post('/book', protectOptional, createBooking);
// Authenticated user bookings
router.get('/my-bookings', auth, getMyBookings);
// Admin management endpoints
router.get('/bookings', adminAuth, listBookings);
router.get('/bookings/:id', adminAuth, getBookingById);
router.patch('/bookings/:id', adminAuth, updateBookingStatus);
router.delete('/bookings/:id', adminAuth, deleteBooking);
router.post('/bookings/:id/cancel', protectOptional, cancelBooking); // user or admin
router.post('/bookings/:id/reschedule', auth, rescheduleBooking); // user or admin, requires auth
router.get('/bookings/:id/audit', adminAuth, getBookingAudit);

export default router;