// --- Delivery Integration Debug & Helpers ---
const isDebug = process.env.DELIVERY_DEBUG === 'true' || process.env.NODE_ENV !== 'production';
const SENSITIVE_KEY_REGEX = /(authorization|apiKey|apikey|token|password|secret|signature|refreshToken|accessToken)/i;

function maskSecrets(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (typeof value === 'object') {
    const out = Array.isArray(value) ? [] : {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY_REGEX.test(k) ? '***' : maskSecrets(v);
    }
    return out;
  }
  return value;
}

function safeJson(value, max = 10000) {
  try {
    const masked = maskSecrets(value);
    const str = JSON.stringify(masked);
    return str.length > max ? str.slice(0, max) + '…(truncated)' : str;
  } catch {
    return '[unserializable]';
  }
}

function debugLog(...args) {
  if (isDebug) console.log('[Delivery]', ...args);
}

// --- Delivery Hub (env-based, applies to all companies) ---
function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function getGlobalDefaultParams() {
  // Prefer a generic env, fall back to hub params if provided
  const defaults = parseJsonEnv('DELIVERY_DEFAULT_PARAMS', undefined);
  if (defaults && typeof defaults === 'object') return defaults;
  const hub = parseJsonEnv('DELIVERY_HUB_PARAMS', {});
  return hub;
}

function getGlobalDefaultQuery() {
  const defaults = parseJsonEnv('DELIVERY_DEFAULT_QUERY', undefined);
  if (defaults && typeof defaults === 'object') return defaults;
  const hub = parseJsonEnv('DELIVERY_HUB_QUERY', {});
  return hub;
}

function getEnvHubConfig(company) {
  const baseUrl = process.env.DELIVERY_HUB_BASE_URL;
  if (!baseUrl) return null;
  const format = (process.env.DELIVERY_HUB_FORMAT || 'jsonrpc').toLowerCase();
  const method = process.env.DELIVERY_HUB_METHOD || 'create_order';
  const authMethod = (process.env.DELIVERY_HUB_AUTH_METHOD || 'none').toLowerCase();
  const headers = parseJsonEnv('DELIVERY_HUB_HEADERS', {});
  const params = parseJsonEnv('DELIVERY_HUB_PARAMS', {});
  const queryParams = parseJsonEnv('DELIVERY_HUB_QUERY', {});
  const timeoutMs = Number(process.env.DELIVERY_HUB_TIMEOUT_MS || 0) || undefined;
  const jsonrpcOmitMethod = String(process.env.DELIVERY_HUB_JSONRPC_OMIT_METHOD || 'false').toLowerCase() === 'true';

  // Common additions: db from env, and company identity for routing at the hub
  const db = process.env.DELIVERY_HUB_DB;
  const identity = {
    companyCode: company.code || undefined,
    companyId: String(company._id || ''),
    companyName: company.name || undefined,
  };

  const apiKeyHeader = process.env.DELIVERY_HUB_API_KEY_HEADER || 'x-api-key';
  const apiKey = process.env.DELIVERY_HUB_API_KEY || process.env.DELIVERY_HUB_BEARER;
  const username = process.env.DELIVERY_HUB_USERNAME;
  const password = process.env.DELIVERY_HUB_PASSWORD;

  return {
    baseUrl,
    format,
    method,
    timeoutMs,
    authMethod,
    apiKey,
    apiKeyHeader,
    username,
    password,
    headers,
    params: { ...params, ...(db ? { db } : {}), ...identity },
    queryParams,
  jsonrpcOmitMethod,
    // Allow status via env too
    statusUrl: process.env.DELIVERY_HUB_STATUS_URL || undefined,
  };
}

const INTERNAL_STATUSES = new Set([
  'assigned',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'delivery_failed',
  'returned',
  'cancelled'
]);

