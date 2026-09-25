import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
  getInventoryHistory,
  addInventoryHistory
} from '../controllers/inventoryHistoryController.js';

const router = express.Router();

router.get('/', adminAuth, getInventoryHistory);
router.post('/', adminAuth, addInventoryHistory);

export default router;