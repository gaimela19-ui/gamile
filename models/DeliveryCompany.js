import mongoose from 'mongoose';

const fieldMappingSchema = new mongoose.Schema({
  sourceField: { type: String, required: true },
  targetField: { type: String, required: true },
  required: { type: Boolean, default: false },
  transform: { type: String },
  enabled: { type: Boolean, default: true },
  defaultValue: { type: mongoose.Schema.Types.Mixed },
  defaultValuePriority: { type: Boolean, default: false },
}, { _id: false });

const statusMappingSchema = new mongoose.Schema({
  companyStatus: { type: String, required: true },
  internalStatus: { type: String, required: true },
}, { _id: false });

const apiConfigurationSchema = new mongoose.Schema({
  baseUrl: { type: String, default: '' },
  authMethod: { type: String, enum: ['none', 'apiKey', 'basic', 'bearer'], default: 'none' },
  apiKey: { type: String },
  headers: { type: Map, of: String, default: {} },
  username: { type: String },
  password: { type: String },
  method: { type: String },
  statusUrl: { type: String },
  // Extra static params to merge into request payload/body
  params: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Query parameters to append to the URL
  queryParams: { type: mongoose.Schema.Types.Mixed, default: {} },
  // List of required params that must exist in params or queryParams
  requiredParams: { type: [String], default: [] },
  // Enable simulated mode without calling external API
  isTestMode: { type: Boolean, default: false },
  // Custom timeout for outbound requests (ms)
  timeoutMs: { type: Number, default: 15000 },
  format: { type: String, enum: ['rest', 'jsonrpc', 'soap', 'graphql'], default: 'rest' },
  // Some providers expect credentials inside params; enable per-company
  credentialsInParams: { type: Boolean, default: false },
  // Some JSON-RPC providers omit method; enable per-company
  jsonrpcOmitMethod: { type: Boolean, default: false },
}, { _id: false });

const deliveryCompanySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
  // Mark a default company to use when no explicit selection is provided
  isDefault: { type: Boolean, default: false },
  // Auto-dispatch configuration: if enabled, newly created orders whose status is in autoDispatchStatuses
  // will automatically be sent to this delivery company during order creation (server-side) without
  // requiring a manual admin action from the Delivery Management Hub UI.
  autoDispatchOnOrderCreate: { type: Boolean, default: false },
  // List of order.status values that should trigger auto dispatch when above flag is true.
  autoDispatchStatuses: { type: [String], default: ['pending'] },
  // Common UI-driven fields
  apiUrl: { type: String },
  apiFormat: { type: String, enum: ['rest', 'jsonrpc', 'soap', 'graphql'], default: 'rest' },
  credentials: { type: mongoose.Schema.Types.Mixed, default: {} },
  settings: { type: mongoose.Schema.Types.Mixed, default: {} },
  statistics: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Mapping object (singular) sometimes used by UI
  fieldMapping: { type: mongoose.Schema.Types.Mixed, default: {} },
  apiConfiguration: { type: apiConfigurationSchema, default: () => ({}) },
  fieldMappings: { type: [fieldMappingSchema], default: [] },
  statusMapping: { type: [statusMappingSchema], default: [] },
  customFields: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

deliveryCompanySchema.index({ name: 1 }, { unique: true });
// Optional code index for lookups
deliveryCompanySchema.index({ code: 1 }, { sparse: true });

export default mongoose.model('DeliveryCompany', deliveryCompanySchema);
