import DeliveryCompany from '../models/DeliveryCompany.js';
import DeliveryIntegrationEndpoint from '../models/DeliveryIntegrationEndpoint.js';
import { executeDeliveryEndpoint, makeOrderVariables, renderTemplate } from './deliveryApiEngine.js';
import { sanitizeDeliverySecrets } from '../utils/sanitizeDeliverySecrets.js';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const INTERNAL_STATUSES = new Set([
  'CREATED', 'PENDING', 'PICKUP_REQUESTED', 'PICKED_UP', 'IN_TRANSIT',
  'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED', 'FAILED', 'UNKNOWN',
  'ASSIGNED', 'DELIVERY_FAILED',
]);
export const DELIVERY_INTERNAL_STATUSES = [...INTERNAL_STATUSES];
export const DELIVERY_TEMPLATE_VARIABLES = [
  'order.sequence',
  'order.customer_name',
  'order.customer_mobile',
  'order.customer_address',
  'order.customer_area',
  'order.customer_area_id',
  'order.money_collection_cost',
  'order.shipping_cost',
  'order.note',
  'order.product_note',
  'order.items',
  'auth.phone',
  'auth.username',
  'auth.password',
];

function plain(value) {
  if (value?.toObject) return value.toObject({ flattenMaps: true, virtuals: true });
  if (value instanceof Map) return Object.fromEntries(value);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function entries(value) {
  if (value instanceof Map) return Array.from(value.values()).map(plain);
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.values(value).map(plain);
  return [];
}

function hasValue(value) {
  if (value == null || value === '') return false;
  if (Array.isArray(value)) return value.some(hasValue);
  if (value instanceof Map) return Array.from(value.values()).some(hasValue);
  if (typeof value === 'object') return Object.values(value).some(hasValue);
  return true;
}

function configuredAuth(integration, endpoint) {
  const apiConfiguration = integration.apiConfiguration || {};
  const settings = apiConfiguration.integration || {};
  const authentication = endpoint.authentication || settings.authentication || {};
  let type = authentication.type || 'legacy';
  if (type === 'legacy') type = apiConfiguration.authMethod || 'none';
  const credentials = authentication.credentials || {};
  const storedCredentials = integration.credentials || {};

  if (type === 'apiKey') {
    const key = credentials.apiKey || credentials.key || apiConfiguration.apiKey || storedCredentials.apiKey;
    return key ? null : 'API key authentication requires a configured key';
  }
  if (type === 'bearer') {
    const token = credentials.token || credentials.accessToken || apiConfiguration.bearer || apiConfiguration.apiKey ||
      storedCredentials.token || storedCredentials.apiKey;
    return token ? null : 'Bearer authentication requires a configured token';
  }
  if (type === 'basic') {
    const username = credentials.username || credentials.login || apiConfiguration.username || storedCredentials.username || storedCredentials.login;
    const password = credentials.password || apiConfiguration.password || storedCredentials.password;
    return username && password ? null : 'Basic authentication requires a username and password';
  }
  if (type === 'oauth2') {
    if (!authentication.tokenUrl || !validateEndpointUrl(authentication.tokenUrl)) return 'Login token URL must be a valid HTTP or HTTPS URL';
    if (!hasValue(authentication.tokenRequest)) return 'Login request body/template is required';
    try { renderTemplate(authentication.tokenRequest, makeOrderVariables({}, {}, credentials)); }
    catch (error) { return `Login request template is invalid: ${error.message}`; }
    if (!authentication.tokenResponsePath) return 'Token response path is required';
    const hasCredentials = hasValue(credentials);
    return hasCredentials ? null : 'Token authentication requires protected login credentials';
  }
  if (type === 'custom') {
    const headers = plain(authentication.headers);
    const hasNamedCredential = authentication.name && (credentials.value || credentials.token || credentials.apiKey);
    return Object.keys(headers).length || hasNamedCredential ? null : 'Custom authentication requires at least one configured header';
  }
  if (type === 'none') return null;
  return `Unsupported authentication type: ${type}`;
}

function validateEndpointUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validateDeliveryIntegrationConfiguration(integrationValue, endpointValues = []) {
  const integration = plain(integrationValue);
  const apiConfiguration = integration.apiConfiguration || {};
  const settings = apiConfiguration.integration || {};
  const baseUrl = integration.apiUrl || apiConfiguration.baseUrl || '';
  const endpoints = [...entries(settings.endpoints), ...entries(endpointValues)];
  const activeEndpoints = endpoints.filter(endpoint => endpoint.isActive !== false);
  const errors = [];

  if (!baseUrl && !activeEndpoints.some(endpoint => /^https?:\/\//i.test(endpoint.url || ''))) {
    errors.push('A base URL or absolute endpoint URL is required');
  } else if (baseUrl && !validateEndpointUrl(baseUrl)) {
    errors.push('Base URL must be a valid HTTP or HTTPS URL without embedded credentials');
  }
  if (!activeEndpoints.length) errors.push('At least one active endpoint is required');

  for (const endpoint of activeEndpoints) {
    const endpointName = endpoint.name || endpoint.operation || endpoint.code || 'unnamed endpoint';
    const prefix = `Endpoint ${endpointName}: `;
    const method = String(endpoint.method || '').toUpperCase();
    if (!HTTP_METHODS.has(method)) errors.push(`${prefix}unsupported HTTP method`);
    if (!endpoint.path && !endpoint.url) errors.push(`${prefix}path or URL is required`);
    if (endpoint.url && /^https?:\/\//i.test(endpoint.url) && !validateEndpointUrl(endpoint.url)) {
      errors.push(`${prefix}URL must be HTTP or HTTPS without embedded credentials`);
    }
    if (endpoint.timeoutMs != null && (!Number.isFinite(Number(endpoint.timeoutMs)) || Number(endpoint.timeoutMs) < 1)) {
      errors.push(`${prefix}timeout must be a positive number`);
    }
    if (endpoint.requiresRequestBody) {
      const body = hasValue(endpoint.requestBody)
        ? endpoint.requestBody
        : (hasValue(endpoint.requestMapping) ? endpoint.requestMapping : settings.requestMapping);
      if (!hasValue(body)) errors.push(`${prefix}request body/template is required`);
      else {
        try { renderTemplate(body, makeOrderVariables({})); }
        catch (error) { errors.push(`${prefix}request template is invalid: ${error.message}`); }
      }
    }
    const responseMapping = hasValue(endpoint.responseMapping) ? endpoint.responseMapping : settings.responseMapping;
    if (endpoint.requiresResponseMapping && !hasValue(responseMapping)) {
      errors.push(`${prefix}response mapping is required`);
    }
    const authError = configuredAuth(integration, endpoint);
    if (authError) errors.push(`${prefix}${authError}`);
    for (const row of [...(integration.statusMapping || []), ...(endpoint.statusMapping || [])]) {
      if (!INTERNAL_STATUSES.has(String(row.internalStatus || '').trim().toUpperCase())) {
        errors.push(`${prefix}status mapping has an unsupported internal status`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

async function resolveTestIntegration(value) {
  if (value && typeof value === 'object' && (value.apiUrl !== undefined || value.apiConfiguration !== undefined)) return plain(value);
  const integration = await DeliveryCompany.findById(value).lean();
  return integration || null;
}

async function resolveTestEndpoint(integration, value) {
  if (value && typeof value === 'object') return plain(value);
  const nested = plain(integration?.apiConfiguration?.integration?.endpoints);
  if (nested[value]) return { ...plain(nested[value]), name: nested[value].name || value };
  if (integration?._id) {
    const query = { integration: integration._id };
    if (/^[a-f\d]{24}$/i.test(String(value || ''))) query._id = value;
    else query.name = value;
    const stored = await DeliveryIntegrationEndpoint.findOne(query).lean();
    if (stored) return stored;
  }
  return null;
}

export async function testConfiguredDeliveryEndpoint({
  integration: integrationValue,
  endpoint: endpointValue,
  sampleData = {},
  execute = false,
  extra = {},
} = {}, options = {}) {
  const integration = await resolveTestIntegration(integrationValue);
  if (!integration) {
    return { success: false, executed: false, error: { message: 'Delivery integration not found' } };
  }
  const endpoint = await resolveTestEndpoint(integration, endpointValue);
  if (!endpoint) {
    return { success: false, executed: false, error: { message: 'Delivery endpoint not found' } };
  }
  if (execute && endpoint.safeForTesting !== true) {
    return {
      success: false,
      executed: false,
      error: { message: 'Endpoint is not explicitly marked safe for test execution' },
    };
  }

  const result = await executeDeliveryEndpoint({
    integration,
    endpoint,
    order: sampleData.order || sampleData,
    extra,
  }, {
    ...options,
    dryRun: !execute,
    includeRequest: true,
  });
  return sanitizeDeliverySecrets({
    success: result.success,
    executed: execute && result.requestDispatched === true,
    request: result.request || null,
    response: execute ? result.rawResponse : null,
    result: execute ? {
      shipmentId: result.shipmentId,
      externalId: result.externalId,
      trackingNumber: result.trackingNumber,
      status: result.status,
      shippingCost: result.shippingCost,
      codAmount: result.codAmount,
      labelUrl: result.labelUrl,
    } : null,
    error: result.error || null,
  });
}