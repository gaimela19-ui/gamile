import express from 'express';
import asyncHandler from 'express-async-handler';
import multer from 'multer';
import { adminAuth } from '../middleware/auth.js';
import {
  getShippingZones,
  getShippingZone,
  createShippingZone,
  updateShippingZone,
  deleteShippingZone,
  getShippingRates,
  getShippingRate,
  createShippingRate,
  updateShippingRate,
  deleteShippingRate,
  calculateShippingFee,
  getShippingOptions,
  getConfiguredCities,
  importShippingZoneFromExcel,
} from '../controllers/shippingController.js';

const router = express.Router();

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv'
    ];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Please upload an Excel file.'));
    }
    cb(null, true);
  }
});

// Shipping Zone Routes
router.route('/zones')
  .get(asyncHandler(getShippingZones)) // Get all shipping zones
  .post(adminAuth, asyncHandler(createShippingZone)); // Admin-only: Create a new shipping zone

router.route('/zones/:id')
  .get(asyncHandler(getShippingZone)) // Get a single shipping zone by ID
  .put(adminAuth, asyncHandler(updateShippingZone)) // Admin-only: Update a shipping zone by ID
  .delete(adminAuth, asyncHandler(deleteShippingZone)); // Admin-only: Delete a shipping zone by ID

// Shipping Rate Routes
router.route('/rates')
  .get(asyncHandler(getShippingRates)) // Get all shipping rates
  .post(adminAuth, asyncHandler(createShippingRate)); // Admin-only: Create a new shipping rate

router.route('/rates/:id')
  .get(asyncHandler(getShippingRate)) // Get a single shipping rate by ID
  .put(adminAuth, asyncHandler(updateShippingRate)) // Admin-only: Update a shipping rate by ID
  .delete(adminAuth, asyncHandler(deleteShippingRate)); // Admin-only: Delete a shipping rate by ID

// Shipping Fee Calculation Route (supports city)
router.post('/calculate', asyncHandler(calculateShippingFee));

// Get options for a location (query params)
router.get('/options', asyncHandler(getShippingOptions));

// Get distinct configured cities (admin only)
router.get('/cities', adminAuth, asyncHandler(getConfiguredCities));

router.post(
  '/zones/import/excel',
  adminAuth,
  excelUpload.single('file'),
  asyncHandler(importShippingZoneFromExcel)
);

export default router;
