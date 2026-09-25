import axios from 'axios';
import https from 'https';
import Settings from '../models/Settings.js';

// In-memory token cache
let tokenCache = {
  accessToken: '',
  expiresAt: 0 // epoch ms
};
let insecureTlsWarned = false;
let insecureHttpsAgent = null;

function now() { return Date.now(); }

function coerceBool(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function withMcgTransport(cfg, options = {}) {
  if (!cfg?.insecureTls) return options;
  if (!insecureHttpsAgent) {
    insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });
  }
  if (!insecureTlsWarned) {
    insecureTlsWarned = true;
    try {
      console.warn('[mcg][tls] insecure TLS mode enabled (certificate validation disabled). Use only as temporary workaround.');
    } catch {}
  }
  return { ...options, httpsAgent: insecureHttpsAgent };
}

async function getConfig() {
  let s = await Settings.findOne().sort({ updatedAt: -1 });
  if (!s) s = await Settings.create({});
  const db = s.mcg || {};
  const apiFlavor = (db.apiFlavor || process.env.MCG_API_FLAVOR || '').trim().toLowerCase();
  const envFixedBearer = (process.env.MCG_FIXED_BEARER || '').trim();

  // Base URL defaults differ by flavor
  let base = (db.baseUrl || process.env.MCG_BASE_URL || '').trim();
  if (!base) {
    base = apiFlavor === 'uplicali'
      ? 'https://apis.uplicali.com/SuperMCG/MCG_API'
      : 'https://api.mcgateway.com';
  }
  if (base && !/^https?:\/\//i.test(base)) base = 'https://' + base; // ensure protocol
  base = base.replace(/\/$/, '');

  const clientId = (db.clientId || process.env.MCG_CLIENT_ID || '').trim();
  const clientSecret = (db.clientSecret || process.env.MCG_CLIENT_SECRET || '').trim();
  const scope = (db.scope || process.env.MCG_SCOPE || '').trim();
  const version = (db.apiVersion || process.env.MCG_API_VERSION || 'v2.6').trim();
  const tokenUrl = (db.tokenUrl || process.env.MCG_TOKEN_URL || (apiFlavor === 'uplicali' ? 'https://login.uplicali.com/mcg' : '')).trim();
  const extraHeaderName = (db.extraHeaderName || process.env.MCG_EXTRA_HEADER_NAME || '').trim();
  const extraHeaderValue = (db.extraHeaderValue || process.env.MCG_EXTRA_HEADER_VALUE || '').trim();
  const vendorCode = (db.vendorCode || process.env.MCG_VENDOR_CODE || '').trim();
  const retailerKey = (db.retailerKey || process.env.MCG_RETAILER_KEY || '').trim();
  const retailerClientId = (db.retailerClientId || process.env.MCG_RETAILER_CLIENT_ID || '').trim();
  const insecureTls = coerceBool(process.env.MCG_INSECURE_TLS || process.env.MCG_TLS_ALLOW_EXPIRED);
  const enabled = typeof db.enabled === 'boolean' ? !!db.enabled : !!(clientId && clientSecret) || !!envFixedBearer;
  // Allow operation when a fixed bearer token is supplied via environment, even if client credentials are missing
  if (!envFixedBearer && (!clientId || !clientSecret)) {
    throw new Error('MCG client credentials are not configured (Settings.mcg or env)');
  }
  return { base, clientId, clientSecret, scope, version, enabled, tokenUrl, extraHeaderName, extraHeaderValue, apiFlavor, vendorCode, retailerKey, retailerClientId, envFixedBearer, insecureTls };
}

async function fetchAccessToken() {
  const { clientId, clientSecret, scope, tokenUrl, base, apiFlavor, envFixedBearer, insecureTls } = await getConfig();
  if (envFixedBearer) {
    // Use provided fixed bearer token (for diagnostics/temporary wiring)
    tokenCache = { accessToken: envFixedBearer, expiresAt: now() + 5 * 60 * 1000 };
    return envFixedBearer;
  }
  const url = tokenUrl || (apiFlavor === 'uplicali' ? 'https://login.uplicali.com/mcg' : `${base}/oauth2/access_token`);
  const params = new URLSearchParams();
  params.set('grant_type', 'client_credentials');
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  if (scope) params.set('scope', scope);
  const resp = await axios.post(url, params.toString(), withMcgTransport({ insecureTls }, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000
  }));
  const data = resp?.data || {};
  const token = data.access_token || data.token || '';
  const expiresIn = Number(data.expires_in || 0);
  if (!token) throw new Error('MCG OAuth2 did not return access_token');
  const ttl = Number.isFinite(expiresIn) && expiresIn > 60 ? (expiresIn - 60) * 1000 : 10 * 60 * 1000;
  tokenCache = { accessToken: token, expiresAt: now() + ttl };
  return token;
}

