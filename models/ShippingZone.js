import mongoose from 'mongoose';

const shippingZoneSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Zone name is required'],
    unique: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  countries: [{
    type: String,
    required: true,
    trim: true
  }],
  // Uniform price applied to all cities/countries in this zone (optional)
  zonePrice: {
    type: Number,
    required: false,
    default: null,
    min: 0
  },
  areaGroupPrices: [{
    areaGroup: {
      type: String,
      trim: true
    },
    price: {
      type: Number,
      min: 0
    },
    deliveryTimeValue: {
      type: String,
      trim: true,
      default: ''
    },
    deliveryTimeUnit: {
      type: String,
      enum: ['hours', 'days'],
      default: 'days'
    }
  }],
  regions: [{
    type: String,
    trim: true
  }],
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
shippingZoneSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Pre-update middleware
shippingZoneSchema.pre(['updateOne', 'findOneAndUpdate'], function(next) {
  this.set({ updatedAt: Date.now() });
  next();
});

// Instance methods
shippingZoneSchema.methods.toJSON = function() {
  const zone = this.toObject();
  return zone;
};

// Static methods
shippingZoneSchema.statics.findByCountry = function(country) {
  return this.find({
    countries: { $in: [country] },
    isActive: true
  });
};

shippingZoneSchema.statics.findByRegion = function(region) {
  return this.find({
    regions: { $in: [region] },
    isActive: true
  });
};

export default mongoose.model('ShippingZone', shippingZoneSchema);
