import mongoose from 'mongoose';

const pageSettingsSchema = new mongoose.Schema(
  {
    header: {
      openCategoriesMenu: { type: Boolean, default: false },
      customHeader: { type: String, default: '' }
    },
    pageTitle: { type: mongoose.Schema.Types.Mixed, default: {} },
    sidebar: { type: mongoose.Schema.Types.Mixed, default: {} },
    footer: { type: mongoose.Schema.Types.Mixed, default: {} },
    mobile: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { _id: false }
);

const pageSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    content: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    metaTitle: { type: String, default: '' },
    metaDescription: { type: String, default: '' },
    publishedAt: { type: Date },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    settings: { type: pageSettingsSchema, default: () => ({}) }
  },
  { timestamps: true }
);

pageSchema.index({ slug: 1 }, { unique: true });
pageSchema.index({ status: 1, updatedAt: -1 });
pageSchema.index({ title: 'text', content: 'text', metaTitle: 'text', metaDescription: 'text' });

export default mongoose.model('Page', pageSchema);
