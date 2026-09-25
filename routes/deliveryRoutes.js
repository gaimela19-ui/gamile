import express from 'express';
import { auth, adminAuth } from '../middleware/auth.js';
import {
  listCompanies,
  listActiveCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany,
  updateFieldMappings,
  calculateDeliveryFee,
  sendOrder,
  sendOrderWithOrderPayload,
  getDeliveryStatus,
  validateFieldMappings,
  validateAllFieldMappings,
  listDeliveryOrders,
  testConnection,
  validateCompanyConfig,
  batchAssignOrders,
  batchSendOrders,
} from '../controllers/deliveryController.js';

const router = express.Router();

// Conditional admin guard for development/testing without tokens
const deliveryAdminGuard = (req, res, next) => {
  const bypass = process.env.DELIVERY_ADMIN_BYPASS === 'true' || process.env.DEV_DELIVERY_NO_AUTH === 'true';
  if (bypass) return next();
  return adminAuth(req, res, next);
};

// Companies (admin)
router.get('/companies', deliveryAdminGuard, listCompanies);
router.post('/companies', deliveryAdminGuard, createCompany);
router.get('/companies/:id', deliveryAdminGuard, getCompany);
router.put('/companies/:id', deliveryAdminGuard, updateCompany);
router.delete('/companies/:id', deliveryAdminGuard, deleteCompany);
router.put('/companies/:id/field-mappings', deliveryAdminGuard, updateFieldMappings);
router.post('/companies/:id/test-connection', deliveryAdminGuard, testConnection);
// Validate config + show effective db sources
router.get('/companies/:id/validate-config', deliveryAdminGuard, validateCompanyConfig);
router.get('/companies/:id/validate-config', deliveryAdminGuard, validateCompanyConfig);

// Public companies listing for checkout
router.get('/companies/public/active', listActiveCompanies);

// Fee calculation for a company
router.post('/companies/:id/calculate-fee', calculateDeliveryFee);

// Send order to delivery company
router.post('/send', deliveryAdminGuard, sendOrder);
// Batch assign multiple orders to a delivery company
router.post('/assign/batch', deliveryAdminGuard, batchAssignOrders);
// Batch send multiple orders to provider (full integration flow)
router.post('/send/batch', deliveryAdminGuard, batchSendOrders);

// Legacy/alternate send path used by some components
router.post('/order', deliveryAdminGuard, sendOrderWithOrderPayload);

// Status
router.get('/status/:orderId/:companyId?', auth, getDeliveryStatus);

// Validate field mappings
router.post('/validate-field-mappings', deliveryAdminGuard, validateFieldMappings);
// Bulk validation across multiple companies
router.post('/validate-field-mappings/bulk', deliveryAdminGuard, validateAllFieldMappings);

// List delivery orders (for dashboards)
router.get('/orders', deliveryAdminGuard, listDeliveryOrders);

export default router;
