import axios from 'axios';
import Settings from '../models/Settings.js';

// Normalize and sanitize base URL to Rivhit .svc endpoint (avoid double-method segments)
function normalizeApiBase(u) {
  let url = String(u || '').trim();
  if (!url) url = 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc';
  // remove whitespace and trailing slashes
  url = url.replace(/\s+/g, '').replace(/\/+$/, '');
  // strip accidental method segments or /JSON suffixes added by mistake
  url = url.replace(/\/(JSON|SOAP)\/(Item\.[A-Za-z]+|Status\.[A-Za-z]+|[A-Za-z_]+)$/i, '');
  url = url.replace(/\/(Item\.[A-Za-z]+|Status\.[A-Za-z]+|[A-Za-z_]+)$/i, '');
  // ensure ends with .svc
  if (!/\.svc$/i.test(url)) {
    if (/\/online$/i.test(url)) url += '/RivhitOnlineAPI.svc';
    else if (/rivhit\.co\.il\/online/i.test(url)) url += '/RivhitOnlineAPI.svc';
    else url += '/RivhitOnlineAPI.svc';
  }
  return url;
}

async function getConfig() {
  let s = await Settings.findOne();
  if (!s) s = await Settings.create({});
  const cfg = s.rivhit || {};
  const apiUrl = normalizeApiBase(cfg.apiUrl || 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc');
  // Support legacy/migrated key names too (cfg.token) and trim whitespace
  const token = String((cfg.tokenApi || cfg.token || process.env.RIVHIT_TOKEN || '')).trim();
  const defaultStorageId = Number(cfg.defaultStorageId || 0) || 0;
  const transport = cfg.transport === 'soap' ? 'soap' : 'json';
  return { enabled: !!cfg.enabled, apiUrl, token, defaultStorageId, transport };
}

// Validate configuration and inputs before attempting remote calls
function validateBeforeSend({ enabled, apiUrl, token }, { id_item, storage_id } = {}) {
  if (!enabled) {
    const e = new Error('Rivhit integration disabled by settings');
    e.code = 412; // precondition failed
    throw e;
  }
  if (!token || token.length < 10) {
    const e = new Error('Rivhit API token not configured (Settings.rivhit.tokenApi)');
    e.code = 412;
    throw e;
  }
  // Basic sanity on apiUrl
  if (!/rivhit\.co\.il/i.test(apiUrl) || !/RivhitOnlineAPI\.svc$/i.test(apiUrl)) {
    // Not throwing because normalizeApiBase should have fixed most issues, but warn loudly
    console.warn('[rivhit] Suspicious apiUrl after normalization:', apiUrl);
  }
  if (id_item !== undefined) {
    const n = Number(id_item);
    if (!Number.isFinite(n) || n <= 0) {
      const e = new Error('Invalid id_item (must be a positive number)');
      e.code = 400; throw e;
    }
  }
  if (storage_id !== undefined && storage_id !== null && storage_id !== '') {
    const ns = Number(storage_id);
    if (!Number.isFinite(ns) || ns < 0) {
      console.warn('[rivhit] Ignoring invalid storage_id value:', storage_id);
    }
  }
}

export async function testConnectivity() {
  const { enabled, apiUrl, token } = await getConfig();
  if (!enabled) return { ok: false, reason: 'disabled' };
  if (!token) return { ok: false, reason: 'missing_token' };
  // Perform a lightweight authenticated call that doesn't require id_item to verify token & base URL
  try {
    const url = apiUrl.replace(/\/$/, '') + '/Status.ErrorMessage';
    const body = { token_api: token, error_code: 0 };
    const resp = await axios.post(url, body, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' }
    });
    // If service returns JSON without transport errors, consider connectivity OK
    const data = resp?.data;
    if (typeof data === 'object') return { ok: true };
  } catch (e) {
    const status = e?.response?.status;
    let detail = '';
    try {
      const d = e?.response?.data;
      if (d && typeof d === 'object') {
        const dm = d.debug_message || d.client_message || d.message;
        if (dm) detail = `: ${dm}`;
      } else if (typeof e?.response?.data === 'string') {
        const snip = String(e.response.data).slice(0,160).replace(/\s+/g,' ').trim();
        if (snip) detail = `: ${snip}`;
      }
    } catch {}
    return { ok: false, reason: `status_error_message_failed${status?` (${status})`:''}${detail}` };
  }
  // Fallback: if response wasn't object but no exception was thrown
  return { ok: true };
}

