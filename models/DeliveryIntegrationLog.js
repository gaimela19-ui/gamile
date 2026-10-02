import mongoose from 'mongoose';

const deliveryIntegrationLogSchema = new mongoose.Schema({
  integration: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryCompany',
    required: true,
    index: true,
  },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  shipment: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryShipment', default: null },
  endpoint: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryIntegrationEndpoint', default: null },
  requestMetadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  responseStatus: { type: Number },
  responseData: { type: mongoose.Schema.Types.Mixed, default: null },
  error: { type: mongoose.Schema.Types.Mixed, default: null },
  timestamp: { type: Date, default: Date.now, index: true },
  requestId: { type: String, trim: true },
  responseId: { type: String, trim: true },
}, { timestamps: true });

deliveryIntegrationLogSchema.index({ integration: 1, timestamp: -1 });
deliveryIntegrationLogSchema.index({ order: 1, timestamp: -1 });

export default mongoose.model('DeliveryIntegrationLog', deliveryIntegrationLogSchema);