async function getAccessToken() {
  if (tokenCache.accessToken && tokenCache.expiresAt - now() > 10 * 1000) {
    return tokenCache.accessToken;
  }
  return await fetchAccessToken();
}

function buildAuthHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// Flavor detection
function isUpliFlavor(cfg) {
  return (cfg.apiFlavor === 'uplicali') || /apis\.uplicali\.com/i.test(cfg.base) || /SuperMCG\/MCG_API/i.test(cfg.base);
}

function buildUpliUrl(base, vendorCode, retailerKey, retailerClientId) {
  const q = new URLSearchParams({ code: vendorCode, key: retailerKey, client_id: retailerClientId });
  return `${base}?${q.toString()}`;
}

async function mcgRequestUpli(body) {
  const cfg = await getConfig();
  const { base, vendorCode, retailerKey, retailerClientId } = cfg;
  if (!vendorCode || !retailerKey || !retailerClientId) {
    throw new Error('MCG Uplîcali identifiers are missing: vendorCode, retailerKey, retailerClientId');
  }
  const url = buildUpliUrl(base, vendorCode, retailerKey, retailerClientId);
  let token = await getAccessToken();
  try {
    const resp = await axios.post(url, body, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...buildAuthHeader(token),
        code: vendorCode,
        key: retailerKey,
        client_id: retailerClientId
      },
      ...withMcgTransport(cfg, { timeout: 25000 })
    });
    return resp?.data || {};
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401) {
      token = await fetchAccessToken();
      const resp2 = await axios.post(url, body, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...buildAuthHeader(token),
          code: vendorCode,
          key: retailerKey,
          client_id: retailerClientId
        },
        ...withMcgTransport(cfg, { timeout: 25000 })
      });
      return resp2?.data || {};
    }
    let detail = '';
    try {
      const d = e?.response?.data;
      if (d && typeof d === 'object') {
        const m = d.Message || d.error || d.message;
        if (m) detail = `: ${m}`;
      } else if (typeof e?.response?.data === 'string') {
        detail = `: ${String(e.response.data).slice(0,160).replace(/\s+/g,' ').trim()}`;
      }
    } catch {}
    if (!detail && e && e.message) detail = `: ${e.message}`;
    const err = new Error(`MCG request failed${status ? ` (${status})` : ''}${detail}`);
    err.status = status;
    throw err;
  }
}

export async function getVersion() {
  const cfg = await getConfig();
  if (!isUpliFlavor(cfg)) throw new Error('getVersion is only available for Uplîcali flavor');
  return await mcgRequestUpli({ req: 'get_ver' });
}

// Build body for legacy list
function buildItemsListBody({ PageNumber, PageSize, Filter }) {
  const body = {};
  if (Number.isFinite(Number(PageNumber)) && Number(PageNumber) > 0) body.PageNumber = Number(PageNumber);
  if (Number.isFinite(Number(PageSize)) && Number(PageSize) > 0) body.PageSize = Number(PageSize);
  if (Filter && typeof Filter === 'object') {
    const f = {};
    const map = ['Category','Manufacturer','Barcode','ItemID','SearchText','AvailableOnly'];
    for (const k of map) {
      if (Object.prototype.hasOwnProperty.call(Filter, k)) f[k] = Filter[k];
    }
    if (Object.keys(f).length) body.Filter = f;
  }
  return body;
}

