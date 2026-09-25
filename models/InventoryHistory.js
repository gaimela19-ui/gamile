import mongoose from 'mongoose';

const inventoryHistorySchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  type: {
    type: String,
    enum: ['increase', 'decrease', 'update'],
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    // User may be undefined for guest checkouts or system actions
    required: false,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

const INVENTORY_HISTORY_RETENTION_DAYS_RAW = Number(process.env.INVENTORY_HISTORY_RETENTION_DAYS || '90');
const INVENTORY_HISTORY_RETENTION_DAYS = Number.isFinite(INVENTORY_HISTORY_RETENTION_DAYS_RAW) && INVENTORY_HISTORY_RETENTION_DAYS_RAW > 0
  ? INVENTORY_HISTORY_RETENTION_DAYS_RAW
  : 90;
const INVENTORY_HISTORY_RETENTION_SECONDS = INVENTORY_HISTORY_RETENTION_DAYS * 24 * 60 * 60;

// Performance indexes for analytics queries filtered/sorted by time and product
try { inventoryHistorySchema.index({ timestamp: -1 }); } catch {}
try { inventoryHistorySchema.index({ product: 1, timestamp: -1 }); } catch {}
try { inventoryHistorySchema.index({ user: 1, timestamp: -1 }); } catch {}

// Auto-expire old inventory history records after retention window.
// Set process.env.INVENTORY_HISTORY_RETENTION_DAYS to override (default: 90 days).
try {
  inventoryHistorySchema.index({ timestamp: 1 }, { expireAfterSeconds: INVENTORY_HISTORY_RETENTION_SECONDS });
} catch {}

export default mongoose.model('InventoryHistory', inventoryHistorySchema);