export async function getLastRequest(format = 'json') {
  const { enabled, apiUrl, token } = await getConfig();
  if (!enabled) throw new Error('Rivhit integration disabled');
  if (!token) throw new Error('Rivhit API token not configured');
  const url = apiUrl + `/Status.LastRequest/${format}`;
  const resp = await axios.post(url, { token_api: token }, { timeout: 15000, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' } });
  return resp?.data || {};
}

export async function getErrorMessage(code, format = 'json') {
  const { enabled, apiUrl, token } = await getConfig();
  if (!enabled) throw new Error('Rivhit integration disabled');
  if (!token) throw new Error('Rivhit API token not configured');
  const url = apiUrl + `/Status.ErrorMessage`;
  const body = { token_api: token, error_code: Number(code) };
  const resp = await axios.post(url, body, { timeout: 15000, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' } });
  return resp?.data || {};
}

// --- SOAP helpers ---
function buildSoapEnvelope(action, bodyXml) {
  return `<?xml version="1.0" encoding="utf-8"?>\n`+
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n`+
    `  <soap:Body>\n`+
    `    <${action} xmlns="https://api.rivhit.co.il/online/">\n`+
    bodyXml +
    `    </${action}>\n`+
    `  </soap:Body>\n`+
    `</soap:Envelope>`;
}

function xmlEscape(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function parseSoapQuantity(xml) {
  // Minimal extraction of <quantity>...</quantity> value
  const m = xml && String(xml).match(/<quantity>([-\d\.]+)<\/quantity>/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function maskToken(t) {
  if (!t) return '';
  const str = String(t);
  if (str.length <= 6) return '***';
  return str.slice(0,3) + '***' + str.slice(-3);
}

function looksLikeHtmlError(resp) {
  try {
    const ct = resp?.headers?.['content-type'] || resp?.headers?.['Content-Type'];
    if (ct && /text\/html/i.test(String(ct))) return true;
    const body = resp?.data;
    if (typeof body === 'string') {
      const s = body;
      return /<html|Request Error|The incoming message has an unexpected message format/i.test(s);
    }
  } catch {}
  return false;
}

function buildJsonMethodCandidates(base, method) {
  const b = base.replace(/\/$/, '');
  const noSvc = b.replace(/RivhitOnlineAPI\.svc$/i, '');
  // Try standard, JSON subpath, and service-root variants
  return [
    `${b}/${method}`,
    `${b}/JSON/${method}`,
    `${noSvc}/JSON/${method}`,
    `${noSvc}/${method}`
  ].filter((v, i, a) => a.indexOf(v) === i);
}

// Generate alternate base hosts commonly used by Rivhit to improve compatibility
function buildAlternateBases(apiUrl) {
  const u = String(apiUrl || '').trim();
  const bases = new Set([u]);
  try {
    const variants = [
      { from: /:\/\/api\.rivhit\.co\.il\//i, to: '://online.rivhit.co.il/' },
      { from: /:\/\/online\.rivhit\.co\.il\//i, to: '://api.rivhit.co.il/' },
      { from: /:\/\/app\.rivhit\.co\.il\//i, to: '://online.rivhit.co.il/' },
      { from: /:\/\/api\.rivhit\.co\.il\//i, to: '://app.rivhit.co.il/' }
    ];
    variants.forEach(v => {
      const alt = u.replace(v.from, v.to);
      if (alt !== u) bases.add(alt);
    });
  } catch {}
  // Ensure normalized .svc termination on all
  const list = Array.from(bases).map(normalizeApiBase);
  return list.filter((v, i, a) => a.indexOf(v) === i);
}

async function postSoap(apiUrl, action, envelope, timeoutMs = 20000) {
  const headersList = [
    { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': `https://api.rivhit.co.il/online/${action}` },
    { 'Content-Type': 'text/xml; charset=utf-8' },
    { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': `http://tempuri.org/IRivhitOnlineAPI/${action}` }
  ];
  let lastErr = null;
  for (let i = 0; i < headersList.length; i++) {
    try {
      const resp = await axios.post(apiUrl, envelope, { timeout: timeoutMs, headers: headersList[i] });
      return resp;
    } catch (e) {
      lastErr = e;
      // try next header variant
    }
  }
  throw lastErr || new Error('SOAP request failed');
}

export async function getItemQuantity({ id_item, storage_id }) {
  const { enabled, apiUrl, token, defaultStorageId, transport } = await getConfig();
  // Preflight validation for migration/config errors before sending
  validateBeforeSend({ enabled, apiUrl, token }, { id_item, storage_id });
  const nItem = Number(id_item);
  const sid = typeof storage_id === 'number' ? storage_id : defaultStorageId;
  try {
    // Minimal debug to server logs without revealing token
    console.log('[rivhit][getItemQuantity] transport=%s url=%s id_item=%s storage_id=%s token=%s', transport, apiUrl, nItem, (sid||0), maskToken(token));
  } catch {}
  if (transport === 'soap') {
    const action = 'Item_Quantity'; // Rivhit SOAP method name (example)
    const inner = `      <token_api>${xmlEscape(token)}</token_api>\n      <id_item>${Number(id_item)}</id_item>` + (sid && Number.isFinite(sid) && sid > 0 ? `\n      <storage_id>${Number(sid)}</storage_id>` : '');
    const envelope = buildSoapEnvelope(action, `\n${inner}\n`);
    const url = apiUrl;
    try {
      const resp = await postSoap(url, action, envelope, 20000);
      const xml = resp?.data || '';
      const quantity = parseSoapQuantity(xml);
      return { quantity };
    } catch (err) {
      const r = err?.response;
      const status = r?.status;
      const e = new Error(`Rivhit SOAP request failed${status ? ` (${status})` : ''}`);
      e.code = status || 0;
      throw e;
    }
  } else {
  // Rivhit endpoints in the wild use both token_api/api_token and id_item/item_id.
  // Send both aliases to be maximally compatible across deployments.
  const idVal = Number(id_item);
  const body = { token_api: token, api_token: token, id_item: idVal, item_id: idVal };
    if (sid && Number.isFinite(sid) && sid > 0) body.storage_id = sid;

    // Try across alternate base hosts and JSON path variants
    const bases = buildAlternateBases(apiUrl);
    let lastErr = null;
    for (let bIdx = 0; bIdx < bases.length; bIdx++) {
      const base = bases[bIdx];
      const candidates = buildJsonMethodCandidates(base, 'Item.Quantity');
      for (let i = 0; i < candidates.length; i++) {
        const url = candidates[i];
        try {
          const resp = await axios.post(url, body, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' }
          });
          const data = resp?.data || {};
          if (typeof data?.error_code === 'number' && data.error_code !== 0) {
            const msg = data?.client_message || data?.debug_message || 'Rivhit error';
            const err = new Error(msg);
            err.code = data.error_code;
            throw err;
          }
          const qty = data?.data?.quantity;
          return { quantity: typeof qty === 'number' ? qty : 0 };
        } catch (err) {
          const r = err?.response;
          const status = r?.status;
          const isHtml = looksLikeHtmlError(r);
          lastErr = err;
          if (isHtml) {
            // Try next JSON variant or next base
            const moreVariants = i < candidates.length - 1;
            const moreBases = bIdx < bases.length - 1;
            console.warn(`[rivhit] JSON call returned HTML at %s; %s`, url, moreVariants ? `trying next variant (${i + 2}/${candidates.length})` : (moreBases ? `trying alternate base host (${bIdx + 2}/${bases.length})` : 'no more variants'));
            continue;
          }
          // Non-HTML error: bubble with hint but keep looping bases for robustness on host mismatch
          if (bIdx < bases.length - 1) {
            console.warn(`[rivhit] JSON call failed at %s status=%s; trying alternate base host (%d/%d)`, url, status || 'n/a', bIdx + 2, bases.length);
            continue;
          }
          // Try to surface more details from server response when possible
          let detail = '';
          try {
            if (r?.data && typeof r.data === 'object') {
              const dm = r.data.debug_message || r.data.client_message || r.data.message;
              if (dm) detail = `: ${dm}`;
            } else if (typeof r?.data === 'string') {
              const snip = String(r.data).slice(0, 160).replace(/\s+/g, ' ').trim();
              if (snip) detail = `: ${snip}`;
            }
          } catch {}
          const hint = ' (verify token_api, id_item, storage_id and API URL)';
          const e = new Error(`Rivhit request failed${status ? ` (${status})` : ''}${detail || ''}${hint}`);
          e.code = status || 0;
          throw e;
        }
      }
    }

    // JSON failed on all variants – try SOAP on alternate bases as well
    try {
      console.warn('[rivhit] JSON call returned HTML or failed on all variants; attempting SOAP fallback on alternate bases');
      const action = 'Item_Quantity';
      const inner = `      <token_api>${xmlEscape(token)}</token_api>\n      <id_item>${nItem}</id_item>` + (sid && Number.isFinite(sid) && sid > 0 ? `\n      <storage_id>${Number(sid)}</storage_id>` : '');
      const envelope = buildSoapEnvelope(action, `\n${inner}\n`);
      const basesForSoap = buildAlternateBases(apiUrl);
      for (let bIdx = 0; bIdx < basesForSoap.length; bIdx++) {
        try {
          const resp2 = await postSoap(basesForSoap[bIdx], action, envelope, 20000);
          const xml = resp2?.data || '';
          const quantity = parseSoapQuantity(xml);
          return { quantity };
        } catch (e) {
          lastErr = e;
          continue;
        }
      }
      const e2 = new Error('Rivhit 400 error (Request Error – JSON and SOAP both failed)');
      e2.code = 400; throw e2;
    } catch (e) {
      throw e;
    }
  }
}

export async function updateItem({ id_item, storage_id, ...fields }) {
  const { enabled, apiUrl, token, defaultStorageId, transport } = await getConfig();
  // Preflight validation for migration/config errors before sending
  validateBeforeSend({ enabled, apiUrl, token }, { id_item, storage_id });
  const nItem = Number(id_item);
  const sid = typeof storage_id === 'number' ? storage_id : defaultStorageId;
  try {
    console.log('[rivhit][updateItem] transport=%s url=%s id_item=%s storage_id=%s token=%s fields=%s', transport, apiUrl, nItem, (sid||0), maskToken(token), Object.keys(fields||{}).join(','));
  } catch {}
  if (transport === 'soap') {
    const action = 'Item_Update'; // Rivhit SOAP method name (example)
    const fieldsXml = Object.entries(fields).map(([k,v]) => `      <${k}>${xmlEscape(v)}</${k}>`).join('\n');
    const inner = `      <token_api>${xmlEscape(token)}</token_api>\n      <id_item>${Number(id_item)}</id_item>` + (sid && Number.isFinite(sid) && sid > 0 ? `\n      <storage_id>${Number(sid)}</storage_id>` : '') + (fieldsXml ? `\n${fieldsXml}` : '');
    const envelope = buildSoapEnvelope(action, `\n${inner}\n`);
    const url = apiUrl;
    try {
      const resp = await postSoap(url, action, envelope, 25000);
      const xml = resp?.data || '';
      // Consider any 200 a success unless explicit fault detected
      if (/<faultstring>/i.test(String(xml))) {
        const m = String(xml).match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
        const msg = m ? m[1] : 'Rivhit SOAP fault';
        const e = new Error(msg);
        e.code = 0;
        throw e;
      }
      return { update_success: true };
    } catch (err) {
      const r = err?.response;
      const status = r?.status;
      const e = new Error(`Rivhit SOAP request failed${status ? ` (${status})` : ''}`);
      e.code = status || 0;
      throw e;
    }
  } else {
  // Send both legacy and current key names for compatibility
  const idVal2 = Number(id_item);
  const body = { token_api: token, api_token: token, id_item: idVal2, item_id: idVal2, ...fields };
    if (sid && Number.isFinite(sid) && sid > 0) body.storage_id = sid;
    const bases = buildAlternateBases(apiUrl);
    let lastErr = null;
    for (let bIdx = 0; bIdx < bases.length; bIdx++) {
      const base = bases[bIdx];
      const candidates = buildJsonMethodCandidates(base, 'Item.Update');
      for (let i = 0; i < candidates.length; i++) {
        const url = candidates[i];
        try {
          const resp = await axios.post(url, body, {
            timeout: 20000,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' }
          });
          const data = resp?.data || {};
          if (typeof data?.error_code === 'number' && data.error_code !== 0) {
            const msg = data?.client_message || data?.debug_message || 'Rivhit error';
            const err = new Error(msg);
            err.code = data.error_code;
            throw err;
          }
          return { update_success: !!data?.data?.update_success };
        } catch (err) {
          const r = err?.response;
          const status = r?.status;
          const isHtml = looksLikeHtmlError(r);
          lastErr = err;
          if (isHtml) {
            const moreVariants = i < candidates.length - 1;
            const moreBases = bIdx < bases.length - 1;
            console.warn(`[rivhit] JSON update returned HTML at %s; %s`, url, moreVariants ? `trying next variant (${i + 2}/${candidates.length})` : (moreBases ? `trying alternate base host (${bIdx + 2}/${bases.length})` : 'no more variants'));
            continue;
          }
          if (bIdx < bases.length - 1) {
            console.warn(`[rivhit] JSON update failed at %s status=%s; trying alternate base host (%d/%d)`, url, status || 'n/a', bIdx + 2, bases.length);
            continue;
          }
          const hint = ' (verify token_api, id_item, fields and API URL)';
          const e = new Error(`Rivhit request failed${status ? ` (${status})` : ''}${hint}`);
          e.code = status || 0;
          throw e;
        }
      }
    }
    // SOAP fallback across base hosts
    try {
      console.warn('[rivhit] JSON update failed on all variants; attempting SOAP fallback on alternate bases');
      const action = 'Item_Update';
      const fieldsXml = Object.entries(fields).map(([k,v]) => `      <${k}>${xmlEscape(v)}</${k}>`).join('\n');
      const inner = `      <token_api>${xmlEscape(token)}</token_api>\n      <id_item>${nItem}</id_item>` + (sid && Number.isFinite(sid) && sid > 0 ? `\n      <storage_id>${Number(sid)}</storage_id>` : '') + (fieldsXml ? `\n${fieldsXml}` : '');
      const envelope = buildSoapEnvelope(action, `\n${inner}\n`);
      const basesForSoap = buildAlternateBases(apiUrl);
      for (let bIdx = 0; bIdx < basesForSoap.length; bIdx++) {
        try {
          await postSoap(basesForSoap[bIdx], action, envelope, 25000);
          return { update_success: true };
        } catch (e) {
          lastErr = e; continue;
        }
      }
      const e2 = new Error('Rivhit 400 error (Request Error – JSON and SOAP both failed)'); e2.code = 400; throw e2;
    } catch (e) {
      throw e;
    }
  }
}

export default {
  getItemQuantity,
  updateItem,
  testConnectivity,
  getLastRequest,
  getErrorMessage
};

// List items from Rivhit (Item.List) with JSON transport
export async function listItems({ page, page_size } = {}) {
  const { enabled, apiUrl, token, transport } = await getConfig();
  if (!enabled) throw new Error('Rivhit integration disabled');
  if (!token) throw new Error('Rivhit API token not configured');
  if (transport === 'soap') {
    // This build supports Item.List via JSON only for simplicity
    throw new Error('Item.List supported only with JSON transport');
  }
  const bases = buildAlternateBases(apiUrl);
  const body = { token_api: token, api_token: token };
  if (Number.isFinite(Number(page)) && Number(page) > 0) body.page = Number(page);
  if (Number.isFinite(Number(page_size)) && Number(page_size) > 0) body.page_size = Number(page_size);
  let lastErr = null;
  for (let bIdx = 0; bIdx < bases.length; bIdx++) {
    const base = bases[bIdx];
    const candidates = buildJsonMethodCandidates(base, 'Item.List');
    for (let i = 0; i < candidates.length; i++) {
      const url = candidates[i];
      try {
        const resp = await axios.post(url, body, {
          timeout: 25000,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' }
        });
        const raw = resp?.data || {};
        if (typeof raw?.error_code === 'number' && raw.error_code !== 0) {
          const msg = raw?.client_message || raw?.debug_message || 'Rivhit error';
          const err = new Error(msg); err.code = raw.error_code; throw err;
        }
        // Rivhit responses can shape items in several ways: data.item_list, data.items, items, item_list, or data as array
        const payload = (raw && typeof raw === 'object' && raw.data !== undefined) ? raw.data : raw;
        let items = [];
        if (Array.isArray(payload?.items)) items = payload.items;
        else if (Array.isArray(payload?.item_list)) items = payload.item_list;
        else if (Array.isArray(raw?.items)) items = raw.items;
        else if (Array.isArray(raw?.item_list)) items = raw.item_list;
        else if (Array.isArray(payload)) items = payload;
        // As a last resort, if payload has a single key pointing to an array, use it
        if (!Array.isArray(items)) {
          try {
            const firstArrayKey = Object.keys(payload || {}).find(k => Array.isArray(payload[k]));
            if (firstArrayKey) items = payload[firstArrayKey];
          } catch {}
        }
        if (!Array.isArray(items)) items = [];
        return items;
      } catch (err) {
        lastErr = err;
        const isHtml = looksLikeHtmlError(err?.response);
        if (!isHtml && bIdx < bases.length - 1) {
          // try next base host
          continue;
        }
        // otherwise try next variant or fall through
      }
    }
  }
  const e = new Error('Failed to fetch Rivhit Item.List');
  e.code = lastErr?.code || lastErr?.response?.status || 0;
  throw e;
}

// Include named export in default export for convenience if some code imports default
export const __rivhitServiceExtras = { listItems };