// Common provider -> internal fallbacks when no company-specific mapping exists
const COMMON_STATUS_MAP = {
  // Assigned-like
  created: 'assigned',
  accepted: 'assigned',
  pending: 'assigned',
  awaiting: 'assigned',
  waiting: 'assigned',
  new: 'assigned',
  // Picked up
  pickup: 'picked_up',
  picked: 'picked_up',
  collected: 'picked_up',
  // In transit
  transit: 'in_transit',
  in_transit: 'in_transit',
  moving: 'in_transit',
  dispatched: 'in_transit',
  shipped: 'in_transit',
  on_the_way: 'in_transit',
  // Out for delivery
  out_for_delivery: 'out_for_delivery',
  ofd: 'out_for_delivery',
  with_courier: 'out_for_delivery',
  // Delivered
  delivered: 'delivered',
  completed: 'delivered',
  // Failed
  failed: 'delivery_failed',
  delivery_failed: 'delivery_failed',
  undeliverable: 'delivery_failed',
  attempt_failed: 'delivery_failed',
  // Returned
  returned: 'returned',
  rto: 'returned',
  return_to_origin: 'returned',
  // Cancelled
  cancelled: 'cancelled',
  canceled: 'cancelled'
};
import axios from 'axios';

function buildAuth({ apiConfiguration = {}, credentials = {} }) {
  const method = apiConfiguration.authMethod || 'none';
  const headers = { ...(apiConfiguration.headers || {}) };
  let auth;
  if (method === 'basic') {
    const username = apiConfiguration.username || credentials.username;
    const password = apiConfiguration.password || credentials.password;
    if (username || password) auth = { username, password };
  } else if (method === 'bearer') {
  const token = apiConfiguration.bearer || apiConfiguration.apiKey || credentials.token || credentials.apiKey;
    if (token) headers.Authorization = `Bearer ${token}`;
  } else if (method === 'apiKey') {
  const key = apiConfiguration.apiKey || credentials.apiKey;
  const headerName = credentials.apiKeyHeader || apiConfiguration.apiKeyHeader || process.env.DELIVERY_HUB_API_KEY_HEADER || 'x-api-key';
    if (key) headers[headerName] = key;
  }
  return { headers, auth };
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), obj);
}

export function buildPayloadFromMappings(order, company) {
  const payload = {};
  const mappings = Array.isArray(company.fieldMappings) ? company.fieldMappings : [];
  for (const m of mappings) {
    if (m.enabled === false) continue;
    if (!m.targetField) continue;
    let value;
    if (m.defaultValuePriority && m.defaultValue !== undefined) {
      // Always use the default value if priority flag is set
      value = m.defaultValue;
    } else if (m.sourceField === 'static') {
      value = m.defaultValue;
    } else if (m.sourceField) {
      value = getByPath(order, m.sourceField);
    }
    if ((value === undefined || value === null || value === '') && m.defaultValue !== undefined) {
      value = m.defaultValue;
    }
    if (m.transform === 'full_name') {
      const first = getByPath(order, 'customerInfo.firstName') || '';
      const last = getByPath(order, 'customerInfo.lastName') || '';
      value = `${first} ${last}`.trim();
    } else if (m.transform === 'uppercase' && typeof value === 'string') {
      value = value.toUpperCase();
    } else if (m.transform === 'lowercase' && typeof value === 'string') {
      value = value.toLowerCase();
    } else if (m.transform === 'trim' && typeof value === 'string') {
      value = value.trim();
    } else if (m.transform === 'phone_digits' && typeof value === 'string') {
      value = value.replace(/\D+/g, '');
    } else if (m.transform === 'phone_last10') {
      const asStr = value == null ? '' : String(value);
      const digits = asStr.replace(/\D+/g, '');
      // Keep last 10 digits, common rule for local mobile numbers
      value = digits.length > 10 ? digits.slice(-10) : digits;
    } else if (m.transform === 'to_string' && value !== undefined && value !== null) {
      value = String(value);
    } else if (m.transform === 'to_number' && value !== undefined && value !== null) {
      const n = Number(value);
      value = Number.isNaN(n) ? value : n;
    } else if (m.transform === 'array_length') {
      const arr = m.sourceField ? getByPath(order, m.sourceField) : undefined;
      value = Array.isArray(arr) ? arr.length : 0;
    } else if (m.transform === 'product_names') {
      const items = getByPath(order, 'items') || [];
      const names = Array.isArray(items) 
        ? items.map(item => item.name).filter(Boolean)
        : [];
      value = names.length ? names.join(', ') : '';
    }
    if (value !== undefined) payload[m.targetField] = value;
  }

  // Fallback to object fieldMapping if present (common simple map)
  if (!Object.keys(payload).length && company.fieldMapping && typeof company.fieldMapping === 'object') {
    const fm = company.fieldMapping;
    const standard = {
      orderId: 'orderNumber',
      customerName: 'customerInfo.firstName',
      customerPhone: 'customerInfo.mobile',
      customerEmail: 'customerInfo.email',
      deliveryAddress: 'shippingAddress.street',
      city: 'shippingAddress.city',
      country: 'shippingAddress.country',
      amount: 'totalAmount',
      totalWithShipping: 'totalWithShipping',
      productName: 'items.0.name',
      itemCount: 'items.length',
      currency: 'currency',
      notes: 'deliveryNotes'
    };
    Object.entries(standard).forEach(([key, src]) => {
      const target = fm[key];
      if (target) {
        const value = getByPath(order, src);
        if (value !== undefined) payload[target] = value;
      }
    });
  }

  return payload;
}

