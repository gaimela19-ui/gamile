import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true
  },
  description: {
    type: String,
    required: [true, 'Product description is required']
  },
  // Localized fields (per-language overrides). Keys are language codes like 'ar', 'he', 'en'.
  name_i18n: {
    type: Map,
    of: String,
    default: undefined
  },
  description_i18n: {
    type: Map,
    of: String,
    default: undefined
  },
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0, 'Price cannot be negative']
  },
  originalPrice: {
    type: Number,
    min: [0, 'Original price cannot be negative']
  },
  discount: {
    type: Number,
    min: [0, 'Discount cannot be negative'],
    max: [100, 'Discount cannot exceed 100%']
  },
  images: [{
    type: String,
    required: [true, 'At least one product image is required']
  }],
  // Optional product videos (e.g., MP4, WebM, hosted links or CDN)
  videoUrls: [{
    type: String,
    validate: {
      validator: function(v) {
        if (!v) return true;
        // Basic URL or relative path check
        return /^(https?:\/\/|\/)/i.test(v);
      },
      message: 'Invalid video URL'
    }
  }],
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Product category is required']
  },
  // Optional brand association
  brand: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Brand'
  },
  // Additional categories (multi-category support). Primary category remains in `category` for backward compatibility.
  categories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  // Legacy variant structure (colors with nested sizes). Optional now; new products can omit for simple single-SKU flow.
  colors: [{
    name: { type: String },
    code: { type: String },
    images: [{ type: String }],
    sizes: [{
      name: { type: String },
      stock: { type: Number }
    }]
  }],
  isNew: {
    type: Boolean,
    default: false
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  order: {
    type: Number,
    default: 0
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  reviews: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    comment: {
      type: String,
      required: true
    },
    // Optional additional metrics captured by mobile app
    fit: { type: Number, min: 1, max: 5 },
    quality: { type: Number, min: 1, max: 5 },
    photos: [{
      type: String
    }],
    helpful: {
      type: Number,
      default: 0
    },
    // Track which users marked this review as helpful (to prevent duplicates)
    helpfulBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    reported: {
      type: Boolean,
      default: false
    },
    // Track which users reported this review and optional reason
    reportedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    reportReason: { type: String },
    verified: {
      type: Boolean,
      default: false
    },
    verifiedAt: { type: Date },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: { type: Date }
  }],
  stock: {
    type: Number,
    required: [true, 'Product stock is required']
  },
  relatedProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }]
  ,
  // Product Add-ons (upsell items shown on product page)
  addOns: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  // Active/Inactive (soft delete) status
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  // SEO & Marketing
  slug: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  metaTitle: { type: String },
  metaDescription: { type: String },
  metaKeywords: [{ type: String }],
  ogTitle: { type: String },
  ogDescription: { type: String },
  ogImage: { type: String },
  // Free-form product tags (e.g., 'accessories', 'new', 'gift')
  tags: [{ type: String, trim: true }],
  // Version counter for images array (used for client cache busting)
  imagesVersion: {
    type: Number,
    default: 0
  },
  // Per-product size guide (دليل المقاسات)
  sizeGuide: {
    // Optional title (e.g., "Men's Shirts")
    title: { type: String },
    // Unit system: 'cm' | 'in'
    unit: { type: String, enum: ['cm', 'in'], default: 'cm' },
    // Table rows: each row corresponds to a size label and measurement columns
    rows: [{
      size: { type: String, required: true },
      chest: { type: Number },
      waist: { type: Number },
      hip: { type: Number },
      length: { type: Number },
      sleeve: { type: Number }
    }],
    // Extra notes / how to measure text
    note: { type: String }
  }
  ,
  // Generic attributes assigned to this product (e.g., Color, Size, Material)
  attributes: [{
    attribute: { type: mongoose.Schema.Types.ObjectId, ref: 'Attribute', required: true },
    // For select/multiselect types, link to predefined values
    values: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AttributeValue' }],
    // For freeform types (text/number), allow inline value
    textValue: { type: String },
    numberValue: { type: Number }
  }]
  ,
  // Variant combinations generated from selected attributes (e.g., Red + M + Cotton)
  // Each variant is a subdocument with its own ObjectId (_id) that is different from the product _id
  variants: [{
    _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
    sku: { type: String, trim: true },
    barcode: { type: String, trim: true },
    // Optional Rivhit item id mapping for this variant
    rivhitItemId: { type: Number },
    price: { type: Number, min: 0 }, // optional override; falls back to product.price
    originalPrice: { type: Number, min: 0 },
    stock: { type: Number, default: 0 },
    images: [{ type: String }],
    isActive: { type: Boolean, default: true },
    // The defining combination for this variant
    attributes: [{
      attribute: { type: mongoose.Schema.Types.ObjectId, ref: 'Attribute', required: true },
      value: { type: mongoose.Schema.Types.ObjectId, ref: 'AttributeValue' },
      textValue: { type: String },
      numberValue: { type: Number }
    }]
  }]
  ,
  // Images associated with specific attribute values for this product (e.g., images for Color=Red)
  attributeImages: [{
    attribute: { type: mongoose.Schema.Types.ObjectId, ref: 'Attribute', required: true },
    value: { type: mongoose.Schema.Types.ObjectId, ref: 'AttributeValue', required: true },
    images: [{ type: String }]
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  suppressReservedKeysWarning: true
});

