import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    required: true,
    unique: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    name: String,
    image: String,
    size: String, // Added for size-specific stock tracking
    // Optional color for inventory and display (store human-readable name or code)
    color: String,
    // Generic variant selections (attribute/value pairs) for display and analytics
    // Keep schema flexible to avoid tight coupling to attribute models
    variants: [{
      attributeId: { type: String }, // optional id as string
      attributeName: { type: String },
      valueId: { type: String }, // optional id as string
      valueName: { type: String }
    }],
    // Exact variant reference when applicable (e.g., product.variants[])
    variantId: { type: String },
    sku: { type: String }
  }],
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    enum: ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD', 'LBP', 'EGP', 'IQD', 'ILS'],
    default: () => process.env.STORE_CURRENCY || 'USD'
  },
  // In single store currency mode, exchangeRate is always 1 (kept for backward compatibility with historical orders/analytics)
  exchangeRate: {
    type: Number,
    required: true,
    default: 1,
    min: 0
  },
  shippingAddress: {
    street: {
      type: String,
      required: true
    },
    city: {
      type: String,
      required: true
    },
    areaGroup: {
      type: String,
      default: ''
    },
    country: {
      type: String,
      required: true,
      enum: ['JO', 'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'EG', 'IQ', 'LB', 'PS']
    }
  },
  customerInfo: {
    firstName: {
      type: String,
      required: true
    },
    lastName: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true
    },
    mobile: {
      type: String,
      required: true,
      validate: {
        validator: function(v) {
          return /^\+[0-9]{1,4}[0-9]{9,10}$/.test(v);
        },
        message: 'Invalid mobile number format'
      }
    },
    secondaryMobile: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^\+[0-9]{1,4}[0-9]{9,10}$/.test(v);
        },
        message: 'Invalid secondary mobile number format'
      }
    }
  },
  paymentMethod: {
    type: String,
    enum: ['card', 'cod', 'paypal'],
    required: true
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  paymentReference: { type: String },
  paymentDetails: { type: mongoose.Schema.Types.Mixed },
  coupon: {
    code: { type: String },
    discount: { type: Number, default: 0 }
  },
  giftCard: {
    code: { type: String },
    amountApplied: { type: Number, default: 0 },
    remainingBalance: { type: Number }
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  deliveryCompany: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryCompany'
  },
  deliveryStatus: {
    type: String,
    enum: ['assigned', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'returned', 'cancelled'],
    default: null
  },
  deliveryTrackingNumber: {
    type: String
  },
  deliveryResponse: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  deliveryAssignedAt: {
    type: Date
  },
  deliveryMappedData: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  deliveryFieldMappings: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  deliveryFee: {
    type: Number,
    default: 0
  },
  // Shipping fee (can mirror deliveryFee for backward compatibility)
  shippingFee: {
    type: Number,
    default: 0
  },
  // City-level shipping metadata
  shippingCity: { type: String },
  shippingZoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShippingZone' },
  shippingRateId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShippingRate' },
  shippingMethodName: { type: String },
  shippingCalculation: {
    type: mongoose.Schema.Types.Mixed, // store raw calculation context (subtotal, weight, zone candidates, etc.)
    default: null
  },
  shippingCostComponents: [{
    label: String,
    amount: Number
  }],
  deliveryStatusUpdated: {
    type: Date
  },
  deliveryCancellationReason: {
    type: String
  },
  deliveryEstimatedDate: {
    type: Date
  },
  deliveryActualDate: {
    type: Date
  },
  deliveryNotes: {
    type: String
  },
  // Legacy field for backward compatibility
  trackingNumber: {
    type: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual: If shippingFee not explicitly set but deliveryFee exists, expose it
orderSchema.virtual('effectiveShippingFee').get(function() {
  if (typeof this.shippingFee === 'number' && this.shippingFee > 0) return this.shippingFee;
  return this.deliveryFee || 0;
});

// Virtual: Total including shipping (non-destructive; does not mutate stored totalAmount)
orderSchema.virtual('totalWithShipping').get(function() {
  const base = this.totalAmount || 0;
  const ship = (typeof this.shippingFee === 'number' && this.shippingFee > 0)
    ? this.shippingFee
    : (this.deliveryFee || 0);
  // Heuristic: if base already appears to include ship (i.e., a single item subtotal + ship equals base),
  // avoid double-adding. We attempt to reconstruct items subtotal.
  let reconstructedSubtotal = 0;
  try {
    if (Array.isArray(this.items)) {
      for (const it of this.items) {
        if (it && typeof it.price === 'number' && typeof it.quantity === 'number') {
          reconstructedSubtotal += (it.price * it.quantity);
        }
      }
    }
  } catch {}
  // If reconstructed subtotal is positive and base - reconstructedSubtotal === ship (within 0.0001), assume already included.
  if (reconstructedSubtotal > 0) {
    const diff = Math.abs((base - reconstructedSubtotal) - ship);
    if (diff < 0.0001) {
      return base; // base already includes shipping
    }
  }
  return base + ship;
});

// Keep shippingFee and deliveryFee loosely in sync (one-way: if deliveryFee changes and shippingFee is 0)
orderSchema.pre('save', function(next) {
  if (this.isModified('deliveryFee')) {
    if ((!this.shippingFee || this.shippingFee === 0) && this.deliveryFee) {
      this.shippingFee = this.deliveryFee;
    }
  }
  // Reverse direction: if shippingFee changed and deliveryFee still empty/zero, mirror it
  if (this.isModified('shippingFee')) {
    if ((!this.deliveryFee || this.deliveryFee === 0) && this.shippingFee) {
      this.deliveryFee = this.shippingFee;
    }
  }
  next();
});

// Add index for orderNumber
orderSchema.index({ orderNumber: 1 }, { unique: true });

// Add index for user to optimize queries
orderSchema.index({ user: 1 });

// Add compound index for status and createdAt for filtered queries
orderSchema.index({ status: 1, createdAt: -1 });

// Optimize date-range analytics queries regardless of status
orderSchema.index({ createdAt: -1 });

// Add delivery-related indexes
orderSchema.index({ deliveryCompany: 1 });
orderSchema.index({ deliveryStatus: 1 });
orderSchema.index({ deliveryTrackingNumber: 1 });
orderSchema.index({ deliveryCompany: 1, deliveryStatus: 1 });
orderSchema.index({ deliveryAssignedAt: -1 });

export default mongoose.model('Order', orderSchema);