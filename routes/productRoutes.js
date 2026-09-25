import express from 'express';
import { auth, adminAuth } from '../middleware/auth.js';
import {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  updateRelatedProducts,
  updateAddOns,
  searchProducts,
  reorderFeaturedProducts,
  bulkCreateProducts,
  getProductStock,
  uploadProductVideo,
  uploadTempProductVideo,
  getProductFilters,
  getProductLite,
  getProductStats,
  exportProductsCsv
} from '../controllers/productController.js';
import { videoUpload } from '../middleware/videoUpload.js';
import {
  getAllReviews,
  addReview,
  updateReview,
  markReviewHelpful,
  reportReview,
  verifyReview,
  deleteReview,
  getReviewEligibility
} from '../controllers/reviewController.js';
import { updateProductImages, generateProductVariants, updateVariant, bulkUpdateVariants, getAttributeValueImages, setAttributeValueImages, deleteVariant, translateProductFields, batchTranslateProducts, syncQuantityFromRivhit, getProductI18n, setProductI18n } from '../controllers/productController.js';

const router = express.Router();

// Public routes
// Alias: allow GET /api/products?q=term (maps to search controller when q present)
router.get('/', (req, res, next) => {
  if (req.query && typeof req.query.q === 'string' && req.query.q.trim()) {
    return searchProducts(req, res, next);
  }
  return getProducts(req, res, next);
});
router.get('/filters', getProductFilters); // must be before :id
// Admin stats (total/active counts)
router.get('/stats', adminAuth, getProductStats);
router.get('/export/csv', adminAuth, exportProductsCsv);
router.get('/search', searchProducts);
router.get('/lite/:id', getProductLite);
// Place static paths before dynamic ':id' to avoid conflicts
router.get('/:id/stock', getProductStock); // New endpoint for stock levels
router.get('/:id', getProduct);

// Protected routes (admin only)
router.post('/', adminAuth, createProduct);
router.post('/bulk', adminAuth, bulkCreateProducts);
// Translation endpoints
router.post('/translate/batch', adminAuth, batchTranslateProducts);
router.post('/:id/translate', adminAuth, translateProductFields);
// Manual i18n (admin)
router.get('/:id/i18n', adminAuth, getProductI18n);
router.put('/:id/i18n', adminAuth, setProductI18n);
// Put static route before dynamic ones
router.put('/featured/reorder', adminAuth, reorderFeaturedProducts);
router.put('/:id', adminAuth, updateProduct);
// Sync quantity from Rivhit for product or variant (variantId via query param)
router.post('/:id/sync-rivhit-qty', adminAuth, syncQuantityFromRivhit);
router.put('/:id/related', adminAuth, updateRelatedProducts);
router.put('/:id/addons', adminAuth, updateAddOns);
// Variant management
router.post('/:id/variants/generate', adminAuth, generateProductVariants);
router.put('/:id/variants/:variantId', adminAuth, updateVariant);
router.put('/:id/variants-bulk', adminAuth, bulkUpdateVariants);
router.delete('/:id/variants/:variantId', adminAuth, deleteVariant);
// Attribute value images on a product
router.get('/:id/attribute-images', adminAuth, getAttributeValueImages);
router.put('/:id/attribute-images', adminAuth, setAttributeValueImages);
// Partial image-only update
router.patch('/:id/images', adminAuth, updateProductImages);
router.post('/:id/videos', adminAuth, videoUpload.single('video'), uploadProductVideo);
// Pre-create standalone video upload (returns URL only). Must precede dynamic :id catch for GETs but after other static POSTs.
router.post('/videos/temp', adminAuth, videoUpload.single('video'), uploadTempProductVideo);
router.delete('/:id', adminAuth, deleteProduct);

// Review routes
router.get('/reviews/all', adminAuth, getAllReviews);
router.get('/:id/reviews/eligibility', auth, getReviewEligibility);
router.post('/:id/reviews', auth, addReview);
router.patch('/:id/reviews/:reviewId', auth, updateReview);
router.post('/:id/reviews/:reviewId/helpful', auth, markReviewHelpful);
router.post('/:id/reviews/:reviewId/report', auth, reportReview);
router.put('/:id/reviews/:reviewId/verify', adminAuth, verifyReview);
router.delete('/:id/reviews/:reviewId', auth, deleteReview);

export default router;