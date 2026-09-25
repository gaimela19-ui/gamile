import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import { createCancellationRequest, listCancellationRequests, updateCancellationRequest } from '../controllers/cancellationRequestController.js';

const router = express.Router();

// Public endpoint for customers to submit a cancellation request
router.post('/', createCancellationRequest);

// Admin-only listing and updates
router.get('/', adminAuth, listCancellationRequests);
router.patch('/:id([0-9a-fA-F]{24})', adminAuth, updateCancellationRequest);

export default router;
