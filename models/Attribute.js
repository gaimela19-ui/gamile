import mongoose from 'mongoose';

const attributeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  // Optional localized display names per language code, e.g., { ar: '...' , he: '...' }
  name_i18n: { type: Map, of: String, default: undefined },
  slug: { type: String, index: true, unique: true, sparse: true },
  type: { 
    type: String, 
    enum: ['text', 'number', 'color', 'size', 'material', 'select', 'multiselect'], 
    default: 'select' 
  },
  description: { type: String },
  // Optional localized description
  description_i18n: { type: Map, of: String, default: undefined },
  allowMultiple: { type: Boolean, default: true },
  required: { type: Boolean, default: false },
  order: { type: Number, default: 0 }
}, { timestamps: true });

// Auto-generate slug from name when missing or name changed
attributeSchema.pre('save', async function(next) {
  try {
    if (!this.isModified('name') && this.slug) return next();
    const base = String(this.slug || this.name || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    if (!base) return next();
    let candidate = base; let i = 1;
    while (await mongoose.models.Attribute.findOne({ slug: candidate, _id: { $ne: this._id } })) {
      candidate = `${base}-${i++}`; if (i > 50) break;
    }
    this.slug = candidate; next();
  } catch (e) { next(e); }
});

export default mongoose.model('Attribute', attributeSchema);