export async function getItemsList(params = {}) {
  const cfg = await getConfig();
  if (isUpliFlavor(cfg)) {
    const { start_time, startTime, group } = params || {};
    const body = { req: 'get_items_list' };
    if (startTime || start_time) body.start_time = (startTime || start_time);
    if (group !== undefined && group !== null && !Number.isNaN(Number(group))) body.group = Number(group);
    return await mcgRequestUpli(body);
  }

  const { base, version, extraHeaderName, extraHeaderValue } = cfg;
  const url = `${base}/api/${version}/get_items_list`;
  let token = await getAccessToken();
  const body = buildItemsListBody(params);
  try {
    const resp = await axios.post(url, body, withMcgTransport(cfg, {
      headers: { 'Content-Type': 'application/json', ...buildAuthHeader(token), ...(extraHeaderName && extraHeaderValue ? { [extraHeaderName]: extraHeaderValue } : {}) },
      timeout: 25000
    }));
    return resp?.data || {};
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401) {
      token = await fetchAccessToken();
      const resp2 = await axios.post(url, body, withMcgTransport(cfg, {
        headers: { 'Content-Type': 'application/json', ...buildAuthHeader(token), ...(extraHeaderName && extraHeaderValue ? { [extraHeaderName]: extraHeaderValue } : {}) },
        timeout: 25000
      }));
      return resp2?.data || {};
    }
    let detail = '';
    try {
      const d = e?.response?.data;
      if (d && typeof d === 'object') {
        const m = d.Message || d.error || d.message;
        if (m) detail = `: ${m}`;
      } else if (typeof e?.response?.data === 'string') {
        detail = `: ${String(e.response.data).slice(0,160).replace(/\s+/g,' ').trim()}`;
      }
    } catch {}
    if (!detail && e && e.message) {
      detail = `: ${e.message}`;
    }
    const err = new Error(`MCG get_items_list failed${status ? ` (${status})` : ''}${detail}`);
    err.status = status;
    throw err;
  }
}

// Push stock deltas back to MCG
export async function updateItemsQuantities(items = []) {
  if (!Array.isArray(items) || !items.length) return { ok: false, reason: 'no_items' };
  // Basic validation and normalization
  const payload = [];
  for (const it of items) {
    if (!it) continue;
    const ItemCode = (it.ItemCode ?? it.itemCode ?? it.barcode ?? '').toString().trim();
    const q = Number(it.Quantity ?? it.quantity);
    if (!ItemCode || !Number.isFinite(q) || !q) continue;
    payload.push({ ItemCode, Quantity: q });
  }
  if (!payload.length) return { ok: false, reason: 'no_valid_items' };

  const cfg = await getConfig();
  if (isUpliFlavor(cfg)) {
    // For Uplîcali, the documented way to update items is via req: 'set_items_list'.
    // We only have deltas here, but some retailers accept a delta body. Prefer spec-compliant call when absolute items provided elsewhere.
    // Keep backward compatibility by attempting the simple { Items } delta if caller insists on deltas.
    const res = await mcgRequestUpli({ Items: payload });
    return res || { ok: true };
  }
  // Legacy: attempt a conventional endpoint name; include extra header if configured
  const { base, version, extraHeaderName, extraHeaderValue } = cfg;
  const url = `${base}/api/${version}/update_items_quantities`;
  let token = await getAccessToken();
  try {
    const resp = await axios.post(url, { Items: payload }, withMcgTransport(cfg, {
      headers: { 'Content-Type': 'application/json', ...buildAuthHeader(token), ...(extraHeaderName && extraHeaderValue ? { [extraHeaderName]: extraHeaderValue } : {}) },
      timeout: 20000
    }));
    return resp?.data || { ok: true };
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401) {
      token = await fetchAccessToken();
      const resp2 = await axios.post(url, { Items: payload }, withMcgTransport(cfg, {
        headers: { 'Content-Type': 'application/json', ...buildAuthHeader(token), ...(extraHeaderName && extraHeaderValue ? { [extraHeaderName]: extraHeaderValue } : {}) },
        timeout: 20000
      }));
      return resp2?.data || { ok: true };
    }
    let detail = '';
    try {
      const d = e?.response?.data; if (d && typeof d === 'object') detail = d.message || d.error || '';
    } catch {}
    const err = new Error(`MCG update quantities failed${status ? ` (${status})` : ''}${detail ? `: ${detail}` : ''}`);
    err.status = status;
    throw err;
  }
}

