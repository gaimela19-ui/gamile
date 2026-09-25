import mongoose from 'mongoose';

const posTransactionSchema = new mongoose.Schema({
  transactionNumber: {
    type: String,
    required: true,
    unique: true
  },
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'POSSession',
    required: true
  },
  register: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'POSRegister',
    required: true
  },
  cashier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Transaction type
  type: {
    type: String,
    enum: ['sale', 'refund', 'void', 'no-sale'],
    default: 'sale'
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'voided', 'refunded'],
    default: 'pending'
  },
  // Items purchased
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    variant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductVariant'
    },
    quantity: {
      type: Number,
      required: true,
      min: 0
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0
    },
    totalPrice: {
      type: Number,
      required: true,
      min: 0
    },
    discount: {
      amount: { type: Number, default: 0 },
      percentage: { type: Number, default: 0 },
      reason: String
    },
    tax: {
      rate: { type: Number, default: 0 },
      amount: { type: Number, default: 0 }
    },
    // Product snapshot for historical accuracy
    productName: String,
    productSku: String,
    variantName: String
  }],
  // Financial details
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  totalDiscount: {
    type: Number,
    default: 0,
    min: 0
  },
  totalTax: {
    type: Number,
    default: 0,
    min: 0
  },
  total: {
    type: Number,
    required: true,
    min: 0
  },
  // Payment information
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'digital', 'gift-card', 'split', 'other'],
    required: true
  },
  payments: [{
    method: {
      type: String,
      enum: ['cash', 'card', 'digital', 'gift-card', 'other'],
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    reference: String, // Card reference, gift card number, etc.
    processor: String, // Payment processor used
    processorResponse: mongoose.Schema.Types.Mixed
  }],
  amountPaid: {
    type: Number,
    required: true,
    min: 0
  },
  change: {
    type: Number,
    default: 0,
    min: 0
  },
  // Customer information (optional for POS)
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  customerInfo: {
    name: String,
    email: String,
    phone: String
  },
  // Discount and promotion tracking
  coupons: [{
    code: String,
    discount: Number,
    type: { type: String, enum: ['percentage', 'fixed'] }
  }],
  // Receipt and tracking
  receiptNumber: String,
  receiptPrinted: {
    type: Boolean,
    default: false
  },
  receiptEmailSent: {
    type: Boolean,
    default: false
  },
  // References
  originalTransaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'POSTransaction'
  }, // For refunds and voids
  relatedOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  }, // If POS transaction creates an order
  // Currency
  currency: {
    type: String,
    required: true,
    default: 'USD'
  },
  // Notes and metadata
  notes: String,
  internalNotes: String,
  metadata: mongoose.Schema.Types.Mixed
}, {
  timestamps: true
});

// Indexes for better performance
posTransactionSchema.index({ session: 1, createdAt: -1 });
posTransactionSchema.index({ register: 1, createdAt: -1 });
posTransactionSchema.index({ cashier: 1, createdAt: -1 });
posTransactionSchema.index({ transactionNumber: 1 }, { unique: true });
posTransactionSchema.index({ receiptNumber: 1 });
posTransactionSchema.index({ type: 1, status: 1 });
posTransactionSchema.index({ customer: 1 });
posTransactionSchema.index({ createdAt: -1 });

// Generate transaction number before saving
posTransactionSchema.pre('save', async function(next) {
  if (this.isNew && !this.transactionNumber) {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.constructor.countDocuments({
      createdAt: {
        $gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
        $lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
      }
    });
    this.transactionNumber = `POS-${dateStr}-${String(count + 1).padStart(4, '0')}`;
  }
  
  // Generate receipt number if not provided
  if (this.isNew && !this.receiptNumber) {
    this.receiptNumber = this.transactionNumber;
  }
  
  next();
});

// Virtual for net amount (useful for reports)
posTransactionSchema.virtual('netAmount').get(function() {
  if (this.type === 'refund') {
    return -this.total;
  }
  return this.total;
});

export default mongoose.model('POSTransaction', posTransactionSchema);