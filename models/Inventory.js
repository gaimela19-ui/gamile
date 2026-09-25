import mongoose from 'mongoose';

const inventorySchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  // Optional reference to a product variant (subdocument _id inside Product.variants)
  // When present, size/color become optional and can be omitted.
  variantId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false,
    index: true
  },
  size: {
    type: String,
    required: false
  },
  color: {
    type: String,
    required: false
  },
  quantity: {
    type: Number,
    required: true,
    default: 0
  },
  lowStockThreshold: {
    type: Number,
    default: 5
  },
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: true
  },
  location: {
    type: String
  },
  // Snapshot of variant attributes for quick display (denormalized, optional)
  attributesSnapshot: [{
    attribute: { type: mongoose.Schema.Types.ObjectId, ref: 'Attribute' },
    value: { type: mongoose.Schema.Types.ObjectId, ref: 'AttributeValue' },
    textValue: { type: String },
    numberValue: { type: Number }
  }],
  status: {
    type: String,
    enum: ['in_stock', 'low_stock', 'out_of_stock'],
    default: 'in_stock'
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
// 1) Unique per product+variant+warehouse when variantId is set
inventorySchema.index(
  { product: 1, variantId: 1, warehouse: 1 },
  // Use $exists:true for broad compatibility (avoid $type in partial indexes on older MongoDB)
  { unique: true, partialFilterExpression: { variantId: { $exists: true } } }
);
// 2) Backward-compat: unique per product+size+color+warehouse when variantId is NOT set
inventorySchema.index(
  { product: 1, size: 1, color: 1, warehouse: 1 },
  // Use equality-to-null which matches both null and non-existent fields; $exists:false may not be supported in partial indexes on some MongoDB versions
  { unique: true, partialFilterExpression: { variantId: null } }
);

// Update status based on quantity
inventorySchema.pre('save', function(next) {
  if (this.quantity <= 0) {
    this.status = 'out_of_stock';
  } else if (this.quantity <= this.lowStockThreshold) {
    this.status = 'low_stock';
  } else {
    this.status = 'in_stock';
  }
  this.lastUpdated = new Date();
  next();
});

export default mongoose.model('Inventory', inventorySchema);