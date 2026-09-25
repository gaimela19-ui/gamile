import mongoose from 'mongoose';

const legalPageViewSchema = new mongoose.Schema({
  page: { type: String, enum: ['privacy', 'terms'], required: true },
  ipHash: { type: String },
  userAgent: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// Simple TTL index (optional future) could be added if we only want recent stats
// legalPageViewSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });

// Indexes for efficient filtering & sorting
legalPageViewSchema.index({ page: 1, createdAt: -1 });
legalPageViewSchema.index({ createdAt: -1 });

export default mongoose.model('LegalPageView', legalPageViewSchema);
