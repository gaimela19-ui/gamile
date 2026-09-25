import mongoose from 'mongoose';

const flashSaleItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  flashPrice: { type: Number, required: true },
  quantityLimit: { type: Number, default: 0 }, // 0 = unlimited per order
  order: { type: Number, default: 0 }
}, { _id: false });

const flashSaleSchema = new mongoose.Schema({
  name: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  items: [flashSaleItemSchema],
  active: { type: Boolean, default: true },
  // Scope of the sale: apply to explicit products list (default) or dynamically-selected categories/brands
  targetType: { type: String, enum: ['products', 'categories', 'brands'], default: 'products' },
  // When targetType === 'categories', the selected categories that define the product set
  categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  // When targetType === 'brands', the selected brands that define the product set
  brandIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Brand' }],
  // Pricing mode persistence: 'fixed' (per-item price) or 'percent' (global discount)
  pricingMode: { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
  // When pricingMode === 'percent', apply this percentage across items (UI convenience; items.flashPrice remains the source of truth for checkout)
  discountPercent: { type: Number, min: 0, max: 100 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

flashSaleSchema.index({ startDate: 1, endDate: 1 });

export default mongoose.model('FlashSale', flashSaleSchema);
