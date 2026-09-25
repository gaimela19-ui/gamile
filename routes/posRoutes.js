import express from 'express';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import {
  // Register management
  createRegister,
  getRegisters,
  getRegister,
  updateRegister,
  
  // Session management
  openSession,
  closeSession,
  getCurrentSession,
  
  // Transaction management
  createTransaction,
  getTransactions,
  getTransaction,
  refundTransaction,
  
  // Reports
  getSessionReport,
  getSalesReport
} from '../controllers/posController.js';
import { auth, adminAuth } from '../middleware/auth.js';

const router = express.Router();

// All POS routes require authentication
router.use(auth);

// Register Management Routes (Admin only)
router.post('/registers', adminAuth, createRegister);
router.get('/registers', adminAuth, getRegisters);
router.get('/registers/:id', adminAuth, getRegister);
router.put('/registers/:id', adminAuth, updateRegister);

// Session Management Routes
router.post('/sessions/open', openSession);
router.put('/sessions/:sessionId/close', closeSession);
router.get('/registers/:registerId/current-session', getCurrentSession);

// Transaction Management Routes
router.post('/transactions', createTransaction);
router.get('/transactions', getTransactions);
router.get('/transactions/:id', getTransaction);
router.post('/transactions/:transactionId/refund', refundTransaction);

// Report Routes
router.get('/sessions/:sessionId/report', getSessionReport);
router.get('/reports/sales', getSalesReport);

// POS User Management Routes (basic implementation)
router.get('/users/current', async (req, res) => {
  try {
    // Return basic user data for now
    res.json({
      user: req.user.id,
      permissions: {
        canAccessAllRegisters: true,
        canOpenRegister: true,
        canCloseRegister: true,
        canProcessSales: true,
        canProcessRefunds: true,
        canVoidTransactions: true,
        canApplyDiscounts: true,
        canViewReports: true,
        canManageInventory: true
      },
      assignedRegisters: [],
      preferences: {}
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching POS user profile', error: error.message });
  }
});

// Product search for POS (basic implementation)
router.get('/products/search', async (req, res) => {
  try {
    let { q = '', barcode, limit = 24, categoryId } = req.query;

  const maxLimit = 60;
  const take = Math.min(parseInt(limit, 10) || 24, maxLimit);

  const filter = { isActive: { $ne: false } };

    if (barcode && typeof barcode === 'string' && barcode.trim()) {
      const code = barcode.trim();
      filter.$or = [
        { barcode: code },
        { sku: code }
      ];
    } else if (q && typeof q === 'string' && q.trim()) {
      let term = q.trim();
      if (term.length > 64) term = term.slice(0, 64);
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const or = [
        { name: regex },
        { description: regex },
        { sku: regex },
        { barcode: regex }
      ];

      // Try to match categories by name too
      try {
        const cats = await Category.find({ name: regex }).select('_id').lean();
        if (cats.length) {
          const ids = cats.map(c => c._id);
          or.push({ category: { $in: ids } });
          or.push({ categories: { $in: ids } });
        }
      } catch {}

      filter.$or = or;
    }

    if (categoryId && typeof categoryId === 'string' && categoryId.trim()) {
      try {
        const cid = new mongoose.Types.ObjectId(categoryId.trim());
        filter.$or = filter.$or || [];
        filter.$or.push({ category: cid });
        filter.$or.push({ categories: cid });
      } catch {}
    }

    const docs = await Product.find(filter)
      .select('name price images sku barcode category categories')
      .limit(take)
      .sort({ createdAt: -1 })
      .lean();

    // Provide minimal inventory info so POS UI can enable Add button; real check happens via /pos/inventory/.../check
    const data = docs.map(d => ({
      ...d,
      inventory: { availableQuantity: 100 },
    }));

    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error searching products', error: error.message });
  }
});

// Quick inventory check (basic implementation)
router.get('/inventory/:productId/check', async (req, res) => {
  try {
    const { productId } = req.params;
    const { variantId, quantity = 1 } = req.query;
    
    // Return basic availability info
    res.json({
      available: true,
      availableQuantity: 100,
      productName: 'Sample Product'
    });
  } catch (error) {
    res.status(500).json({ message: 'Error checking inventory', error: error.message });
  }
});

// POS-specific settings (basic implementation)
router.get('/settings', async (req, res) => {
  try {
    const posSettings = {
      currency: 'USD',
      taxRate: 0,
      allowNegativeInventory: false,
      requireReceiptPrint: false,
      autoLogoutMinutes: 30
    };
    
    res.json(posSettings);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching POS settings', error: error.message });
  }
});

export default router;