// Set or update items (absolute values) per Uplîcali spec using set_items_list
// items: array of objects supporting keys like { item_id, item_code, item_name?, item_price?, item_department?, item_image?, item_inventory?, item_weight?, item_ads?, item_attribute? }
export async function setItemsList(items = [], group) {
  if (!Array.isArray(items) || !items.length) return { ok: false, reason: 'no_items' };
  const cfg = await getConfig();
  const cleanItems = [];
  for (const it of items) {
    if (!it) continue;
    // Normalize primary identifiers and inventory
    const item_id = (it.item_id ?? it.ItemID ?? it.itemId ?? '').toString().trim();
    const item_code = (it.item_code ?? it.ItemCode ?? it.barcode ?? '').toString().trim();
    const invRaw = it.item_inventory ?? it.inventory ?? it.quantity ?? it.Quantity;
    const item_inventory = Number.isFinite(Number(invRaw)) ? Number(invRaw) : undefined;
    if (!item_id && !item_code) continue;
    const payload = { };
    // Include both identifiers when available so MCG can match on either
    if (item_id) {
      payload.item_id = item_id;
      payload.itemId = item_id;
      payload.ItemID = item_id;
    }
    if (item_code) {
      payload.item_code = item_code;
      payload.itemCode = item_code;
      payload.ItemCode = item_code;
    }
    if (item_inventory !== undefined) {
      payload.item_inventory = item_inventory;
      payload.itemInventory = item_inventory;
      payload.ItemInventory = item_inventory;
    }
    // pass-through optional known fields if provided
    for (const k of ['item_name','item_price','item_department','item_image','item_weight','item_ads','item_attribute']) {
      if (it[k] !== undefined) payload[k] = it[k];
    }
    cleanItems.push(payload);
  }
  if (!cleanItems.length) return { ok: false, reason: 'no_valid_items' };

  if (isUpliFlavor(cfg)) {
    const body = { req: 'set_items_list', items: cleanItems };
    if (group !== undefined && group !== null && !Number.isNaN(Number(group))) body.group = Number(group);
    const res = await mcgRequestUpli(body);
    return res || { ok: true };
  }

  // Legacy flavor: try a conventional REST path
  const { base, version, extraHeaderName, extraHeaderValue } = cfg;
  const url = `${base}/api/${version}/set_items_list`;
  let token = await getAccessToken();
  try {
    const resp = await axios.post(url, { items: cleanItems, ...(group !== undefined ? { group } : {}) }, withMcgTransport(cfg, {
      headers: { 'Content-Type': 'application/json', ...buildAuthHeader(token), ...(extraHeaderName && extraHeaderValue ? { [extraHeaderName]: extraHeaderValue } : {}) },
      timeout: 25000
    }));
    return resp?.data || { ok: true };
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401) {
      token = await fetchAccessToken();
      const resp2 = await axios.post(url, { items: cleanItems, ...(group !== undefined ? { group } : {}) }, withMcgTransport(cfg, {
        headers: { 'Content-Type': 'application/json', ...buildAuthHeader(token), ...(extraHeaderName && extraHeaderValue ? { [extraHeaderName]: extraHeaderValue } : {}) },
        timeout: 25000
      }));
      return resp2?.data || { ok: true };
    }
    let detail = '';
    try {
      const d = e?.response?.data; if (d && typeof d === 'object') detail = d.message || d.error || '';
    } catch {}
    const err = new Error(`MCG set_items_list failed${status ? ` (${status})` : ''}${detail ? `: ${detail}` : ''}`);
    err.status = status;
    throw err;
  }
}

export async function updateItem(item = {}, group) {
  if (!item || typeof item !== 'object') {
    return { ok: false, reason: 'invalid_item' };
  }
  const resolveId = (value) => (value === undefined || value === null) ? '' : String(value).trim();
  const item_id = resolveId(item.item_id ?? item.ItemID ?? item.itemId ?? item.id);
  const item_code = resolveId(item.item_code ?? item.ItemCode ?? item.itemCode ?? item.barcode ?? item.code);
  if (!item_id && !item_code) {
    return { ok: false, reason: 'no_identifier' };
  }
  const payload = {};
  if (item_id) {
    payload.item_id = item_id;
    payload.itemId = item_id;
    payload.ItemID = item_id;
  }
  if (item_code) {
    payload.item_code = item_code;
    payload.itemCode = item_code;
    payload.ItemCode = item_code;
  }
  const passthroughKeys = ['item_name', 'item_price', 'item_department', 'item_image', 'item_weight', 'item_ads', 'item_attribute', 'item_inventory'];
  for (const key of passthroughKeys) {
    if (item[key] !== undefined) {
      payload[key] = item[key];
    }
  }
  const cfg = await getConfig();
  const normalizedGroup = (group !== undefined && group !== null && !Number.isNaN(Number(group))) ? Number(group) : undefined;
  if (isUpliFlavor(cfg)) {
    const body = { req: 'update_item', ...payload };
    if (normalizedGroup !== undefined) body.group = normalizedGroup;
    return await mcgRequestUpli(body);
  }

  const { base, version, extraHeaderName, extraHeaderValue } = cfg;
  const url = `${base}/api/${version}/update_item`;
  let token = await getAccessToken();
  const body = { ...payload, ...(normalizedGroup !== undefined ? { group: normalizedGroup } : {}) };
  try {
    const resp = await axios.post(url, body, withMcgTransport(cfg, {
      headers: { 'Content-Type': 'application/json', ...buildAuthHeader(token), ...(extraHeaderName && extraHeaderValue ? { [extraHeaderName]: extraHeaderValue } : {}) },
      timeout: 20000
    }));
    return resp?.data || { ok: true };
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401) {
      token = await fetchAccessToken();
      const resp2 = await axios.post(url, body, withMcgTransport(cfg, {
        headers: { 'Content-Type': 'application/json', ...buildAuthHeader(token), ...(extraHeaderName && extraHeaderValue ? { [extraHeaderName]: extraHeaderValue } : {}) },
        timeout: 20000
      }));
      return resp2?.data || { ok: true };
    }
    let detail = '';
    try {
      const d = e?.response?.data;
      if (d && typeof d === 'object') detail = d.message || d.error || '';
      else if (typeof e?.response?.data === 'string') detail = e.response.data;
    } catch {}
    const err = new Error(`MCG update_item failed${status ? ` (${status})` : ''}${detail ? `: ${String(detail).slice(0,160)}` : ''}`);
    err.status = status;
    throw err;
  }
}

