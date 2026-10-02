import mongoose from 'mongoose';

const retryConfigurationSchema = new mongoose.Schema({
  attempts: { type: Number, min: 0, default: 0 },
  delayMs: { type: Number, min: 0, default: 1000 },
  backoffMultiplier: { type: Number, min: 1, default: 2 },
  maxDelayMs: { type: Number, min: 0, default: 30000 },
  retryUnsafe: { type: Boolean, default: false },
  retryOnStatuses: { type: [Number], default: [408, 429, 500, 502, 503, 504] },
}, { _id: false });

const deliveryIntegrationEndpointSchema = new mongoose.Schema({
  integration: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryCompany',
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true },
  operation: { type: String, trim: true },
  code: { type: String, trim: true },
  method: { type: String, required: true, uppercase: true, default: 'POST' },
  path: { type: String, default: '' },
  url: { type: String, default: '' },
  headers: { type: Map, of: String, default: {} },
  queryParameters: { type: mongoose.Schema.Types.Mixed, default: {} },
  pathParameters: { type: mongoose.Schema.Types.Mixed, default: {} },
  authentication: { type: mongoose.Schema.Types.Mixed, default: null },
  requestContentType: { type: String, default: 'application/json' },
  requestBody: { type: mongoose.Schema.Types.Mixed, default: {} },
  requiresRequestBody: { type: Boolean, default: false },
  requiresResponseMapping: { type: Boolean, default: false },
  safeForTesting: { type: Boolean, default: false },
  timeoutMs: { type: Number, min: 1, default: 15000 },
  retry: { type: retryConfigurationSchema, default: () => ({}) },
  responseMapping: { type: mongoose.Schema.Types.Mixed, default: {} },
  statusMapping: [{ companyStatus: String, internalStatus: String }],
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

deliveryIntegrationEndpointSchema.path('url').validate(function validateEndpointUrl(value) {
  return Boolean(value || this.path);
}, 'An endpoint path or URL is required');

deliveryIntegrationEndpointSchema.index({ integration: 1, name: 1 }, { unique: true });

export default mongoose.model('DeliveryIntegrationEndpoint', deliveryIntegrationEndpointSchema);