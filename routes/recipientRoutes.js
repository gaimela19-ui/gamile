import express from 'express';
import {
  getRecipients,
  getRecipientById,
  updateRecipient,
  deleteRecipient,
  createRecipient
} from '../controllers/recipientController.js';

const router = express.Router();


// List all recipients
router.get('/', getRecipients);
// Create recipient
router.post('/', createRecipient);
// Get recipient by ID
router.get('/:id', getRecipientById);
// Update recipient
router.put('/:id', updateRecipient);
// Delete recipient
router.delete('/:id', deleteRecipient);

export default router;
