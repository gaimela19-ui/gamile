import axios from 'axios';
import https from 'https';
import dns from 'dns';
import Settings from '../models/Settings.js';

// --- Settings loader ---
export async function loadSettings() {
	let s = await Settings.findOne();
	if (!s) s = await Settings.create({});
	return s;
}

// --- Helpers ---
function coalesce(...vals) {
	for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
	return undefined;
}

function maskToken(t) {
	if (!t) return '';
	const str = String(t);
	if (str.length <= 6) return '***';
	return str.slice(0, 3) + '***' + str.slice(-3);
}

function normalizeICreditUrl(u) {
	let url = String(u || '').trim();
	if (!url) url = 'https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl';
	// remove whitespace and duplicate slashes
	url = url.replace(/\s+/g, '').replace(/([^:])\/+/g, '$1/');
	// ensure ends with GetUrl
	if (!/PaymentPageRequest\.svc\/(?:json\/)?GetUrl$/i.test(url)) {
		// If points to the service root, append GetUrl
		if (/PaymentPageRequest\.svc$/i.test(url)) url += '/GetUrl';
		else url = url.replace(/\/$/, '') + '/API/PaymentPageRequest.svc/GetUrl';
	}
	return url;
}

export function buildICreditCandidates(base) {
	const list = new Set();
	const b = normalizeICreditUrl(base);
	const add = (x) => list.add(x.replace(/\s+/g, ''));
	// As-provided
	add(b);
	// JSON subpath variants
	add(b.replace(/\/GetUrl$/i, '/json/GetUrl'));
	add(b.replace(/\/GetUrl$/i, '/JSON/GetUrl'));
	// Host variants (prod/test)
	add(b.replace('://icredit.rivhit.co.il/', '://testicredit.rivhit.co.il/'));
	add(b.replace('://testicredit.rivhit.co.il/', '://icredit.rivhit.co.il/'));
	// If someone configured service root without json
	add(b.replace(/PaymentPageRequest\.svc\/(?:json\/)?GetUrl$/i, 'PaymentPageRequest.svc/json/GetUrl'));
	return Array.from(list).filter(Boolean);
}

function resolveTransport(settings) {
	const env = String(process.env.ICREDIT_TRANSPORT || '').trim().toLowerCase();
	if (env && ['json', 'soap', 'auto'].includes(env)) return env;
	const s = String(settings?.payments?.icredit?.transport || 'auto').toLowerCase();
	return ['json', 'soap', 'auto'].includes(s) ? s : 'auto';
}

function pickAgent() {
	const insecure = String(process.env.ICREDIT_INSECURE_TLS || '').trim() === '1';
	const forceIpv4 = String(process.env.ICREDIT_FORCE_IPV4 || '').trim() === '1';
	const options = { rejectUnauthorized: !insecure };
	if (forceIpv4) {
		options.lookup = (hostname, opts, cb) => dns.lookup(hostname, { family: 4 }, cb);
	}
	return new https.Agent(options);
}

function perAttemptTimeout() {
	const max = Number(process.env.ICREDIT_PER_ATTEMPT_MAX_MS) || 20000;
	const min = Number(process.env.ICREDIT_PER_ATTEMPT_MIN_MS) || 10000;
	return Math.max(5000, Math.min(max, min > 0 ? max : 20000));
}

