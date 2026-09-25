import express from 'express';
import { auth, adminAuth } from '../middleware/auth.js';
import {
  getAllHeros,
  getActiveHero,
  getSliderHeros,
  createHero,
  updateHero,
  deleteHero
} from '../controllers/heroController.js';

const router = express.Router();

// Public routes
router.get('/active', getActiveHero);
router.get('/slider', getSliderHeros);

// Admin routes
router.get('/', adminAuth, getAllHeros);
router.post('/', adminAuth, createHero);
router.put('/:id', adminAuth, updateHero);
router.delete('/:id', adminAuth, deleteHero);

export default router;