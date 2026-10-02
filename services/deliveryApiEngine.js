import axios from 'axios';
import { createHash } from 'node:crypto';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { setTimeout as wait } from 'node:timers/promises';
import DeliveryCompany from '../models/DeliveryCompany.js';
import DeliveryIntegrationEndpoint from '../models/DeliveryIntegrationEndpoint.js';
import DeliveryIntegrationLog from '../models/DeliveryIntegrationLog.js';
import { sanitizeDeliverySecrets } from '../utils/sanitizeDeliverySecrets.js';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SAFE_RETRY_METHODS = new Set(['GET', 'PUT', 'DELETE']);
const NORMALIZED_STATUSES = new Set([
  'CREATED', 'PENDING', 'PICKUP_REQUESTED', 'PICKED_UP', 'IN_TRANSIT',
  'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED', 'FAILED', 'UNKNOWN',
]);
const LEGACY_STATUS_ALIASES = {
  ASSIGNED: 'CREATED',
  DELIVERY_FAILED: 'FAILED',
};
const ALLOWED_TEMPLATE_VARIABLES = new Set([
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
]);
const ALLOWED_TRANSFORMS = new Set(['upper', 'lower', 'trim', 'digits', 'string', 'number', 'json']);
const SENSITIVE_KEY = /(credential|password|secret|token|api[-_]?key|authorization|bearer|username|login|signature)/i;

function toPlain(value) {
  if (value?.toObject) return value.toObject({ flattenMaps: true, virtuals: true });
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
}

function getPath(value, path) {
  const parts = String(path || '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  if (parts.some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) return undefined;
  return parts.reduce((current, part) => current == null ? undefined : current[part], value);
}

function hasConfiguredValue(value) {
  if (value == null || value === '') return false;
  if (value instanceof Map) return value.size > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function findCityMapping(cityMappings, address) {
  const normalize = value => String(value ?? '').trim().toLowerCase();
  const rows = Array.isArray(cityMappings) ? cityMappings.map(toPlain) : [];
  for (const candidate of [address.area, address.city, address.state].map(normalize).filter(Boolean)) {
    const row = rows.find(item => normalize(item?.storeCity) === candidate);
    if (row) return row;
  }
  return undefined;
}

function makeOrderVariables(orderValue, extra = {}, authCredentials = {}, cityMappings) {
  const order = toPlain(orderValue) || {};
  const customer = order.customerInfo || {};
  const address = order.shippingAddress || {};
  const items = Array.isArray(order.items) ? order.items.map(toPlain) : [];
  const shippingCost = extra.shippingCost ?? extra.deliveryFee ?? order.shippingFee ?? order.deliveryFee ?? 0;
  const moneyCollectionCost = extra.codAmount ?? order.codAmount ?? order.totalWithShipping ??
    ((Number(order.totalAmount) || 0) + (Number(shippingCost) || 0));
  const addressParts = [address.street, address.building, address.apartment, address.city, address.state, address.zipCode, address.country]
    .filter(value => value != null && String(value).trim());
  const productNote = order.productNote || items.map(item => item.note || item.name).filter(Boolean).join(', ');

  return {
    order: {
      sequence: order.sequence || order.orderNumber || String(order._id || ''),
      customer_name: [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim(),
      customer_mobile: customer.mobile || customer.phone || '',
      customer_address: addressParts.join(', '),
      customer_area: address.area || address.city || address.state || '',
      // Without mappings (template validation) use a placeholder so the template can be saved.
      customer_area_id: cityMappings === undefined ? 0 : findCityMapping(cityMappings, address)?.companyCityId,
      money_collection_cost: moneyCollectionCost,
      shipping_cost: shippingCost,
      note: order.deliveryNotes || order.note || order.notes || '',
      product_note: productNote,
      items,
    },
    auth: {
      phone: authCredentials.phone || authCredentials.username || authCredentials.login || '',
      username: authCredentials.username || authCredentials.login || authCredentials.phone || '',
      password: authCredentials.password || '',
    },
  };
}

function applyTransform(value, transform) {
  if (!transform) return value;
  if (!ALLOWED_TRANSFORMS.has(transform)) throw new Error(`Unsupported template transform: ${transform}`);
  if (transform === 'json') return JSON.stringify(value ?? null);
  if (transform === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : '';
  }
  if (transform === 'string') return value == null ? '' : String(value);
  const stringValue = value == null ? '' : String(value);
  if (transform === 'upper') return stringValue.toUpperCase();
  if (transform === 'lower') return stringValue.toLowerCase();
  if (transform === 'trim') return stringValue.trim();
  return stringValue.replace(/\D+/g, '');
}

function resolveTemplateExpression(expression, variables) {
  const [variablePath, transform, ...extraParts] = expression.split('|').map(part => part.trim());
  if (extraParts.length) throw new Error('Template expressions support one safe transform at most');
  if (!ALLOWED_TEMPLATE_VARIABLES.has(variablePath)) throw new Error(`Unsupported template variable: ${variablePath}`);
  const value = getPath(variables, variablePath);
  if (transform === 'optional' && (value === undefined || value === null || value === '')) return undefined;
  if (value === undefined && variablePath === 'order.customer_area_id') {
    throw new Error(`No delivery company city is mapped for "${variables.order?.customer_area || 'unknown city'}"`);
  }
  if (value === undefined) throw new Error(`Template variable is unavailable: ${variablePath}`);
  if (transform === 'optional') return value;
  return applyTransform(value, transform);
}

function renderStringTemplate(template, variables) {
  const exact = template.match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/);
  if (exact) return resolveTemplateExpression(exact[1], variables);
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, expression) => {
    const value = resolveTemplateExpression(expression, variables);
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

function renderTemplate(value, variables) {
  if (typeof value === 'string') return renderStringTemplate(value, variables);
  if (Array.isArray(value)) return value.map(item => renderTemplate(item, variables)).filter(item => item !== undefined);
  if (value instanceof Map) return renderTemplate(Object.fromEntries(value), variables);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([key, child]) => [key, renderTemplate(child, variables)])
      .filter(([, child]) => child !== undefined));
  }
  return value;
}

