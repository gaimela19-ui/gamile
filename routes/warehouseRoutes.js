import express from 'express';
import {
  getWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  getDefaultWarehouse
} from '../controllers/warehouseController.js';
import { adminAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/', adminAuth, getWarehouses);
// Must be defined before '/:id' to avoid being captured by it
router.get('/default', adminAuth, getDefaultWarehouse);
router.get('/:id', adminAuth, getWarehouseById);
router.post('/', adminAuth, createWarehouse);
router.put('/:id', adminAuth, updateWarehouse);
router.delete('/:id', adminAuth, deleteWarehouse);

export default router;