export function validateRequiredMappings(order, company) {
  const payload = buildPayloadFromMappings(order, company);
  const mappings = Array.isArray(company.fieldMappings) ? company.fieldMappings : [];
  const missing = [];
  for (const m of mappings) {
    if (m.enabled === false) continue;
    if (!m.required) continue;
    if (!m.targetField) continue;
    const val = payload[m.targetField];
    const emptyString = typeof val === 'string' && val.trim() === '';
    if (val === undefined || val === null || emptyString) {
      missing.push({ sourceField: m.sourceField, targetField: m.targetField });
    }
  }
  const ok = missing.length === 0;
  if (!ok) {
    debugLog('Required field mappings missing; aborting send', { company: company.name || company.code || company._id, missing });
  }
  return { ok, missing, payload };
}

export function validateCompanyConfiguration(company) {
  const issues = [];
  const hubCfg = getEnvHubConfig(company);
  const url = hubCfg?.baseUrl || company.apiUrl || company.apiConfiguration?.baseUrl || '';
  const format = hubCfg?.format || company.apiFormat || company.apiConfiguration?.format || 'rest';
  const authMethod = hubCfg?.authMethod || company.apiConfiguration?.authMethod || 'none';
  const isTest = company.apiConfiguration?.isTestMode === true || !url;

  if (company.isActive === false) issues.push('company_inactive');

  if (!isTest && !url) issues.push('missing_url');

  if (format === 'jsonrpc') {
    const method = hubCfg?.method || company.apiConfiguration?.method;
    const omit = hubCfg?.jsonrpcOmitMethod === true || company.apiConfiguration?.jsonrpcOmitMethod === true || company.apiConfiguration?.omitJsonRpcMethod === true;
  if (!method && !omit) issues.push('missing_jsonrpc_method');
  }

  if (authMethod === 'basic') {
    const u = company.apiConfiguration?.username || company.credentials?.username;
    const p = company.apiConfiguration?.password || company.credentials?.password;
    if (!u || !p) issues.push('missing_basic_auth_credentials');
  } else if (authMethod === 'bearer') {
    const token = company.apiConfiguration?.apiKey || company.credentials?.token || company.credentials?.apiKey;
    if (!token) issues.push('missing_bearer_token');
  } else if (authMethod === 'apiKey') {
    const key = company.apiConfiguration?.apiKey || company.credentials?.apiKey;
    if (!key) issues.push('missing_api_key');
  }

  const statusUrl = hubCfg?.statusUrl || company.apiConfiguration?.statusUrl;
  if (statusUrl) {
    const hasPlaceholder = String(statusUrl).includes(':tracking');
    if (!hasPlaceholder) issues.push('status_url_missing_tracking_placeholder');
  }

  // Required params presence
  const required = Array.isArray(company.apiConfiguration?.requiredParams) ? company.apiConfiguration.requiredParams : [];
  if (required.length) {
    const params = company.apiConfiguration?.params || {};
    const q = company.apiConfiguration?.queryParams || {};
    for (const key of required) {
      const hasEnv = (key === 'db' && !!process.env.DELIVERY_HUB_DB);
      const credDb = company.credentials?.database || company.credentials?.db || company.customFields?.db;
      const hasFallback = key === 'db' && !!credDb;
      if (params[key] === undefined && q[key] === undefined && !hasEnv && !hasFallback) {
        issues.push(`missing_required_param:${key}`);
      }
    }
  }

  const ok = issues.length === 0;
  if (!ok) {
    debugLog('Company configuration validation failed', {
      company: company.name || company.code || company._id,
      issues
    });
  } else {
    debugLog('Company configuration validation passed', {
      company: company.name || company.code || company._id,
      mode: isTest ? 'test' : 'live'
    });
  }
  return { ok, issues, mode: isTest ? 'test' : 'live', url };
}

