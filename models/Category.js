import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  // Localized fields (maps lang -> text)
  name_i18n: { type: Map, of: String, default: undefined },
  description_i18n: { type: Map, of: String, default: undefined },
  image: {
    type: String,
    required: [true, 'Category image is required']
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true
  },
  // Optional custom route override for storefront navigation
  route: {
    type: String,
    trim: true,
    default: null
  },
  // Optional custom route for mobile app (can differ from web route)
  mobileRoute: {
    type: String,
    trim: true,
    default: null
  },
  // Hierarchy
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null,
    index: true
  },
  // Ancestor chain (root -> ... -> parent)
  ancestors: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    index: true
  }],
  depth: {
    type: Number,
    default: 0,
    index: true
  },
  // SEO-friendly full path of slugs (e.g., "men/tops/shirts")
  path: {
    type: String,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  },
  // Controls the visual tile size on the storefront categories grid
  tileSize: {
    type: String,
    enum: ['short', 'long'],
    default: 'short'
  }
}, {
  timestamps: true
});

// Create a more robust slug from name before saving and compute hierarchy fields
categorySchema.pre('save', async function(next) {
  try {
    if (!this.name) {
      throw new Error('Category name is required');
    }

    // Create base slug from name
    let baseSlug = this.name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters except hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-'); // Replace multiple hyphens with single hyphen

    // If slug is empty after cleaning, use a default
    if (!baseSlug) {
      baseSlug = 'category';
    }

    // Check if slug exists
    let slug = baseSlug;
    let counter = 1;
    
    while (true) {
      // Skip checking if this is a new document and slug hasn't changed
      if (!this.isNew && this.slug === slug) {
        break;
      }

      const existingCategory = await mongoose.model('Category').findOne({ slug });
      
      if (!existingCategory) {
        break;
      }

      // Add counter to slug
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    this.slug = slug;

    // Guard: parent cannot be itself
    if (this.parent && this._id && this.parent.toString() === this._id.toString()) {
      throw new Error('Category cannot be its own parent');
    }

    // Compute ancestors/depth/path based on parent
    if (this.parent) {
      const parentDoc = await mongoose.model('Category').findById(this.parent).select('_id slug path ancestors depth');
      if (!parentDoc) {
        throw new Error('Parent category not found');
      }
      // Prevent cycles: parent cannot be a descendant of this
      if (this._id && parentDoc.ancestors && parentDoc.ancestors.map(String).includes(this._id.toString())) {
        throw new Error('Invalid parent: would create a cycle');
      }
      this.ancestors = [...(parentDoc.ancestors || []), parentDoc._id];
      this.depth = (parentDoc.depth || 0) + 1;
      const parentPath = parentDoc.path || parentDoc.slug;
      this.path = parentPath ? `${parentPath}/${this.slug}` : this.slug;
    } else {
      // Root category
      this.ancestors = [];
      this.depth = 0;
      this.path = this.slug;
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Add index for slug with collation for case-insensitive uniqueness
categorySchema.index({ slug: 1 }, { 
  unique: true,
  collation: { locale: 'en', strength: 2 }
});

// Helpful indexes for hierarchy queries
categorySchema.index({ parent: 1, order: 1 });
categorySchema.index({ ancestors: 1 });
categorySchema.index({ path: 1 });
// Enforce name uniqueness per parent (case-insensitive)
categorySchema.index({ parent: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export default mongoose.model('Category', categorySchema);