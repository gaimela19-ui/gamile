import mongoose from 'mongoose';

const footerLinkSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Link name is required'],
    trim: true
  },
  // Localized name (maps lang -> text)
  name_i18n: { type: Map, of: String, default: undefined },
  url: {
    type: String,
    required: [true, 'URL is required'],
    trim: true
  },
  section: {
    type: String,
    enum: ['shop', 'support', 'company'],
    required: [true, 'Section is required']
  },
  order: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Add index for section and order
footerLinkSchema.index({ section: 1, order: 1 });

export default mongoose.model('FooterLink', footerLinkSchema);