// Optional Rivhit item id mapping at product level (for simple single-SKU products)
productSchema.add({ rivhitItemId: { type: Number } });
// Prevent duplicates when importing from Rivhit; allow sparse so most products can be without mapping
try { productSchema.index({ rivhitItemId: 1 }, { unique: true, sparse: true }); } catch {}

// Some Rivhit deployments expose a string code instead of numeric id in Item.List
// Track a unique string code as a fallback key for deduplication
productSchema.add({ rivhitItemCode: { type: String, trim: true } });
try { productSchema.index({ rivhitItemCode: 1 }, { unique: true, sparse: true }); } catch {}

// MCG Gateway mapping (optional dedupe/traceability)
productSchema.add({
  mcgItemId: { type: String, trim: true },
  mcgBarcode: { type: String, trim: true }
});
// Enforce uniqueness by MCG item id to prevent duplicates on repeated syncs (sparse to allow products without mapping)
try { productSchema.index({ mcgItemId: 1 }, { unique: true, sparse: true }); } catch {}
try { productSchema.index({ mcgBarcode: 1 }, { sparse: true }); } catch {}

// Virtual for average rating
productSchema.virtual('averageRating').get(function() {
  if (!this.reviews || this.reviews.length === 0) return 0;
  const sum = this.reviews.reduce((acc, review) => acc + review.rating, 0);
  return (sum / this.reviews.length).toFixed(1);
});

// Pre-save middleware to calculate discount
productSchema.pre('save', function(next) {
  if (this.originalPrice && this.price) {
    this.discount = Math.round(((this.originalPrice - this.price) / this.originalPrice) * 100);
  }
  next();
});

// Pre-save middleware to update total stock
// Recompute aggregate stock from nested colors.sizes each save
productSchema.pre('save', function(next) {
  // If legacy variant data exists, derive stock from nested sizes; otherwise keep provided stock untouched.
  if (Array.isArray(this.variants) && this.variants.length > 0) {
    const total = this.variants.reduce((sum, v) => sum + (Number(v?.stock) || 0), 0);
    this.stock = total;
  } else if (this.colors && this.colors.length > 0) {
    const total = this.colors.reduce((sum, color) => {
      if (color && Array.isArray(color.sizes) && color.sizes.length) {
        return sum + color.sizes.reduce((s, sz) => s + (Number(sz.stock) || 0), 0);
      }
      return sum;
    }, 0);
    if (total > 0) {
      this.stock = total;
    }
  }
  next();
});

// Slug generation / normalization
productSchema.pre('save', async function(next) {
  try {
    if (!this.isModified('name') && this.slug) return next();
    // Basic slugify: lowercase, remove diacritics, spaces -> '-', keep alphanum & dashes
    const base = (this.slug || this.name || '')
      .toString()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    if (!base) return next();
    let candidate = base;
    let i = 1;
    while (await mongoose.models.Product.findOne({ slug: candidate, _id: { $ne: this._id } })) {
      candidate = `${base}-${i++}`;
      if (i > 50) break; // safety cap
    }
    this.slug = candidate;
    next();
  } catch (err) {
    next(err);
  }
});

export default mongoose.model('Product', productSchema);