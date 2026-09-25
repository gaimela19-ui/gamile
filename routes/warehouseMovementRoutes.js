import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import { getWarehouseMovements, getWarehouseMovementById } from '../controllers/warehouseMovementController.js';

const router = express.Router();

router.get('/', adminAuth, getWarehouseMovements);
router.get('/:id', adminAuth, getWarehouseMovementById);

export default router;
