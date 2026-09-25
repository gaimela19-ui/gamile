import mongoose from 'mongoose';

const mcgArchivedItemSchema = new mongoose.Schema({
  barcode: { type: String, trim: true },
  mcgItemId: { type: String, trim: true },
  reason: { type: String, default: 'manual_archive' },
  notes: { type: String, default: '' },
  lastProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  lastProductName: { type: String, default: '' },
  archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  archivedAt: { type: Date, default: () => new Date() }
}, {
  timestamps: true
});

mcgArchivedItemSchema.pre('validate', function(next) {
  if (!this.barcode && !this.mcgItemId) {
    return next(new Error('McgArchivedItem requires either barcode or mcgItemId.'));
  }
  next();
});

mcgArchivedItemSchema.index(
  { barcode: 1 },
  {
    unique: true,
    partialFilterExpression: { barcode: { $type: 'string', $ne: '' } }
  }
);

mcgArchivedItemSchema.index(
  { mcgItemId: 1 },
  {
    unique: true,
    partialFilterExpression: { mcgItemId: { $type: 'string', $ne: '' } }
  }
);

export default mongoose.models.McgArchivedItem || mongoose.model('McgArchivedItem', mcgArchivedItemSchema);