export async function deleteItems(items = [], group) {
  if (!Array.isArray(items) || !items.length) return { ok: false, reason: 'no_items' };
  const cfg = await getConfig();
  const cleanItems = [];
  const seen = new Set();
  for (const it of items) {
    if (!it) continue;
    const item_code = (it.item_code ?? it.itemCode ?? it.ItemCode ?? it.barcode ?? '') + '';
    const item_id = (it.item_id ?? it.itemId ?? it.ItemID ?? it.id ?? '') + '';
    const code = item_code.trim();
    const id = item_id.trim();
    if (!code && !id) continue;
    const key = `${code}::${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const payload = {};
    if (code) {
      payload.item_code = code;
      payload.itemCode = code;
      payload.ItemCode = code;
    }
    if (id) {
      payload.item_id = id;
      payload.itemId = id;
      payload.ItemID = id;
    }
    cleanItems.push(payload);
  }
  if (!cleanItems.length) return { ok: false, reason: 'no_valid_items' };

  const normalizedGroup = (group !== undefined && group !== null && !Number.isNaN(Number(group))) ? Number(group) : undefined;

  if (isUpliFlavor(cfg)) {
    const body = { req: 'delete_items', items: cleanItems };
    if (normalizedGroup !== undefined) body.group = normalizedGroup;
    return await mcgRequestUpli(body);
  }

  const { base, version, extraHeaderName, extraHeaderValue } = cfg;
  const url = `${base}/api/${version}/delete_items`;
  let token = await getAccessToken();
  try {
    const resp = await axios.post(url, { items: cleanItems, ...(normalizedGroup !== undefined ? { group: normalizedGroup } : {}) }, withMcgTransport(cfg, {
      headers: { 'Content-Type': 'application/json', ...buildAuthHeader(token), ...(extraHeaderName && extraHeaderValue ? { [extraHeaderName]: extraHeaderValue } : {}) },
      timeout: 20000
    }));
    return resp?.data || { ok: true };
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401) {
      token = await fetchAccessToken();
      const resp2 = await axios.post(url, { items: cleanItems, ...(normalizedGroup !== undefined ? { group: normalizedGroup } : {}) }, withMcgTransport(cfg, {
        headers: { 'Content-Type': 'application/json', ...buildAuthHeader(token), ...(extraHeaderName && extraHeaderValue ? { [extraHeaderName]: extraHeaderValue } : {}) },
        timeout: 20000
      }));
      return resp2?.data || { ok: true };
    }
    let detail = '';
    try {
      const d = e?.response?.data;
      if (d && typeof d === 'object') {
        detail = d.message || d.error || d.Message || '';
      } else if (typeof e?.response?.data === 'string') {
        detail = String(e.response.data).slice(0, 160).replace(/\s+/g, ' ').trim();
      }
    } catch {}
    const err = new Error(`MCG delete_items failed${status ? ` (${status})` : ''}${detail ? `: ${detail}` : ''}`);
    err.status = status;
    throw err;
  }
}

export default { getItemsList, getVersion, updateItemsQuantities, setItemsList, deleteItems };
