import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import { listAdmin, create, update, remove, publicActiveList, publicGetById, publicGetActiveItems } from '../controllers/flashSaleController.js';

const router = express.Router();

// Public
router.get('/public/active/list', publicActiveList);
router.get('/public/active/:id', publicGetById);
// Paginated items for a specific active flash sale (meta-first pattern)
router.get('/public/active/:id/items', publicGetActiveItems);

// Admin
router.get('/', adminAuth, listAdmin);
router.post('/', adminAuth, create);
router.put('/:id', adminAuth, update);
router.delete('/:id', adminAuth, remove);

export default router;