function appendQuery(url, queryParams) {
  if (!queryParams || typeof queryParams !== 'object') return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(queryParams)) {
    if (v === undefined || v === null) continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function sendRest(order, company, payload) {
  let url = company.apiUrl || company.apiConfiguration?.baseUrl;
  if (!url) throw new Error('Delivery company is missing API URL');

  const { headers: extraHeaders, auth } = buildAuth(company);
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  // Merge static params and query params
  const globalParams = getGlobalDefaultParams();
  const envDb = process.env.DELIVERY_HUB_DB || process.env.ODOO_DB || process.env.DELIVERY_DB;
  const baseParams = { ...(globalParams || {}), ...(company.apiConfiguration?.params || {}) };
  if (envDb && baseParams.db == null) baseParams.db = envDb;
  // Fallback: accept db from stored credentials/customFields if not present in params
  const credDb = company.credentials?.database || company.credentials?.db || company.customFields?.db;
  if (baseParams.db == null && credDb) baseParams.db = credDb;
  const mergedPayload = { ...baseParams, ...payload };
  const globalQuery = getGlobalDefaultQuery();
  const baseQuery = { ...(globalQuery || {}), ...(company.apiConfiguration?.queryParams || {}) };
  // Some providers (e.g., Odoo/Olivery) read only http.request.params, not JSON body.
  // Ensure `db` is present in the query string if detected/required.
  const requireDbInQuery = process.env.DELIVERY_REQUIRE_DB === 'true' || /olivery|odoo/i.test(String(url));
  if (requireDbInQuery && baseQuery.db == null && baseParams.db != null) baseQuery.db = baseParams.db;
  if (envDb && baseQuery.db == null && baseParams.db == null) baseQuery.db = envDb;
  const effectiveQuery = baseQuery;
  url = appendQuery(url, effectiveQuery);
  const timeout = Number(company.apiConfiguration?.timeoutMs) || 15000;
  debugLog('Sending REST delivery request', {
    company: company.name || company.code || company._id,
    url,
    headers: maskSecrets(headers),
    payload: maskSecrets(mergedPayload)
  });
  let resp;
  try {
    resp = await axios.post(url, mergedPayload, { headers, auth, timeout });
  } catch (err) {
    const dbg = err.response?.data;
    const dbgStr = typeof dbg === 'string' ? dbg : JSON.stringify(dbg || {});
    const missingDb = /KeyError: 'db'/.test(String(dbgStr)) || /\bdb\b/.test(String(err.message || ''));
    if (missingDb) {
      err.message = `${err.message} - missing 'db' param. Configure company.apiConfiguration.params.db or set DELIVERY_HUB_DB / ODOO_DB / DELIVERY_DB or DELIVERY_DEFAULT_PARAMS={"db":"..."}`;
    }
    debugLog('REST delivery request failed', {
      code: err.code,
      message: err.message,
      responseStatus: err.response?.status,
      responseData: safeJson(err.response?.data)
    });
    throw err;
  }
  // Try to extract tracking number from common fields
  const data = resp.data || {};
  if (data && typeof data === 'object' && data.error) {
    debugLog('Provider returned error payload', { error: safeJson(data.error) });
    const msg = data.error?.message || data.error?.data?.message || 'Provider rejected the request';
    const code = data.error?.code;
    const err = new Error(`Provider error${code ? ` (${code})` : ''}: ${msg}`);
    err.response = resp;
    throw err;
  }
  const tracking = data.trackingNumber || data.tracking_id || data.trackingId || data.reference || data.reference_id || data.order_id || data.id;
  const providerStatus = data.deliveryStatus || data.status || data.current_status || data.state || 'created';
  debugLog('REST delivery response received', {
    status: resp.status,
    tracking,
    providerStatus,
    data: safeJson(data)
  });
  return { trackingNumber: tracking, providerResponse: data, providerStatus };
}

async function sendJsonRpc(order, company, payload) {
  let url = company.apiUrl || company.apiConfiguration?.baseUrl;
  if (!url) throw new Error('Delivery company is missing API URL');
  const omit = company.apiConfiguration?.jsonrpcOmitMethod === true || company.apiConfiguration?.omitJsonRpcMethod === true;
  const globalParams = getGlobalDefaultParams();
  const envDb = process.env.DELIVERY_HUB_DB || process.env.ODOO_DB || process.env.DELIVERY_DB;
  const baseParams = { ...(globalParams || {}), ...(company.apiConfiguration?.params || {}) };
  if (envDb && baseParams.db == null) baseParams.db = envDb;
  // Fallback: accept db from stored credentials/customFields if not present in params
  const credDb = company.credentials?.database || company.credentials?.db || company.customFields?.db;
  if (baseParams.db == null && credDb) baseParams.db = credDb;
  // Some Odoo-like providers expect credentials in JSON-RPC params (not only headers)
  const includeCreds = process.env.DELIVERY_INCLUDE_CREDS === 'true' || /olivery|odoo/i.test(String(url)) || company.apiConfiguration?.credentialsInParams === true;
  const username = company.apiConfiguration?.username || company.credentials?.username || company.credentials?.login;
  const password = company.apiConfiguration?.password || company.credentials?.password;
  const credParams = includeCreds ? { password, username, login: username } : {};
  const params = { ...baseParams, ...payload, ...credParams };
  const body = omit
    ? { jsonrpc: '2.0', params }
    : {
        jsonrpc: '2.0',
        method: company.apiConfiguration?.method || 'create_order',
        params,
        id: Date.now()
      };
  const globalQuery = getGlobalDefaultQuery();
  const baseQuery = { ...(globalQuery || {}), ...(company.apiConfiguration?.queryParams || {}) };
  if (envDb && baseQuery.db == null && baseParams.db == null) baseQuery.db = envDb;
  url = appendQuery(url, baseQuery);
  const { headers, auth } = buildAuth(company);
  const sendHeaders = { 'Content-Type': 'application/json', ...headers };
  const timeout = Number(company.apiConfiguration?.timeoutMs) || 15000;
  debugLog('Sending JSON-RPC delivery request', {
    company: company.name || company.code || company._id,
    url,
    headers: maskSecrets(sendHeaders),
    body: maskSecrets(body)
  });
  let resp;
  try {
    resp = await axios.post(url, body, { headers: sendHeaders, auth, timeout });
  } catch (err) {
    const dbg = err.response?.data;
    const dbgStr = typeof dbg === 'string' ? dbg : JSON.stringify(dbg || {});
    const missingDb = /KeyError: 'db'/.test(String(dbgStr)) || /\bdb\b/.test(String(err.message || ''));
    if (missingDb) {
      err.message = `${err.message} - missing 'db' param. Configure company.apiConfiguration.params.db or set DELIVERY_HUB_DB / ODOO_DB / DELIVERY_DB or DELIVERY_DEFAULT_PARAMS={"db":"..."}`;
    }
    debugLog('JSON-RPC delivery request failed', {
      code: err.code,
      message: err.message,
      responseStatus: err.response?.status,
      responseData: safeJson(err.response?.data)
    });
    throw err;
  }
  const result = resp.data?.result || {};
  if (resp.data && typeof resp.data === 'object' && resp.data.error) {
    debugLog('JSON-RPC error payload received', { error: safeJson(resp.data.error) });
    const msg = resp.data.error?.message || resp.data.error?.data?.message || 'Provider rejected the request';
    const code = resp.data.error?.code;
    const err = new Error(`Provider error${code ? ` (${code})` : ''}: ${msg}`);
    err.response = resp;
    throw err;
  }
  const tracking = result.trackingNumber || result.tracking_id || result.reference || result.reference_id || result.id;
  const providerStatus = result.deliveryStatus || result.status || result.current_status || result.state || 'created';
  debugLog('JSON-RPC delivery response received', {
    status: resp.status,
    tracking,
    providerStatus,
    data: safeJson(resp.data)
  });
  return { trackingNumber: tracking, providerResponse: resp.data, providerStatus };
}

export async function sendToCompany(order, company, extra = {}) {
  const payload = buildPayloadFromMappings(order, company);
  // Allow custom fields from company config
  if (company.customFields && typeof company.customFields === 'object') {
    Object.assign(payload, company.customFields);
  }
  if (typeof extra.deliveryFee === 'number') {
    payload.deliveryFee = extra.deliveryFee;
  }

  // Prefer hub config if present (global, applies to all companies)
  const hubCfg = getEnvHubConfig(company);
  const format = hubCfg?.format || company.apiFormat || company.apiConfiguration?.format || 'rest';
  const url = hubCfg?.baseUrl || company.apiUrl || company.apiConfiguration?.baseUrl;
  const isTest = (company.apiConfiguration?.isTestMode === true) || !url;

  debugLog('Preparing to send order to delivery company', {
    orderRef: order.orderNumber || order._id,
    company: company.name || company.code || company._id,
    format,
    url: url || '[none]',
    mode: isTest ? 'test' : 'live',
    payload: maskSecrets(payload)
  });

  if (isTest) {
    const tracking = `TEST-${order.orderNumber || order._id}-${Date.now().toString().slice(-6)}`;
    debugLog('Simulated delivery send (test mode)', { tracking });
    return {
      trackingNumber: tracking,
      providerResponse: { mode: 'test', note: 'Simulated send (no API URL or test mode enabled)', payload },
      providerStatus: 'created'
    };
  }

  // Preflight checks: required field mappings and required API params
  const mappingCheck = validateRequiredMappings(order, company);
  if (!mappingCheck.ok) {
    const err = new Error('Missing required mapped fields');
    err.code = 'MAPPING_MISSING';
    err.details = mappingCheck.missing;
    debugLog('Preflight failed: field mappings missing', { missing: mappingCheck.missing });
    throw err;
  }

  // Build an effective company config (including hub if present) to evaluate params like db
  const effectiveCompany = hubCfg
    ? { ...company, apiConfiguration: { ...(company.apiConfiguration || {}), ...hubCfg } }
    : company;
  const globalParams = getGlobalDefaultParams();
  const envDb = process.env.DELIVERY_HUB_DB || process.env.ODOO_DB || process.env.DELIVERY_DB;
  const baseParams = { ...(globalParams || {}), ...(effectiveCompany.apiConfiguration?.params || {}) };
  if (envDb && baseParams.db == null) baseParams.db = envDb;
  // Fallback: accept db from stored credentials/customFields if not present in params
  const credDb = effectiveCompany.credentials?.database || effectiveCompany.credentials?.db || effectiveCompany.customFields?.db;
  if (baseParams.db == null && credDb) baseParams.db = credDb;
  const mergedBodyParams = { ...baseParams, ...payload };
  const globalQuery = getGlobalDefaultQuery();
  const baseQuery = { ...(globalQuery || {}), ...(effectiveCompany.apiConfiguration?.queryParams || {}) };
  if (envDb && baseQuery.db == null && baseParams.db == null) baseQuery.db = envDb;

  const requiredParams = new Set(
    Array.isArray(effectiveCompany.apiConfiguration?.requiredParams)
      ? effectiveCompany.apiConfiguration.requiredParams
      : []
  );
  // Heuristic: Odoo/Olivery endpoints require db; allow opt-in via DELIVERY_REQUIRE_DB=true
  const requireDb = process.env.DELIVERY_REQUIRE_DB === 'true' || /olivery|odoo/i.test(String(url));
  if (requireDb) requiredParams.add('db');
  // Heuristic: these endpoints may also require credentials in params
  const includeCreds = process.env.DELIVERY_INCLUDE_CREDS === 'true' || /olivery|odoo/i.test(String(url)) || effectiveCompany.apiConfiguration?.credentialsInParams === true;
  if (includeCreds) {
    requiredParams.add('password');
    requiredParams.add('username');
  }
  const missingParams = [];
  for (const k of requiredParams) {
    const present = (mergedBodyParams[k] !== undefined && mergedBodyParams[k] !== null && String(mergedBodyParams[k]) !== '')
      || (baseQuery[k] !== undefined && baseQuery[k] !== null && String(baseQuery[k]) !== '')
      || (k === 'db' && !!(effectiveCompany.credentials?.database || effectiveCompany.credentials?.db || effectiveCompany.customFields?.db))
      || (k === 'password' && !!(effectiveCompany.apiConfiguration?.password || effectiveCompany.credentials?.password))
      || (k === 'username' && !!(effectiveCompany.apiConfiguration?.username || effectiveCompany.credentials?.username || effectiveCompany.credentials?.login));
    if (!present) missingParams.push(k);
  }
  if (missingParams.length) {
    const err = new Error(`Missing required API params: ${missingParams.join(', ')}`);
    err.code = 'PARAMS_MISSING';
    err.details = { missingParams, url, format };
    debugLog('Preflight failed: API params missing', { missingParams, mergedBodyParams: maskSecrets(mergedBodyParams), baseQuery });
    throw err;
  }

  if (format === 'jsonrpc' || hubCfg?.format === 'jsonrpc') {
    // If using hub, temporarily project hub auth into company for call
    if (hubCfg) {
      const enriched = {
        ...company,
        apiConfiguration: {
          ...(company.apiConfiguration || {}),
          ...hubCfg,
        }
      };
      return sendJsonRpc(order, enriched, payload);
    }
    return sendJsonRpc(order, company, payload);
  }
  // REST path with auto-detect fallback to JSON-RPC if provider indicates it
  try {
    if (hubCfg) {
      const enriched = {
        ...company,
        apiConfiguration: {
          ...(company.apiConfiguration || {}),
          ...hubCfg,
        }
      };
      return await sendRest(order, enriched, payload);
    }
    return await sendRest(order, company, payload);
  } catch (err) {
    const data = err?.response?.data;
    const looksJsonRpc = (data && typeof data === 'object' && (data.jsonrpc || data.error))
      || /jsonrpc/i.test(String(err.message))
      || /odoo/i.test(String(err.message))
      || /KeyError: 'db'/i.test(String(data?.error?.debug || ''));
    if (looksJsonRpc) {
      debugLog('REST send hinted JSON-RPC provider; retrying as JSON-RPC once');
      try {
        return await sendJsonRpc(order, company, payload);
      } catch (err2) {
        throw err2;
      }
    }
    throw err;
  }
}

export async function getDeliveryStatusFromCompany(order, company) {
  // If company provides a status endpoint in apiConfiguration
  const statusUrl = company.apiConfiguration?.statusUrl || company.statusUrl;
  if (!statusUrl) {
    debugLog('No status URL configured; returning order status', {
      orderRef: order.orderNumber || order._id,
      status: order.deliveryStatus || 'assigned'
    });
    return { status: order.deliveryStatus || 'assigned', events: [] };
  }
  const { headers, auth } = buildAuth(company);
  const finalUrl = statusUrl.replace(':tracking', order.deliveryTrackingNumber || order.trackingNumber);
  debugLog('Fetching delivery status', {
    company: company.name || company.code || company._id,
    url: finalUrl,
    headers: maskSecrets(headers)
  });
  let resp;
  try {
    resp = await axios.get(finalUrl, { headers, auth, timeout: 15000 });
  } catch (err) {
    debugLog('Status fetch failed', {
      code: err.code,
      message: err.message,
      responseStatus: err.response?.status,
      responseData: safeJson(err.response?.data)
    });
    throw err;
  }
  const data = resp.data || {};
  debugLog('Status response received', { status: resp.status, data: safeJson(data) });
  return {
  status: data.deliveryStatus || data.status || data.current_status || data.state || 'in_transit',
    trackingNumber: order.deliveryTrackingNumber || order.trackingNumber,
    estimatedDelivery: data.estimatedDelivery || data.eta,
    events: data.events || data.updates || []
  };
}

export async function testCompanyConnection(company) {
  const url = company.apiUrl || company.apiConfiguration?.baseUrl;
  if (!url) throw new Error('No API URL configured');
  const { headers, auth } = buildAuth(company);
  debugLog('Testing company connection', { company: company.name || company.code || company._id, url, headers: maskSecrets(headers) });
  const resp = await axios({ method: 'OPTIONS', url, headers, auth, timeout: 8000 }).catch(async (err) => {
    debugLog('OPTIONS failed, falling back to HEAD', { code: err.code, message: err.message });
    return axios.head(url, { headers, auth, timeout: 8000 });
  });
  return { ok: !!resp, status: resp?.status };
}

export function mapStatus(company, providerStatus) {
  if (!providerStatus) return 'assigned';
  const list = company.statusMapping || [];
  const found = list.find(s => String(s.companyStatus).toLowerCase() === String(providerStatus).toLowerCase());
  let mapped = found ? found.internalStatus : providerStatus;
  if (!found) {
    const norm = String(providerStatus).trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
    if (COMMON_STATUS_MAP[norm]) {
      mapped = COMMON_STATUS_MAP[norm];
    }
  }
  debugLog('Mapped provider status', {
    company: company.name || company.code || company._id,
    providerStatus,
    mapped
  });
  return INTERNAL_STATUSES.has(String(mapped)) ? String(mapped) : 'assigned';
}
