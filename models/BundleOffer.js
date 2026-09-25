import mongoose from 'mongoose';

const bundleProductSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, default: 1 },
  order: { type: Number, default: 0 }
}, { _id: false });

const metricsSchema = new mongoose.Schema({
  views: { type: Number, default: 0 },
  addToCart: { type: Number, default: 0 },
  salesAmount: { type: Number, default: 0 }, // total amount sold via this bundle
  ordersCount: { type: Number, default: 0 }
}, { _id: false });

const bundleOfferSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String },
  products: { type: [bundleProductSchema], default: [] },
  // Pricing options: either explicit bundle price or discount type/value
  price: { type: Number }, // explicit final price for the bundle (optional)
  discountType: { type: String, enum: ['percent', 'fixed', null], default: null },
  discountValue: { type: Number },
  active: { type: Boolean, default: true },
  startDate: { type: Date },
  endDate: { type: Date },
  metrics: { type: metricsSchema, default: () => ({}) },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

bundleOfferSchema.index({ active: 1, startDate: 1, endDate: 1 });

export default mongoose.model('BundleOffer', bundleOfferSchema);
