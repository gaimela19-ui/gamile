import mongoose from 'mongoose';

const PUSH_LOG_RETENTION_DAYS = Number(process.env.PUSH_LOG_RETENTION_DAYS || '180');
const PUSH_LOG_RETENTION_SECONDS = Number.isFinite(PUSH_LOG_RETENTION_DAYS) && PUSH_LOG_RETENTION_DAYS > 0
  ? PUSH_LOG_RETENTION_DAYS * 24 * 60 * 60
  : 180 * 24 * 60 * 60;

const pushLogSchema = new mongoose.Schema({
  title: String,
  body: String,
  data: {},
  imageUrl: { type: String },
  audience: { type: Object },
  tokensCount: { type: Number, default: 0 },
  nid: { type: String, index: true },
  result: {},
  sentAt: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

pushLogSchema.index({ sentAt: -1 });
pushLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: PUSH_LOG_RETENTION_SECONDS });

const PushLog = mongoose.model('PushLog', pushLogSchema);
export default PushLog;
