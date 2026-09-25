import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
  getDbStatus,
  getDbConfig,
  testDbConnection,
  applyDbConfig,
  reconnectDb,
} from '../controllers/dbController.js';

const router = express.Router();

router.get('/status', adminAuth, getDbStatus);
router.get('/config', adminAuth, getDbConfig);
router.post('/test', adminAuth, testDbConnection);
router.post('/apply', adminAuth, applyDbConfig);
router.post('/reconnect', adminAuth, reconnectDb);

export default router;
