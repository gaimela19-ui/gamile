import mongoose from 'mongoose';

const shippingRateSchema = new mongoose.Schema({
  zone: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ShippingZone',
    required: [true, 'Shipping zone is required']
  },
  // Optional: limit this rate to specific cities inside a zone's countries/regions
  cities: [{
    name: { type: String, trim: true },
    // Allow overriding cost per city (applies to flat_rate / percentage / free when provided)
    cost: { type: Number, min: 0 }
  }],
  name: {
    type: String,
    required: [true, 'Rate name is required'],
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  method: {
    type: String,
    enum: ['flat_rate', 'weight_based', 'percentage', 'free'],
    required: [true, 'Shipping method is required']
  },
  cost: {
    type: Number,
    required: function() {
      return this.method !== 'free';
    },
    min: [0, 'Cost cannot be negative']
  },
  weightRanges: [{
    minWeight: {
      type: Number,
      required: true,
      min: 0
    },
    maxWeight: {
      type: Number,
      required: true,
      min: 0
    },
    cost: {
      type: Number,
      required: true,
      min: 0
    }
  }],
  conditions: {
    minOrderValue: {
      type: Number,
      default: 0,
      min: 0
    },
    maxOrderValue: {
      type: Number,
      min: 0
    },
    minWeight: {
      type: Number,
      default: 0,
      min: 0
    },
    maxWeight: {
      type: Number,
      min: 0
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Pre-save middleware to update the updatedAt field
shippingRateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Pre-update middleware
shippingRateSchema.pre(['updateOne', 'findOneAndUpdate'], function(next) {
  this.set({ updatedAt: Date.now() });
  next();
});

// Validation for weight ranges
shippingRateSchema.pre('save', function(next) {
  if (this.method === 'weight_based' && (!this.weightRanges || this.weightRanges.length === 0)) {
    next(new Error('Weight ranges are required for weight-based shipping'));
  }
  
  // Validate weight ranges
  if (this.weightRanges) {
    for (let range of this.weightRanges) {
      if (range.minWeight >= range.maxWeight) {
        next(new Error('Minimum weight must be less than maximum weight'));
      }
    }
  }
  
  next();
});

// Instance methods
shippingRateSchema.methods.toJSON = function() {
  const rate = this.toObject();
  return rate;
};

shippingRateSchema.methods.calculateCost = function(orderValue, weight) {
  if (!this.isActive) return 0;
  
  // Check conditions
  if (this.conditions.minOrderValue && orderValue < this.conditions.minOrderValue) return null;
  if (this.conditions.maxOrderValue && orderValue > this.conditions.maxOrderValue) return null;
  if (this.conditions.minWeight && weight < this.conditions.minWeight) return null;
  if (this.conditions.maxWeight && weight > this.conditions.maxWeight) return null;
  
  switch (this.method) {
    case 'free':
      return 0;
    case 'flat_rate':
      return this.cost;
    case 'percentage':
      return (orderValue * this.cost) / 100;
    case 'weight_based':
      for (let range of this.weightRanges) {
        if (weight >= range.minWeight && weight <= range.maxWeight) {
          return range.cost;
        }
      }
      return null; // Weight not in any range
    default:
      return null;
  }
};

// Static methods
shippingRateSchema.statics.findByZone = function(zoneId) {
  return this.find({
    zone: zoneId,
    isActive: true
  }).populate('zone');
};

// Find rates that include a given city name (case-insensitive) optionally within a zone list
shippingRateSchema.statics.findByCity = function(cityName, zoneIds = []) {
  const query = {
    isActive: true,
    cities: { $elemMatch: { name: new RegExp(`^${cityName}$`, 'i') } }
  };
  if (zoneIds.length) {
    query.zone = { $in: zoneIds };
  }
  return this.find(query).populate('zone');
};

export default mongoose.model('ShippingRate', shippingRateSchema);
