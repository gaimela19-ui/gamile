import mongoose from 'mongoose';

const pushSubscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true }
  },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

pushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });

const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);

export default PushSubscription;
