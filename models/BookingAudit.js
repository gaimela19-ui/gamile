import mongoose from 'mongoose';

const BookingAuditSchema = new mongoose.Schema({
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
  action: { type: String, required: true }, // create | status-change | cancel
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // optional user
  statusBefore: { type: String },
  statusAfter: { type: String },
  meta: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

BookingAuditSchema.index({ booking: 1, createdAt: -1 });

export default mongoose.models.BookingAudit || mongoose.model('BookingAudit', BookingAuditSchema);