import mongoose from 'mongoose';

const posRegisterSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  location: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  openingBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  currentBalance: {
    type: Number,
    default: 0
  },
  // Currency handling
  currency: {
    type: String,
    required: true,
    default: 'USD'
  },
  // Security and tracking
  lastOpenedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lastOpenedAt: Date,
  lastClosedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lastClosedAt: Date,
  // Configuration
  settings: {
    requireOpeningBalance: { type: Boolean, default: true },
    allowNegativeBalance: { type: Boolean, default: false },
    autoCloseAt: String, // Time in HH:MM format
    maxDiscountPercent: { type: Number, default: 100 },
    taxRate: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

// Indexes for better performance
posRegisterSchema.index({ isActive: 1 });
posRegisterSchema.index({ location: 1 });

export default mongoose.model('POSRegister', posRegisterSchema);