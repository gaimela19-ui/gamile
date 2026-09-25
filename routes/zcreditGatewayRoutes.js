import express from 'express';
import {
  commitTokenHandler,
  commitCardHandler,
  captureHandler,
  refundHandler,
  gatewayHealthHandler
} from '../controllers/zcreditGatewayController.js';

const router = express.Router();

router.get('/health', gatewayHealthHandler);
router.post('/commit-token', commitTokenHandler);
router.post('/commit-card', commitCardHandler);
router.post('/capture', captureHandler);
router.post('/refund', refundHandler);

export default router;