export function buildICreditRequest({ order, settings, overrides = {} }) {
	const cfg = settings?.payments?.icredit || {};
	const token = String(cfg.groupPrivateToken || '').trim();
	const req = {};
	req.GroupPrivateToken = overrides.GroupPrivateToken || token;

	// Items mapping
	const items = Array.isArray(order?.items) ? order.items : [];
	req.Items = items.map((it) => ({
		Id: 0,
		CatalogNumber: coalesce(it.sku, it.CatalogNumber, ''),
		UnitPrice: Number(coalesce(it.price, it.UnitPrice, 0)) || 0,
		Quantity: Number(coalesce(it.quantity, it.Quantity, 1)) || 1,
		Description: coalesce(it.name, it.Description, '')
	}));

		// Redirects and notifications
		req.RedirectURL = overrides.RedirectURL || cfg.redirectURL || '';
		// Prefer explicit override or configured IPN URL; fall back to settings.apiBaseUrl if present
		let ipn = overrides.IPNURL || cfg.ipnURL || '';
		if (!ipn) {
			const apiBase = (settings && (settings.apiBaseUrl || settings.apiBaseURL)) || process.env.API_BASE_URL || '';
			if (apiBase) {
				const base = String(apiBase).replace(/\/$/, '');
				ipn = `${base}/api/payments/icredit/ipn`;
			}
		}
		req.IPNURL = ipn;

	// Financials
	req.ExemptVAT = typeof overrides.ExemptVAT === 'boolean' ? overrides.ExemptVAT : !!cfg.exemptVAT;
	req.MaxPayments = Number(coalesce(overrides.MaxPayments, cfg.maxPayments, 1)) || 1;
	req.CreditFromPayment = Number(coalesce(overrides.CreditFromPayment, cfg.creditFromPayment, 0)) || 0;
	req.Discount = Number(coalesce(overrides.Discount, cfg.defaultDiscount, 0)) || 0;
	req.HideItemList = typeof overrides.HideItemList === 'boolean' ? overrides.HideItemList : !!cfg.hideItemList;

	// Customer/contact
	const ci = order?.customerInfo || {};
	const addr = order?.shippingAddress || {};
	req.EmailAddress = overrides.EmailAddress || ci.email || '';
	req.CustomerFirstName = overrides.CustomerFirstName || ci.firstName || '';
	req.CustomerLastName = overrides.CustomerLastName || ci.lastName || '';
	req.Address = overrides.Address || addr.street || '';
	req.City = overrides.City || addr.city || '';
	req.POB = Number(overrides.POB || 0) || 0;
	req.Zipcode = Number(overrides.Zipcode || 0) || 0;
	req.PhoneNumber = overrides.PhoneNumber || ci.mobile || '';
	req.PhoneNumber2 = overrides.PhoneNumber2 || (ci.secondaryMobile || '');
	req.FaxNumber = overrides.FaxNumber || '';
	req.IdNumber = Number(overrides.IdNumber || 0) || 0;
	req.VatNumber = Number(overrides.VatNumber || 0) || 0;

	// Meta
	const ref = String(coalesce(overrides.Reference, order?.orderNumber, '') || '').trim();
	req.Reference = ref || undefined;
	req.Order = overrides.Order || (ref ? `Online Order #${ref}` : undefined);
	req.Comments = overrides.Comments || (ref ? `Order #${ref}` : '');
	req.DocumentLanguage = overrides.DocumentLanguage || cfg.documentLanguage || 'he';
	req.CreateToken = typeof overrides.CreateToken === 'boolean' ? overrides.CreateToken : !!cfg.createToken;
	req.EmailBcc = overrides.EmailBcc || cfg.emailBcc || '';
	req.Custom1 = coalesce(overrides.Custom1, String(order?._id || '')) || '';
	req.Custom2 = overrides.Custom2 || '';
	req.Custom3 = overrides.Custom3 || '';
	req.Custom4 = overrides.Custom4 || '';
	req.Custom5 = overrides.Custom5 || '';
	req.Custom6 = overrides.Custom6 || '';
	req.Custom7 = overrides.Custom7 || '';
	req.Custom8 = overrides.Custom8 || '';
	req.Custom9 = overrides.Custom9 || '';
	req.CustomerId = Number(overrides.CustomerId || 0) || 0;
	req.AgentId = Number(overrides.AgentId || 0) || 0;
	req.ProjectId = Number(overrides.ProjectId || 0) || 0;

	// Some iCredit setups expect the originating Client IP
	if (typeof overrides.IPAddress === 'string' && overrides.IPAddress) {
		req.IPAddress = overrides.IPAddress;
	}

	// Prune undefined keys to keep payload clean
	Object.keys(req).forEach((k) => {
		if (req[k] === undefined) delete req[k];
	});
	return req;
}