function normalizeStatus(externalStatus, integration, endpointStatusMapping = []) {
  if (externalStatus == null || String(externalStatus).trim() === '') return 'UNKNOWN';
  const mappings = Array.isArray(endpointStatusMapping) && endpointStatusMapping.length
    ? endpointStatusMapping
    : (Array.isArray(integration.statusMapping) ? integration.statusMapping : []);
  const match = mappings.find(row => String(row.companyStatus).trim().toLowerCase() === String(externalStatus).trim().toLowerCase());
  const candidate = String(match?.internalStatus || externalStatus)
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
  const normalized = LEGACY_STATUS_ALIASES[candidate] || candidate;
  return NORMALIZED_STATUSES.has(normalized) ? normalized : 'UNKNOWN';
}

export { makeOrderVariables, normalizeStatus, renderTemplate };

function isPrivateAddress(address) {
  const normalized = String(address).toLowerCase().split('%')[0];
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    if (mapped.includes('.')) return isPrivateAddress(mapped);
    const halves = mapped.split(':');
    if (halves.length === 2) {
      const high = Number.parseInt(halves[0], 16);
      const low = Number.parseInt(halves[1], 16);
      if (Number.isFinite(high) && Number.isFinite(low)) {
        return isPrivateAddress([
          high >> 8,
          high & 255,
          low >> 8,
          low & 255,
        ].join('.'));
      }
    }
  }

  if (isIP(normalized) === 4) {
    const octets = normalized.split('.').map(Number);
    const [first, second] = octets;
    return first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 168 || (second === 0 && octets[2] === 0) || (second === 0 && octets[2] === 2))) ||
      (first === 198 && (second === 18 || second === 19 || (second === 51 && octets[2] === 100))) ||
      (first === 203 && second === 0 && octets[2] === 113);
  }

  if (isIP(normalized) === 6) {
    return normalized === '::' || normalized === '::1' ||
      normalized.startsWith('fc') || normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) || normalized.startsWith('ff') || normalized.startsWith('2001:db8:');
  }
  return true;
}

function createPinnedLookup(addresses) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    const family = options?.family || 0;
    const candidates = addresses.filter(item => !family || item.family === family);
    if (!candidates.length) return callback(new Error('No validated address matches the requested family'));
    if (options?.all) return callback(null, candidates);
    return callback(null, candidates[0].address, candidates[0].family);
  };
}

