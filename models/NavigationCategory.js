import mongoose from 'mongoose';

const navigationCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    unique: true,
    trim: true
  },
  // Localized name (maps lang -> text)
  name_i18n: { type: Map, of: String, default: undefined },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    index: true
  },
  // Optional custom route override (e.g., /booking)
  route: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  },
  // Optional display sub-categories (kept for backwards compatibility with existing UI)
  subCategories: [{
    name: {
      type: String,
      required: true
    },
    // Localized subcategory name
    name_i18n: { type: Map, of: String, default: undefined },
    slug: {
      type: String,
      required: true
    }
  }],
  // Canonical mapping to catalog categories; allows selecting multiple categories per nav item
  categories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    index: true
  }],
  // New: allow multiple slugs under a single navigation item, each with its own categories
  slugGroups: [{
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    title: {
      type: String,
      trim: true
    },
    // Localized group title
    title_i18n: { type: Map, of: String, default: undefined },
    categories: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category'
    }]
  }]
}, {
  timestamps: true
});

// Unique index for nested group slugs across the whole collection
// This enforces that each slug across all groups is globally unique
navigationCategorySchema.index({ 'slugGroups.slug': 1 }, { unique: true, sparse: true, collation: { locale: 'en', strength: 2 } });

// Create slug from name (if needed) and sync categories from subCategories before saving
navigationCategorySchema.pre('save', async function(next) {
  try {
    // 1) Ensure slug exists and is unique
    if (this.isModified('name') || !this.slug) {
      const base = (this.name || this.slug || '')
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');

      let desired = base || 'nav';
      let candidate = desired;

      // If updating and slug already matches, skip uniqueness loop
      let counter = 1;
      while (await this.constructor.findOne({ slug: candidate, _id: { $ne: this._id } })) {
        candidate = `${desired}-${counter}`;
        counter++;
      }
      this.slug = candidate;
    }

    // 2) If categories not provided explicitly, try to resolve from subCategories slugs
    const hasExplicitCategories = Array.isArray(this.categories) && this.isModified('categories');
    const hasSubCats = Array.isArray(this.subCategories) && this.subCategories.length > 0;

    if (!hasExplicitCategories && hasSubCats) {
      const slugs = this.subCategories
        .map(sc => sc && sc.slug)
        .filter(Boolean);
      if (slugs.length > 0) {
        const Category = mongoose.model('Category');
        const docs = await Category.find({ slug: { $in: slugs } }).select('_id slug');
        this.categories = docs.map(d => d._id);
      }
    }

    // 3) Sanitize group slugs and ensure they are unique within the document.
    if (Array.isArray(this.slugGroups) && this.slugGroups.length) {
      const used = new Set();
      this.slugGroups = this.slugGroups.map((grp) => {
        let base = String(grp.slug || '').toLowerCase().trim()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-');
        if (!base) base = 'nav';
        let candidate = base;
        let c = 1;
        while (used.has(candidate)) {
          candidate = `${base}-${c++}`;
        }
        used.add(candidate);
        return { ...grp, slug: candidate };
      });
    }

    next();
  } catch (error) {
    next(error);
  }
});

export default mongoose.model('NavigationCategory', navigationCategorySchema);