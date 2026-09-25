import mongoose from 'mongoose';

const WHATSAPP_AUDIT_RETENTION_DAYS = Number(process.env.WHATSAPP_AUDIT_RETENTION_DAYS || '180');
const WHATSAPP_AUDIT_RETENTION_SECONDS = Number.isFinite(WHATSAPP_AUDIT_RETENTION_DAYS) && WHATSAPP_AUDIT_RETENTION_DAYS > 0
  ? WHATSAPP_AUDIT_RETENTION_DAYS * 24 * 60 * 60
  : 180 * 24 * 60 * 60;

const whatsappAuditSchema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  message: { type: String, required: true },
  messageHash: { type: String, index: true },
  generatedLinks: { type: Number, default: 0 },
  skipped: { type: Number, default: 0 },
  context: { type: Object },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

whatsappAuditSchema.index({ createdAt: -1 });
whatsappAuditSchema.index({ createdAt: 1 }, { expireAfterSeconds: WHATSAPP_AUDIT_RETENTION_SECONDS });

const WhatsAppAudit = mongoose.model('WhatsAppAudit', whatsappAuditSchema);
export default WhatsAppAudit;