async function validateAndPinUrl(value, allowPrivateNetwork) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Endpoint URL is invalid');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS endpoints are allowed');
  if (url.username || url.password) throw new Error('Credentials in endpoint URLs are not allowed');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    if (!allowPrivateNetwork) throw new Error('Endpoint host is not allowed');
  }
  if (allowPrivateNetwork) return { url, httpAgent: undefined, httpsAgent: undefined };

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(address => isPrivateAddress(address.address))) {
    throw new Error('Endpoint resolves to a private or reserved network address');
  }
  const lookup = createPinnedLookup(addresses);
  return {
    url,
    httpAgent: new http.Agent({ lookup, keepAlive: false }),
    httpsAgent: new https.Agent({ lookup, keepAlive: false }),
  };
}

function resolvePathParameters(path, pathParameters, variables) {
  const renderedParameters = renderTemplate(pathParameters || {}, variables);
  return String(path || '').replace(/\{([A-Za-z0-9_]+)\}|:([A-Za-z0-9_]+)/g, (_match, braceName, colonName) => {
    const name = braceName || colonName;
    const value = renderedParameters[name];
    if (value === undefined || value === null) throw new Error(`Missing endpoint path parameter: ${name}`);
    return encodeURIComponent(String(value));
  });
}

function endpointUrl(integration, endpoint, variables) {
  const baseUrl = integration.apiUrl || integration.apiConfiguration?.baseUrl || '';
  const configuredUrl = endpoint.url || '';
  if (/^https?:\/\//i.test(configuredUrl)) return configuredUrl;
  const path = resolvePathParameters(endpoint.path || configuredUrl, endpoint.pathParameters, variables);
  if (!baseUrl && !path) throw new Error('Integration base URL and endpoint path are required');
  if (!baseUrl) return path;
  if (!path) return baseUrl;
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function appendQueryParameters(url, parameters) {
  for (const [key, value] of Object.entries(parameters || {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else if (typeof value === 'object') {
      url.searchParams.set(key, JSON.stringify(value));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return url.toString();
  } catch {
    return '[invalid-url]';
  }
}

function collectSecrets(value, insideCredentials = false, output = new Set()) {
  if (value == null) return output;
  if (typeof value === 'string' || typeof value === 'number') {
    if (insideCredentials && String(value).length >= 3) output.add(String(value));
    return output;
  }
  if (value instanceof Map) value = Object.fromEntries(value);
  if (Array.isArray(value)) {
    for (const item of value) collectSecrets(item, insideCredentials, output);
    return output;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const sensitive = insideCredentials || key.toLowerCase() === 'headers' || SENSITIVE_KEY.test(key);
      if (sensitive && typeof child === 'string' && child.length >= 3) output.add(child);
      else collectSecrets(child, sensitive, output);
    }
  }
  return output;
}

function redactText(value, secrets) {
  let message = String(value || 'Request failed');
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('[REDACTED]');
  }
  return message.replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [REDACTED]');
}

function sanitizeAndRedact(value, secrets) {
  const safe = sanitizeDeliverySecrets(value);
  if (typeof safe === 'string') return redactText(safe, secrets);
  if (Array.isArray(safe)) return safe.map(item => sanitizeAndRedact(item, secrets));
  if (safe && typeof safe === 'object' && !safe._bsontype && !(safe instanceof Date)) {
    return Object.fromEntries(Object.entries(safe).map(([key, child]) => [key, sanitizeAndRedact(child, secrets)]));
  }
  return safe;
}

const accessTokenCache = new Map();

function resolveTokenUrl(integration, authConfiguration) {
  const tokenUrl = String(authConfiguration.tokenUrl || '').trim();
  if (!tokenUrl) throw new Error('Token authentication requires a login URL');
  try {
    return new URL(tokenUrl).toString();
  } catch {
    const baseUrl = integration.apiUrl || integration.apiConfiguration?.baseUrl;
    if (!baseUrl) throw new Error('Token authentication requires a valid login URL');
    return new URL(tokenUrl.replace(/^\/+/, ''), `${String(baseUrl).replace(/\/+$/, '')}/`).toString();
  }
}

function accessTokenCacheKey(integration, authConfiguration, tokenUrl) {
  const credentials = authConfiguration.credentials || {};
  const cacheIdentity = JSON.stringify({
    integration: String(integration._id || integration.id || integration.code || integration.name || ''),
    tokenUrl,
    credentials,
    tokenRequest: authConfiguration.tokenRequest,
  });
  return createHash('sha256').update(cacheIdentity).digest('hex');
}

async function acquireAccessToken(integration, authConfiguration, variables, options) {
  const tokenUrl = resolveTokenUrl(integration, authConfiguration);
  const cacheKey = accessTokenCacheKey(integration, authConfiguration, tokenUrl);
  const cached = accessTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const tokenRequest = authConfiguration.tokenRequest;
  if (!hasConfiguredValue(tokenRequest)) throw new Error('Token authentication requires a login request body');
  const preparedUrl = await validateAndPinUrl(tokenUrl, options.allowPrivateNetwork === true);
  const tokenBody = renderTemplate(tokenRequest, variables);
  const tokenHeaders = renderTemplate(authConfiguration.headers || {}, variables);
  const hasContentType = Object.keys(tokenHeaders).some(key => key.toLowerCase() === 'content-type');
  if (!hasContentType) tokenHeaders['Content-Type'] = 'application/json';

  let tokenResponse;
  try {
    tokenResponse = await axios.request({
      method: String(authConfiguration.tokenMethod || 'POST').toUpperCase(),
      url: preparedUrl.url.toString(),
      data: tokenBody,
      headers: tokenHeaders,
      timeout: Number(authConfiguration.timeoutMs || integration.apiConfiguration?.timeoutMs) || 10000,
      maxRedirects: 0,
      proxy: false,
      httpAgent: preparedUrl.httpAgent,
      httpsAgent: preparedUrl.httpsAgent,
      validateStatus: status => status >= 200 && status < 300,
    });
  } catch (error) {
    const status = error.response?.status;
    const detail = status ? `HTTP ${status}` : (error.code || 'no response');
    const loginTarget = `${authConfiguration.tokenMethod || 'POST'} ${preparedUrl.url.origin}${preparedUrl.url.pathname}`;
    console.error('[delivery/auth] login request failed:', detail, loginTarget);
    throw new Error(`Authentication request failed (${detail}); see server log for the login URL`);
  }

  const tokenPath = authConfiguration.tokenResponsePath || 'token';
  const token = getPath(tokenResponse.data, tokenPath);
  if (typeof token !== 'string' || !token.trim()) throw new Error('Authentication response did not contain the configured token');

  const configuredTtl = Number(authConfiguration.tokenCacheSeconds) || 300;
  const responseTtl = authConfiguration.tokenExpiresInPath
    ? Number(getPath(tokenResponse.data, authConfiguration.tokenExpiresInPath))
    : NaN;
  const ttlSeconds = Number.isFinite(responseTtl) && responseTtl > 0 ? responseTtl : configuredTtl;
  const safeTtl = Math.max(1, Math.min(ttlSeconds, 86400));
  accessTokenCache.set(cacheKey, { token, expiresAt: Date.now() + safeTtl * 1000 });
  return token;
}

async function applyAuthentication(integration, endpointAuthentication, headers, queryParameters, variables, options = {}) {
  const apiConfiguration = integration.apiConfiguration || {};
  const configuredAuthentication = integration.apiConfiguration?.integration?.authentication || {};
  const authConfiguration = endpointAuthentication && endpointAuthentication.type !== 'inherit'
    ? endpointAuthentication
    : configuredAuthentication;
  let type = authConfiguration.type || 'legacy';
  if (type === 'legacy') type = apiConfiguration.authMethod || 'none';
  const credentials = authConfiguration.credentials || {};
  let basicAuth;

  if (type === 'apiKey') {
    const key = credentials.apiKey || credentials.key || apiConfiguration.apiKey || integration.credentials?.apiKey;
    const name = authConfiguration.name || integration.credentials?.apiKeyHeader || 'x-api-key';
    if (!key) throw new Error('API key authentication is configured without a key');
    if (authConfiguration.placement === 'query') queryParameters[name] = key;
    else headers[name] = String(key);
  } else if (type === 'bearer') {
    const token = credentials.token || credentials.accessToken || apiConfiguration.bearer || apiConfiguration.apiKey ||
      integration.credentials?.token || integration.credentials?.apiKey;
    if (!token) throw new Error('Bearer authentication is configured without a token');
    headers.Authorization = `Bearer ${token}`;
  } else if (type === 'basic') {
    const username = credentials.username || credentials.login || apiConfiguration.username || integration.credentials?.username || integration.credentials?.login;
    const password = credentials.password || apiConfiguration.password || integration.credentials?.password;
    if (!username || !password) throw new Error('Basic authentication requires a username and password');
    basicAuth = { username, password };
  } else if (type === 'oauth2') {
    const scheme = authConfiguration.scheme || 'Bearer';
    if (options.dryRun === true) {
      headers.Authorization = `${scheme} [REDACTED]`;
    } else {
      const token = await acquireAccessToken(integration, authConfiguration, variables, options);
      headers.Authorization = `${scheme} ${token}`;
    }
  } else if (type === 'custom') {
    Object.assign(headers, renderTemplate(authConfiguration.headers || {}, variables));
    const name = authConfiguration.name;
    const value = credentials.value || credentials.token || credentials.apiKey;
    if (name && value) headers[name] = authConfiguration.scheme ? `${authConfiguration.scheme} ${value}` : String(value);
  } else if (type !== 'none') {
    throw new Error(`Unsupported authentication type: ${type}`);
  }
  return basicAuth;
}

function getMappedValue(response, mapping, key, fallbackPaths) {
  const configured = mapping?.[key];
  const paths = Array.isArray(configured) ? configured : configured ? [configured] : fallbackPaths;
  for (const path of paths || []) {
    if (typeof path !== 'string') continue;
    const value = getPath(response, path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function mapResponse(response, endpoint, integration) {
  const endpointMapping = endpoint.responseMapping;
  const mapping = hasConfiguredValue(endpointMapping)
    ? endpointMapping
    : (integration.apiConfiguration?.integration?.responseMapping || {});
  const shipmentId = getMappedValue(response, mapping, 'shipmentId', ['shipmentId', 'shipment_id', 'id']);
  const externalId = getMappedValue(response, mapping, 'externalId', ['externalId', 'external_id', 'shipmentId', 'shipment_id', 'id']) ?? shipmentId;
  const trackingNumber = getMappedValue(response, mapping, 'trackingNumber', ['trackingNumber', 'tracking_number', 'trackingId', 'tracking_id']);
  const externalStatus = getMappedValue(response, mapping, 'status', ['status', 'state']);
  const shippingCost = getMappedValue(response, mapping, 'shippingCost', ['shippingCost', 'shipping_cost']);
  const codAmount = getMappedValue(response, mapping, 'codAmount', ['codAmount', 'cod_amount']);
  const labelUrl = getMappedValue(response, mapping, 'labelUrl', ['labelUrl', 'label_url']);
  const requestId = getMappedValue(response, mapping, 'requestId', ['requestId', 'request_id']);

  return {
    shipmentId: shipmentId == null ? null : String(shipmentId),
    externalId: externalId == null ? null : String(externalId),
    trackingNumber: trackingNumber == null ? null : String(trackingNumber),
    externalStatus: externalStatus == null ? null : String(externalStatus),
    status: normalizeStatus(externalStatus, integration, endpoint.statusMapping),
    shippingCost: Number.isFinite(Number(shippingCost)) ? Number(shippingCost) : null,
    codAmount: Number.isFinite(Number(codAmount)) ? Number(codAmount) : null,
    labelUrl: labelUrl == null ? null : String(labelUrl),
    requestId: requestId == null ? null : String(requestId),
  };
}

function responseRequestId(response) {
  const headers = response?.headers;
  return headers?.['x-request-id'] || headers?.['x-correlation-id'] || headers?.['request-id'] || null;
}

async function resolveIntegration(value) {
  if (value && typeof value === 'object' && (value.apiUrl !== undefined || value.apiConfiguration !== undefined)) return toPlain(value);
  const integration = await DeliveryCompany.findById(value).lean();
  if (!integration) throw new Error('Delivery integration not found');
  return integration;
}

async function resolveEndpoint(value, integration) {
  if (value && typeof value === 'object' && (value.name || value.path || value.url)) return toPlain(value);
  const configuredEndpoints = integration.apiConfiguration?.integration?.endpoints;
  const endpointMap = configuredEndpoints instanceof Map ? configuredEndpoints : configuredEndpoints || {};
  const nestedEndpoint = endpointMap[value];
  if (nestedEndpoint) return { ...toPlain(nestedEndpoint), name: nestedEndpoint.name || value };
  if (integration._id) {
    const query = { integration: integration._id };
    if (String(value || '').match(/^[a-f\d]{24}$/i)) query._id = value;
    else query.name = value;
    const endpoint = await DeliveryIntegrationEndpoint.findOne(query).lean();
    if (endpoint) return endpoint;
  }
  throw new Error('Delivery endpoint not found');
}

function standardResult(success, mapped = {}, rawResponse = null, error = null, secrets = new Set()) {
  return {
    success,
    shipmentId: mapped.shipmentId ?? null,
    externalId: mapped.externalId ?? null,
    trackingNumber: mapped.trackingNumber ?? null,
    externalStatus: mapped.externalStatus ?? null,
    status: mapped.status || 'UNKNOWN',
    shippingCost: mapped.shippingCost ?? null,
    codAmount: mapped.codAmount ?? null,
    labelUrl: mapped.labelUrl ?? null,
    rawResponse: sanitizeAndRedact(rawResponse, secrets),
    ...(error ? { error } : {}),
  };
}

async function writeIntegrationLog(LogModel, integration, endpoint, args, requestMetadata, response, error, requestId, secrets) {
  if (!LogModel) return;
  try {
    const integrationId = integration._id || integration.id;
    if (!integrationId) return;
    await LogModel.create({
      integration: integrationId,
      order: args.order?._id || args.order?.id || null,
      shipment: args.shipment?._id || args.shipment?.id || null,
      endpoint: endpoint._id || endpoint.id || null,
      requestMetadata: sanitizeAndRedact(requestMetadata, secrets),
      responseStatus: response?.status,
      responseData: sanitizeAndRedact(response?.data, secrets),
      error: error ? sanitizeAndRedact({ message: error.message, httpStatus: error.httpStatus, requestId }, secrets) : null,
      timestamp: new Date(),
      requestId: requestId || undefined,
      responseId: responseRequestId(response) || undefined,
    });
  } catch {
    console.warn('[DeliveryApi] Integration log could not be saved');
  }
}

function retryIsAllowed(method, retry, error) {
  if (!SAFE_RETRY_METHODS.has(method) && retry.retryUnsafe !== true) return false;
  if (!error.response) return true;
  const statuses = Array.isArray(retry.retryOnStatuses) ? retry.retryOnStatuses : [408, 429, 500, 502, 503, 504];
  return statuses.includes(error.response.status);
}

export async function executeDeliveryEndpoint(args = {}, options = {}) {
  let integration = {};
  let endpoint = {};
  let requestMetadata = {};
  let lastResponse;
  let lastRequestId = null;
  let secrets = new Set();
  let requestDispatched = false;

  try {
    integration = await resolveIntegration(args.integration);
    endpoint = await resolveEndpoint(args.endpoint || args.endpointName, integration);
    secrets = collectSecrets(integration);
    collectSecrets(endpoint, false, secrets);
    if (integration.isActive === false || integration.enabled === false) throw new Error('Delivery integration is disabled');
    if (endpoint.isActive === false) throw new Error('Delivery endpoint is disabled');
    const apiConfiguration = integration.apiConfiguration || {};
    const configuredIntegration = apiConfiguration.integration || {};
    const method = String(endpoint.method || 'POST').toUpperCase();
    if (!HTTP_METHODS.has(method)) throw new Error(`Unsupported HTTP method: ${method}`);

    const configuredAuthentication = configuredIntegration.authentication || {};
    const selectedAuthentication = endpoint.authentication && endpoint.authentication.type !== 'inherit'
      ? endpoint.authentication
      : configuredAuthentication;
    const variables = makeOrderVariables(args.order || {}, args.extra || {}, selectedAuthentication.credentials || {}, integration.cityMappings || []);
    const resolvedPath = endpointUrl(integration, endpoint, variables);
    const urlCheck = await validateAndPinUrl(resolvedPath, options.allowPrivateNetwork === true);
    const url = urlCheck.url;
    const rawHeaders = {
      ...(apiConfiguration.headers || {}),
      ...(endpoint.headers || {}),
    };
    const headers = renderTemplate(rawHeaders, variables);
    const rawQuery = {
      ...(apiConfiguration.queryParams || {}),
      ...(endpoint.queryParameters || {}),
    };
    const queryParameters = renderTemplate(rawQuery, variables);
    const hasRequestBodyOverride = Object.prototype.hasOwnProperty.call(args, 'requestBodyOverride');
    const bodyTemplate = hasRequestBodyOverride
      ? args.requestBodyOverride
      : (hasConfiguredValue(endpoint.requestBody)
        ? endpoint.requestBody
        : (hasConfiguredValue(endpoint.requestMapping) ? endpoint.requestMapping : configuredIntegration.requestMapping));
    const requestBody = bodyTemplate == null
      ? undefined
      : (hasRequestBodyOverride ? bodyTemplate : renderTemplate(bodyTemplate, variables));
    const basicAuth = await applyAuthentication(integration, endpoint.authentication, headers, queryParameters, variables, options);
    appendQueryParameters(url, queryParameters);
    const timeout = Number(endpoint.timeoutMs || apiConfiguration.timeoutMs || 15000);
    const retry = endpoint.retry || {};
    const attempts = Math.max(0, Math.min(10, Number(retry.attempts) || 0));

    if (requestBody !== undefined && !Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = endpoint.requestContentType || 'application/json';
    }
    requestMetadata = {
      method,
      url: redactUrl(url.toString(), secrets),
      headers: Object.keys(headers),
      body: sanitizeDeliverySecrets(requestBody),
      configuredRetries: attempts,
    };

    if (options.dryRun === true) {
      return {
        ...standardResult(true),
        executed: false,
        request: sanitizeAndRedact(requestMetadata, secrets),
      };
    }
  if (options.dryRun === true) {
    return {
      ...standardResult(true),
      executed: false,
      request: sanitizeAndRedact(requestMetadata, secrets),
    };
  }

    let response;
    let attempt = 0;
    while (true) {
      try {
        requestDispatched = true;
        response = await axios.request({
          method,
          url: url.toString(),
          data: requestBody,
          headers,
          auth: basicAuth,
          timeout,
          maxRedirects: 0,
          proxy: false,
          httpAgent: urlCheck.httpAgent,
          httpsAgent: urlCheck.httpsAgent,
          validateStatus: status => status >= 200 && status < 300,
        });
        break;
      } catch (error) {
        if (attempt >= attempts || !retryIsAllowed(method, retry, error)) throw error;
        const baseDelay = Math.max(0, Number(retry.delayMs) || 0);
        const multiplier = Math.max(1, Number(retry.backoffMultiplier) || 1);
        const maxDelay = Math.max(0, Number(retry.maxDelayMs) || 0);
        await wait(Math.min(baseDelay * (multiplier ** attempt), maxDelay));
        attempt += 1;
      }
    }

    if (response.data && typeof response.data === 'object' && response.data.error) {
      const providerError = response.data.error;
      const error = new Error(providerError.message || providerError.data?.message || 'Provider returned an error response');
      error.response = response;
      throw error;
    }

    lastResponse = response;
    lastRequestId = responseRequestId(response);
    const mapped = mapResponse(response.data, endpoint, integration);
    lastRequestId = mapped.requestId || lastRequestId;
    requestMetadata.attempts = attempt + 1;
    await writeIntegrationLog(options.logModel === undefined ? DeliveryIntegrationLog : options.logModel,
      integration, endpoint, args, requestMetadata, response, null, lastRequestId, secrets);
    const result = standardResult(true, mapped, response.data, null, secrets);
    result.requestDispatched = true;
    if (options.includeRequest === true) result.request = sanitizeAndRedact(requestMetadata, secrets);
    return result;
  } catch (error) {
    const responseData = error.response?.data;
    const safeResponse = sanitizeAndRedact(responseData, secrets);
    const httpStatus = error.response?.status ?? null;
    lastRequestId = responseRequestId(error.response) || lastRequestId;
    const message = redactText(
      safeResponse?.message || safeResponse?.error?.message || error.message,
      secrets
    );
    const safeEndpoint = {
      id: endpoint._id || endpoint.id || null,
      name: endpoint.name || null,
      method: endpoint.method || null,
      url: requestMetadata.url || (endpoint.url ? redactUrl(endpoint.url) : null),
      url: requestMetadata.url || (endpoint.url ? redactUrl(endpoint.url, secrets) : null),
    };
    const failure = {
      httpStatus,
      message,
      providerResponse: safeResponse ?? null,
      endpoint: safeEndpoint,
      requestId: lastRequestId,
      requestDispatched,
      requestShape: requestMetadata.body && typeof requestMetadata.body === 'object' && !Array.isArray(requestMetadata.body)
        ? Object.fromEntries(Object.entries(requestMetadata.body).map(([key, value]) => [key, value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value]))
        : undefined,
      ...(options.includeRequest === true ? { request: sanitizeAndRedact(requestMetadata, secrets) } : {}),
    };
    await writeIntegrationLog(options.logModel === undefined ? DeliveryIntegrationLog : options.logModel,
      integration, endpoint, args, requestMetadata, error.response, failure, lastRequestId, secrets);
    return standardResult(false, {}, responseData, failure, secrets);
  }
}