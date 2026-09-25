import mongoose from 'mongoose';

const PUSH_OPEN_RETENTION_DAYS = Number(process.env.PUSH_OPEN_RETENTION_DAYS || '180');
const PUSH_OPEN_RETENTION_SECONDS = Number.isFinite(PUSH_OPEN_RETENTION_DAYS) && PUSH_OPEN_RETENTION_DAYS > 0
  ? PUSH_OPEN_RETENTION_DAYS * 24 * 60 * 60
  : 180 * 24 * 60 * 60;

const pushOpenSchema = new mongoose.Schema({
  nid: { type: String, required: true, index: true },
  expoPushToken: { type: String },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  openedAt: { type: Date, default: Date.now }
}, { timestamps: true });

pushOpenSchema.index({ openedAt: -1 });
pushOpenSchema.index({ createdAt: 1 }, { expireAfterSeconds: PUSH_OPEN_RETENTION_SECONDS });

const PushOpen = mongoose.model('PushOpen', pushOpenSchema);
export default PushOpen;
