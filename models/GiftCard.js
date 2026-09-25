import mongoose from 'mongoose';
import cryptoRandomString from 'crypto-random-string';

const giftCardSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    default: () => cryptoRandomString({ length: 16, type: 'alphanumeric' }).toUpperCase()
  },
  initialBalance: {
    type: Number,
    required: true,
    min: 0
  },
  currentBalance: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    default: 'USD'
  },
  expiryDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'redeemed', 'expired', 'cancelled'],
    default: 'active'
  },
  purchasedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipient: {
    name: String,
    email: String,
    message: String
  },
  redemptions: [{
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order'
    },
    amount: Number,
    date: {
      type: Date,
      default: Date.now
    }
  }],
  lastUsed: Date
}, {
  timestamps: true
});

// Update status based on balance and expiry
giftCardSchema.pre('save', function(next) {
  const now = new Date();
  
  if (this.currentBalance === 0) {
    this.status = 'redeemed';
  } else if (this.expiryDate < now) {
    this.status = 'expired';
  }
  
  next();
});

// Add index for efficient querying
giftCardSchema.index({ code: 1 }, { unique: true });
giftCardSchema.index({ status: 1, expiryDate: 1 });
giftCardSchema.index({ purchasedBy: 1 });

export default mongoose.model('GiftCard', giftCardSchema);