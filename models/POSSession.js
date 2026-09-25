import mongoose from 'mongoose';

const posSessionSchema = new mongoose.Schema({
  register: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'POSRegister',
    required: true
  },
  openedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  closedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  openedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  closedAt: Date,
  status: {
    type: String,
    enum: ['open', 'closed', 'suspended'],
    default: 'open'
  },
  // Financial tracking
  openingBalance: {
    type: Number,
    required: true,
    min: 0
  },
  closingBalance: {
    type: Number,
    default: 0
  },
  expectedClosingBalance: {
    type: Number,
    default: 0
  },
  variance: {
    type: Number,
    default: 0
  },
  // Transaction summary
  totalTransactions: {
    type: Number,
    default: 0
  },
  totalSales: {
    type: Number,
    default: 0
  },
  totalRefunds: {
    type: Number,
    default: 0
  },
  totalDiscounts: {
    type: Number,
    default: 0
  },
  totalTax: {
    type: Number,
    default: 0
  },
  // Payment method breakdown
  paymentMethods: {
    cash: { type: Number, default: 0 },
    card: { type: Number, default: 0 },
    digital: { type: Number, default: 0 },
    giftCard: { type: Number, default: 0 },
    other: { type: Number, default: 0 }
  },
  // Notes and observations
  openingNotes: String,
  closingNotes: String,
  // Currency
  currency: {
    type: String,
    required: true,
    default: 'USD'
  }
}, {
  timestamps: true
});

// Indexes for better performance
posSessionSchema.index({ register: 1, openedAt: -1 });
posSessionSchema.index({ openedBy: 1 });
posSessionSchema.index({ status: 1 });
posSessionSchema.index({ openedAt: -1 });

// Virtual for session duration
posSessionSchema.virtual('duration').get(function() {
  if (this.closedAt && this.openedAt) {
    return this.closedAt - this.openedAt;
  }
  return null;
});

// Virtual for net sales (sales minus refunds)
posSessionSchema.virtual('netSales').get(function() {
  return this.totalSales - this.totalRefunds;
});

export default mongoose.model('POSSession', posSessionSchema);