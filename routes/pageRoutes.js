import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
  listPages,
  getPageById,
  getPageBySlug,
  createPage,
  updatePage,
  deletePage
} from '../controllers/pageController.js';

const router = express.Router();

// Public read by slug (published only)
router.get('/slug/:slug', getPageBySlug);

// Admin list + CRUD
router.get('/', adminAuth, listPages);
router.get('/:id', adminAuth, getPageById);
router.post('/', adminAuth, createPage);
router.put('/:id', adminAuth, updatePage);
router.delete('/:id', adminAuth, deletePage);

export default router;
