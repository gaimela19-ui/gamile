import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import { listAdmin, getById, create, update, remove, bulkRemove, toggleActive, publicList, publicListByProduct } from '../controllers/bundleOfferController.js';

const router = express.Router();

// Public
router.get('/public/list', publicList);
router.get('/public/by-product/:id', publicListByProduct);

// Admin
router.get('/', adminAuth, listAdmin);
router.get('/:id', adminAuth, getById);
router.post('/', adminAuth, create);
router.put('/:id', adminAuth, update);
router.delete('/:id', adminAuth, remove);
router.post('/bulk-delete', adminAuth, bulkRemove);
router.post('/:id/toggle', adminAuth, toggleActive);

export default router;
