import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
  getAllCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  getSubcategories,
  getCategoryTree,
  translateAllCategories
} from '../controllers/categoryController.js';

const router = express.Router();

// Public routes
// Alias handler: support query params active and parent used by mobile
router.get('/', (req, res, next) => {
  // If parent query is provided, redirect to /parent/:parentId
  if (typeof req.query.parent === 'string') {
    req.params.parentId = req.query.parent || 'root';
    return getSubcategories(req, res, next);
  }
  // If active=true, filter via controller (add query; controller already returns all)
  // For now, just call default controller which returns all; client can filter.
  return getAllCategories(req, res, next);
});
router.get('/tree', getCategoryTree);
router.get('/parent/:parentId', getSubcategories); // parentId = 'root' for root categories
router.get('/:id', getCategory);

// Admin routes
router.post('/', adminAuth, createCategory);
router.put('/reorder', adminAuth, reorderCategories);
router.put('/:id([0-9a-fA-F]{24})', adminAuth, updateCategory);
router.delete('/:id([0-9a-fA-F]{24})', adminAuth, deleteCategory);
// Backfill translations for categories: POST /api/categories/translate?to=ar
router.post('/translate', adminAuth, translateAllCategories);

export default router;