function parseICreditResponse(resp) {
	// Accept string body with URL, or JSON objects with Url/url/d or nested d.Url
	const data = resp?.data;
	if (typeof data === 'string') {
		const s = data.trim().replace(/^"|"$/g, '');
		if (/^https?:\/\//i.test(s)) return s;
	}
	if (data && typeof data === 'object') {
		const url = data.Url || data.url || data.URL || data.d || (data.data && (data.data.Url || data.data.url));
		if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
	}
	// Some WCF JSON implementations return { d: "..." }
	if (data && typeof data === 'object' && typeof data.d === 'string' && /^https?:\/\//i.test(data.d)) return data.d;
	// Try response text if axios didn't parse JSON
	const text = typeof resp?.data === 'string' ? resp.data : (typeof resp?.request?.res?.text === 'string' ? resp.request.res.text : null);
	if (text && /^https?:\/\//i.test(text.trim().replace(/^"|"$/g, ''))) return text.trim().replace(/^"|"$/g, '');
	return '';
}

async function postJson(url, body, timeoutMs) {
	const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' };
	const agent = pickAgent();
	return axios.post(url, body, { timeout: timeoutMs, headers, httpsAgent: agent, validateStatus: () => true });
}

export async function requestICreditPaymentUrl({ order, settings, overrides = {} }) {
	const s = settings || (await loadSettings());
	const cfg = s?.payments?.icredit || {};
	if (!cfg?.enabled) {
		const e = new Error('iCredit disabled in settings'); e.status = 412; throw e;
	}
	const token = String(cfg.groupPrivateToken || '').trim();
	if (!token && !overrides.GroupPrivateToken) {
		const e = new Error('Missing GroupPrivateToken'); e.status = 412; throw e;
	}
	const forceTest = String(process.env.ICREDIT_FORCE_TEST || '').trim() === '1';

	let base = normalizeICreditUrl(cfg.apiUrl || 'https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl');
	if (forceTest) base = base.replace('://icredit.rivhit.co.il/', '://testicredit.rivhit.co.il/');
	const candidates = buildICreditCandidates(base);

	const payload = buildICreditRequest({ order, settings: s, overrides });
	const timeoutMs = perAttemptTimeout();
	const transport = resolveTransport(s);

		let lastErr = null;
		const jsonErrors = [];
	for (let i = 0; i < candidates.length; i++) {
		const url = candidates[i];
		try {
			const resp = await postJson(url, payload, timeoutMs);
			const status = resp?.status || 0;
			if (status >= 200 && status < 300) {
				const href = parseICreditResponse(resp);
				if (href && /^https?:\/\//i.test(href)) return { url: href };
				const e = new Error('iCredit returned unexpected response format'); e.status = 400; throw e;
			}
			// Treat 400 with HTML body as bad path – try next variant
			const ct = resp?.headers?.['content-type'] || resp?.headers?.['Content-Type'] || '';
			const bodyStr = typeof resp?.data === 'string' ? resp.data : '';
			const looksHtml = /text\/html/i.test(ct) || /<html|Request Error|The incoming message has an unexpected message format/i.test(String(bodyStr));
			if (looksHtml) {
					const err = new Error(`HTML error at ${url} (${status})`);
					jsonErrors.push(err);
					lastErr = err;
				continue;
			}
			// Surface JSON error message if present
			let detail = '';
			try {
				const d = resp?.data;
				if (d && typeof d === 'object') {
					const m = d.message || d.error || d.Error || d.debug_message || d.client_message || d.detail;
					if (m) detail = `: ${m}`;
				} else if (typeof resp?.data === 'string') {
					const snip = resp.data.slice(0, 160).replace(/\s+/g, ' ').trim();
					if (snip) detail = `: ${snip}`;
				}
			} catch {}
					const e = new Error(`iCredit request failed (${status})${detail}`); e.status = status; jsonErrors.push(e); throw e;
		} catch (err) {
			lastErr = err;
			// continue to next candidate
			continue;
		}
	}
			// If transport explicitly json, or we have no wish to try SOAP, throw now
			if (transport === 'json') {
				const e = lastErr || new Error('iCredit request failed');
				e.status = e.status || 400; throw e;
			}

			// --- SOAP fallback ---
			try {
				const bases = Array.from(new Set(candidates.map(u => u.replace(/\/PaymentPageRequest\.svc\/(?:json\/)?GetUrl$/i, '/PaymentPageRequest.svc'))));
				const agent = pickAgent();
				const bodyXmlFields = Object.entries(payload).map(([k, v]) => {
					if (k === 'Items' && Array.isArray(v)) {
						const itemsXml = v.map(it => (
							`        <Item>\n`+
							`          <Id>${Number(it.Id || 0)}</Id>\n`+
							`          <CatalogNumber>${String(it.CatalogNumber || '')}</CatalogNumber>\n`+
							`          <UnitPrice>${Number(it.UnitPrice || 0)}</UnitPrice>\n`+
							`          <Quantity>${Number(it.Quantity || 1)}</Quantity>\n`+
							`          <Description>${String(it.Description || '')}</Description>\n`+
							`        </Item>`
						)).join('\n');
						return `      <Items>\n${itemsXml}\n      </Items>`;
					}
					return `      <${k}>${String(v)}</${k}>`;
				}).join('\n');

				// Try both forms: direct params and wrapped <request>
				const bodyVariants = [
					// Wrapped in <request>
					`    <GetUrl xmlns=\"http://tempuri.org/\">\n      <request>\n${bodyXmlFields}\n      </request>\n    </GetUrl>`,
					// Direct
					`    <GetUrl xmlns=\"http://tempuri.org/\">\n${bodyXmlFields}\n    </GetUrl>`
				];
				const headersVariants = [
					{ 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'http://tempuri.org/IPaymentPageRequest/GetUrl' },
					{ 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'http://tempuri.org/GetUrl' },
					{ 'Content-Type': 'text/xml; charset=utf-8' }
				];

				for (const baseSvc of bases) {
					for (const body of bodyVariants) {
						const envelope = `<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<soap:Envelope xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\">\n  <soap:Body>\n${body}\n  </soap:Body>\n</soap:Envelope>`;
								for (const h of headersVariants) {
							try {
										const resp = await axios.post(baseSvc, envelope, { timeout: timeoutMs, httpsAgent: agent, headers: h, maxRedirects: 0, validateStatus: () => true });
										const st = resp.status || 0;
										// Handle 3xx redirects by reading Location header (some WCF setups redirect to hosted page URL)
										if (st >= 300 && st < 400) {
											const loc = resp.headers?.location || resp.headers?.Location;
											if (loc && /^https?:\/\//i.test(String(loc))) return { url: String(loc) };
										}
										if (st >= 200 && st < 300) {
									const xml = String(resp.data || '');
									// Extract any https URL present in the response
									const m = xml.match(/https?:\/\/[^<\s]+/i);
									if (m && m[0]) return { url: m[0] };
								}
									} catch (e2) {
										// If axios threw due to redirect limit but provided a response with Location, use it
										const r = e2?.response;
										const loc = r?.headers?.location || r?.headers?.Location;
										if (loc && /^https?:\/\//i.test(String(loc))) return { url: String(loc) };
										lastErr = e2; continue;
							}
						}
					}
				}
			} catch (soapErr) {
				lastErr = soapErr;
			}

			const e = lastErr || jsonErrors[0] || new Error('iCredit request failed');
			e.status = e.status || 400; throw e;
}

export async function diagnoseICreditConnectivity(baseUrl) {
	const candidates = buildICreditCandidates(baseUrl);
	const agent = pickAgent();
	const results = [];
	for (let i = 0; i < Math.min(6, candidates.length); i++) {
		const url = candidates[i];
		try {
			const resp = await axios.post(url, { GroupPrivateToken: 'X', Items: [], RedirectURL: 'https://example.com', MaxPayments: 1 }, { timeout: 5000, httpsAgent: agent, validateStatus: () => true });
			results.push({ url, status: resp.status, ok: resp.status > 0, contentType: resp.headers?.['content-type'] });
		} catch (e) {
			results.push({ url, ok: false, error: e?.message || String(e) });
		}
	}
	// Unique origins list for quick inspection
	const origins = Array.from(new Set(results.map(r => { try { const u = new URL(r.url); return `${u.protocol}//${u.host}`; } catch { return ''; } }).filter(Boolean)));
	return { base: normalizeICreditUrl(baseUrl), origins, results };
}

export async function pingICredit({ useRealToken = false } = {}) {
	const s = await loadSettings();
	const cfg = s?.payments?.icredit || {};
	const token = useRealToken ? (cfg.groupPrivateToken || '') : 'X';
	const base = normalizeICreditUrl(cfg.apiUrl || 'https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl');
	const list = buildICreditCandidates(base).slice(0, 4);
	const agent = pickAgent();
	const timeout = 7000;
	const attempts = [];
	for (const url of list) {
		const body = { GroupPrivateToken: token, Items: [{ Id: 0, CatalogNumber: 'PING', UnitPrice: 1, Quantity: 1, Description: 'Ping' }], RedirectURL: 'https://example.com', MaxPayments: 1 };
		try {
			const resp = await axios.post(url, body, { timeout, httpsAgent: agent, validateStatus: () => true });
			const ok = resp.status >= 200 && resp.status < 500; // 400 expected for bad token
			attempts.push({ url, status: resp.status, ok, token: maskToken(token), note: ok ? 'reachable' : 'unreachable' });
		} catch (e) {
			attempts.push({ url, ok: false, error: e?.message || String(e), token: maskToken(token) });
		}
	}
	const reachable = attempts.some(a => a.ok);
	return { ok: reachable, attempts };
}

export default {
	loadSettings,
	buildICreditRequest,
	buildICreditCandidates,
	requestICreditPaymentUrl,
	diagnoseICreditConnectivity,
	pingICredit
};

