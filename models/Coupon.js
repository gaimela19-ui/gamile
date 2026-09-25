import mongoose from 'mongoose';
import { nanoid } from 'nanoid';

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    default: () => nanoid(8).toUpperCase()
  },
  type: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: true
  },
  value: {
    type: Number,
    required: true,
    min: 0
  },
  minPurchase: {
    type: Number,
    default: 0,
    min: 0
  },
  maxDiscount: {
    type: Number,
    min: 0
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  usageLimit: {
    type: Number,
    min: 0
  },
  usedCount: {
    type: Number,
    default: 0
  },
  description: String,
  categories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  products: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }]
}, {
  timestamps: true
});

// Add index for efficient querying
couponSchema.index({ code: 1 }, { unique: true });
couponSchema.index({ startDate: 1, endDate: 1, isActive: 1 });

export default mongoose.model('Coupon', couponSchema);