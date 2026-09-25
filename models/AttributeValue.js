import mongoose from 'mongoose';

const attributeValueSchema = new mongoose.Schema({
  attribute: { type: mongoose.Schema.Types.ObjectId, ref: 'Attribute', required: true, index: true },
  value: { type: String, required: true, trim: true },
  // Optional localized display values
  value_i18n: { type: Map, of: String, default: undefined },
  slug: { type: String, index: true },
  // Optional metadata for values (e.g., color hex, numeric unit)
  meta: {
    colorHex: { type: String },
    numberValue: { type: Number },
    image: { type: String }
  },
  order: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

attributeValueSchema.index({ attribute: 1, value: 1 }, { unique: true });

attributeValueSchema.pre('save', async function(next) {
  try {
    if (!this.isModified('value') && this.slug) return next();
    const base = String(this.slug || this.value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    this.slug = base || this.slug;
    next();
  } catch (e) { next(e); }
});

export default mongoose.model('AttributeValue', attributeValueSchema);
