import mongoose from 'mongoose';

const scheduledPushSchema = new mongoose.Schema({
  title: { type: String, required: true },
  body: { type: String, required: true },
  data: {},
  imageUrl: { type: String },
  badge: { type: Number }, // optional iOS badge to set
  sound: { type: String }, // optional custom sound name (iOS) or used for channel mapping
  audience: { type: Object, required: true }, // { type: 'all'|'admins'|'user', userId?, email? }
  scheduleAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ['scheduled', 'sent', 'cancelled', 'failed'], default: 'scheduled', index: true },
  result: {},
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

scheduledPushSchema.index({ status: 1, scheduleAt: 1 });

const ScheduledPush = mongoose.model('ScheduledPush', scheduledPushSchema);
export default ScheduledPush;
