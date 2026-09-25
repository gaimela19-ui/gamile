import mongoose from 'mongoose';

const mobilePushTokenSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  expoPushToken: { type: String, required: true, unique: true },
  device: {
    manufacturer: String,
    modelName: String,
    osName: String,
    osVersion: String,
    appVersion: String
  },
  lastSeenAt: { type: Date, default: Date.now }
}, { timestamps: true });

mobilePushTokenSchema.index({ expoPushToken: 1 }, { unique: true });
mobilePushTokenSchema.index({ user: 1, updatedAt: -1 });

const MobilePushToken = mongoose.model('MobilePushToken', mobilePushTokenSchema);

export default MobilePushToken;
