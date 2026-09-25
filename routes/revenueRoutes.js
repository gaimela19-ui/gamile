import express from 'express';
import { 
  getRevenueAnalytics,
  getRevenueForecast,
  getRealTimeRevenue,
  updateRevenueOnOrder,
  getRevenueByCategoryController,
  getTopProductsByRevenue,
  getRevenueTrends,
  seedRevenueData
} from '../controllers/revenueController.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// Data seeding route (public for testing/demo purposes)
router.post('/seed', seedRevenueData);

// Apply authentication middleware to all other routes
router.use(auth);

// Revenue analytics routes
router.get('/analytics', getRevenueAnalytics);
router.get('/forecast', getRevenueForecast);
router.get('/realtime', getRealTimeRevenue);
router.get('/categories', getRevenueByCategoryController);
router.get('/products', getTopProductsByRevenue);
router.get('/trends', getRevenueTrends);

// Real-time update route
router.post('/update-order', updateRevenueOnOrder);

export default router;
