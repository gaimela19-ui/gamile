import mongoose from 'mongoose';

const deliveryShipmentSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    index: true,
  },
  integration: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryCompany',
    required: true,
    index: true,
  },
  externalShipmentId: { type: String, trim: true },
  trackingNumber: { type: String, trim: true },
  externalStatus: { type: String, trim: true },
  normalizedStatus: {
    type: String,
    enum: ['assigned', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'returned', 'cancelled'],
    default: 'assigned',
  },
  shippingCost: { type: Number, min: 0, default: 0 },
  codAmount: { type: Number, min: 0, default: 0 },
  rawResponse: { type: mongoose.Schema.Types.Mixed, default: null },
  referenceData: { type: mongoose.Schema.Types.Mixed, default: {} },
  externalCreatedAt: { type: Date },
  deliveredAt: { type: Date },
}, { timestamps: true });

deliveryShipmentSchema.index({ integration: 1, externalShipmentId: 1 }, { sparse: true });
deliveryShipmentSchema.index({ order: 1, integration: 1, createdAt: -1 });

export default mongoose.model('DeliveryShipment', deliveryShipmentSchema);