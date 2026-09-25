import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { adminAuth, auth } from '../middleware/auth.js';
import Settings from '../models/Settings.js';
import Inventory from '../models/Inventory.js';
import { ensureCloudinaryConfig, hasCloudinaryCredentials } from '../services/cloudinaryConfigService.js';
import cloudinary from '../services/cloudinaryClient.js';

const fsp = fs.promises;

const router = express.Router();

// Helper: convert relative asset path (e.g. /uploads/xxx.png) to absolute URL for client consumption
function toAbsolute(req, url) {
  if (!url) return url;
  // Already absolute (http/https) OR inline / blob data – leave untouched
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  try {
    const protoHeader = (req.headers['x-forwarded-proto'] || '').toString();
    const proto = protoHeader.split(',')[0] || req.protocol || 'http';
    const host = (req.headers['x-forwarded-host'] || req.get('host') || '').toString().split(',')[0];
    if (!host) return url; // fallback – return as-is
    return `${proto}://${host}${url.startsWith('/') ? '' : '/'}${url}`;
  } catch {
    return url;
  }
}

// Normalize multilingual city rows used for checkout city table
const normalizeCityRow = (entry) => {
  const trim = (val) => typeof val === 'string' ? val.trim() : '';
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const ar = trim(entry.ar);
    const en = trim(entry.en);
    const he = trim(entry.he);
    const areaGroup = trim(entry.areaGroup ?? entry.area_group ?? entry.group ?? entry.region);
    if (ar || en || he) {
      return { ar, en, he, areaGroup };
    }
    const fallback = trim(entry.label || entry.name || entry.city || entry.value);
    if (fallback) {
      return { ar: fallback, en: '', he: '', areaGroup };
    }
    return null;
  }
  const str = trim(entry);
  if (!str) return null;
  return { ar: str, en: '', he: '', areaGroup: '' };
};

const canonicalCityValue = (row) => (row?.ar || row?.en || row?.he || '').trim();

const buildCityTable = (checkoutForm) => {
  if (!checkoutForm) return [];
  const raw = Array.isArray(checkoutForm.cityTable) && checkoutForm.cityTable.length
    ? checkoutForm.cityTable
    : (Array.isArray(checkoutForm.cities) ? checkoutForm.cities : []);
  const seen = new Set();
  const rows = [];
  raw.forEach(entry => {
    const normalized = normalizeCityRow(entry);
    if (!normalized) return;
    const key = `${normalized.ar}|${normalized.en}|${normalized.he}|${normalized.areaGroup || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(normalized);
  });
  return rows;
};

const SLOT_PATTERN = /^\d{2}:\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const normalizeSlotList = (arr) => {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(v => (v == null ? '' : String(v).trim()))
    .filter(Boolean)
    .filter(v => SLOT_PATTERN.test(v));
};

const normalizeDateList = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => (v == null ? '' : String(v).trim()))
    .filter(Boolean)
    .filter(v => DATE_PATTERN.test(v));
};

const normalizeDateSlotOverrides = (input) => {
  if (!input || typeof input !== 'object') return {};
  const source = input instanceof Map ? Object.fromEntries(input) : input;
  return Object.entries(source).reduce((acc, [date, slots]) => {
    if (!DATE_PATTERN.test(date)) return acc;
    const normalizedSlots = normalizeSlotList(slots);
    if (!normalizedSlots.length) return acc;
    acc[date] = normalizedSlots;
    return acc;
  }, {});
};

// Configure multer for uploads (project-level /uploads)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const projectRoot = path.resolve(__dirname, '..', '..');
const sharedLocalesDir = path.join(projectRoot, 'shared', 'locales');
const publicLocalesDir = path.join(projectRoot, 'public', 'locales');
const mobileLocalesDir = path.join(projectRoot, 'mobile', 'mobile-app', 'src', 'locales');
const LOCALE_FILE_NAME = 'translation.json';
const LANG_PATTERN = /^[a-z0-9_-]{2,32}$/i;

const toPosix = (value = '') => value.replace(/\\/g, '/');
const relToProject = (absPath) => toPosix(path.relative(projectRoot, absPath));
const pathExists = (target) => {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
};
const statIfExists = async (target) => {
  try {
    return await fsp.stat(target);
  } catch {
    return null;
  }
};
async function writeJsonAtomic(destPath, contents) {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.${Date.now()}.tmp`;
  await fsp.writeFile(tmpPath, contents, 'utf8');
  await fsp.rename(tmpPath, destPath);
}

const buildLocaleMeta = (filePath, stat) => ({
  path: relToProject(filePath),
  exists: !!stat,
  updatedAt: stat ? stat.mtime.toISOString() : null,
  bytes: stat?.size || 0
});

async function collectLocaleLanguages() {
  const langs = new Set();
  const scan = async (dir) => {
    if (!pathExists(dir)) return;
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      entries.forEach(entry => {
        if (entry.isDirectory()) langs.add(entry.name);
      });
    } catch {}
  };
  await Promise.all([
    scan(sharedLocalesDir),
    scan(publicLocalesDir),
    scan(mobileLocalesDir)
  ]);
  return Array.from(langs).sort((a, b) => a.localeCompare(b));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

const localeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 } // 2 MB guard for translation bundles
});

const runLocaleUpload = (req, res, next) => {
  localeUpload.single('file')(req, res, (err) => {
    if (err) {
      const status = err?.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ message: err?.message || 'Upload failed' });
    }
    next();
  });
};

// Optional: allow non-admins to edit general settings when ALLOW_NON_ADMIN_SETTINGS=1
// This is intended for development only. Sensitive endpoints remain admin-only.
const settingsWriteGuard = process.env.ALLOW_NON_ADMIN_SETTINGS === '1' ? auth : adminAuth;

// Get store settings
router.get('/', async (req, res) => {
  try {
    console.log('[GET /api/settings] incoming', {
      time: new Date().toISOString(),
      ip: req.ip,
      ua: req.headers['user-agent'],
      auth: req.header('Authorization') ? 'present' : 'none',
      origin: req.headers.origin || '',
      referer: req.headers.referer || ''
    });
  } catch {}
  try {
    let settings = await Settings.findOne().sort({ updatedAt: -1 });
    if (!settings) {
      settings = await Settings.create({});
    }
    // Do not leak secrets when returning settings publicly
    const obj = settings.toObject();
    if (obj.cloudinary && obj.cloudinary.apiSecret) {
      obj.cloudinary = {
        cloudName: obj.cloudinary.cloudName || '',
        apiKey: obj.cloudinary.apiKey ? '***' : '',
        apiSecret: obj.cloudinary.apiSecret ? '***' : ''
      };
    }
    if (obj.payments) {
      if (obj.payments.paypal) {
        obj.payments.paypal = {
          enabled: !!obj.payments.paypal.enabled,
          mode: obj.payments.paypal.mode || 'sandbox',
          clientId: obj.payments.paypal.clientId ? obj.payments.paypal.clientId : '',
          secret: obj.payments.paypal.secret ? '***' : ''
        };
      }
      if (obj.payments.icredit) {
        obj.payments.icredit = {
          enabled: !!obj.payments.icredit.enabled,
          apiUrl: obj.payments.icredit.apiUrl || 'https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl',
          groupPrivateToken: obj.payments.icredit.groupPrivateToken ? '***' : '',
          redirectURL: obj.payments.icredit.redirectURL || '',
          ipnURL: obj.payments.icredit.ipnURL || '',
          exemptVAT: !!obj.payments.icredit.exemptVAT,
          maxPayments: Number.isFinite(Number(obj.payments.icredit.maxPayments)) ? Number(obj.payments.icredit.maxPayments) : 1,
          creditFromPayment: Number(obj.payments.icredit.creditFromPayment) || 0,
          documentLanguage: obj.payments.icredit.documentLanguage || 'he',
          createToken: !!obj.payments.icredit.createToken,
          hideItemList: !!obj.payments.icredit.hideItemList,
          emailBcc: obj.payments.icredit.emailBcc || '',
          defaultDiscount: Number(obj.payments.icredit.defaultDiscount) || 0
        };
      }
      if (obj.payments.visibility) {
        obj.payments.visibility = {
          card: !!obj.payments.visibility.card,
          cod: !!obj.payments.visibility.cod,
          paypal: !!obj.payments.visibility.paypal
        };
      }
    }
    if (obj.googleAuth) {
      obj.googleAuth = {
        enabled: !!obj.googleAuth.enabled,
        clientId: obj.googleAuth.clientId || '',
        secretSet: !!(obj.googleAuth.clientSecret && obj.googleAuth.clientSecret.length > 0)
      };
      delete obj.googleAuth.clientSecret;
    }
    if (obj.facebookAuth) {
      obj.facebookAuth = {
        enabled: !!obj.facebookAuth.enabled,
        appId: obj.facebookAuth.appId || '',
        secretSet: !!(obj.facebookAuth.appSecret && obj.facebookAuth.appSecret.length > 0),
        graphVersion: obj.facebookAuth.graphVersion || ''
      };
      delete obj.facebookAuth.appSecret;
    }
    // Translations (DeepSeek): mask secret
    if (obj.translations && obj.translations.deepseek) {
      obj.translations = obj.translations || {};
      obj.translations.deepseek = {
        enabled: !!obj.translations.deepseek.enabled,
        apiKey: obj.translations.deepseek.apiKey ? '***' : '',
        apiUrl: obj.translations.deepseek.apiUrl || '',
        model: obj.translations.deepseek.model || ''
      };
    }
    // Normalize favicon (and optionally logo) to absolute so other-origins (Netlify) can load it
    try {
  if (obj.favicon) obj.favicon = toAbsolute(req, obj.favicon);
  if (obj.logo && obj.logo.startsWith('/uploads/')) obj.logo = toAbsolute(req, obj.logo);
  if (obj.authBackgroundImage && obj.authBackgroundImage.startsWith('/uploads/')) obj.authBackgroundImage = toAbsolute(req, obj.authBackgroundImage);
  if (obj.headerBackgroundImage && obj.headerBackgroundImage.startsWith('/uploads/')) obj.headerBackgroundImage = toAbsolute(req, obj.headerBackgroundImage);
  if (obj.navBackgroundImage && obj.navBackgroundImage.startsWith('/uploads/')) obj.navBackgroundImage = toAbsolute(req, obj.navBackgroundImage);
  if (obj.announcementsBackgroundImage && obj.announcementsBackgroundImage.startsWith('/uploads/')) obj.announcementsBackgroundImage = toAbsolute(req, obj.announcementsBackgroundImage);
  // Global store background
  if (obj.storeBackgroundImage && obj.storeBackgroundImage.startsWith('/uploads/')) obj.storeBackgroundImage = toAbsolute(req, obj.storeBackgroundImage);
  if (obj.productDetailBackgroundImage && obj.productDetailBackgroundImage.startsWith('/uploads/')) obj.productDetailBackgroundImage = toAbsolute(req, obj.productDetailBackgroundImage);
  if (obj.productCardBackgroundImage && obj.productCardBackgroundImage.startsWith('/uploads/')) obj.productCardBackgroundImage = toAbsolute(req, obj.productCardBackgroundImage);
  if (obj.productImageBackgroundImage && obj.productImageBackgroundImage.startsWith('/uploads/')) obj.productImageBackgroundImage = toAbsolute(req, obj.productImageBackgroundImage);
  if (obj.categoryBackgroundImage && obj.categoryBackgroundImage.startsWith('/uploads/')) obj.categoryBackgroundImage = toAbsolute(req, obj.categoryBackgroundImage);
  if (obj.visitorPopup && obj.visitorPopup.backgroundImage && obj.visitorPopup.backgroundImage.startsWith('/uploads/')) {
    obj.visitorPopup.backgroundImage = toAbsolute(req, obj.visitorPopup.backgroundImage);
  }
  if (obj.visitorPopup && Array.isArray(obj.visitorPopup.records)) {
    obj.visitorPopup.records = obj.visitorPopup.records.map((record) => {
      if (!record || typeof record !== 'object') return record;
      const next = { ...record };
      if (typeof next.backgroundImage === 'string' && next.backgroundImage.startsWith('/uploads/')) {
        next.backgroundImage = toAbsolute(req, next.backgroundImage);
      }
      return next;
    });
  }
  // Normalize header icon background images
  if (obj.headerIconBackgrounds) {
    ['cart','wishlist','account','search','language','currency'].forEach(k => {
      const v = obj.headerIconBackgrounds?.[k]?.image;
      if (typeof v === 'string' && v.startsWith('/uploads/')) {
        obj.headerIconBackgrounds[k].image = toAbsolute(req, v);
      }
    });
  }
  // Normalize mobile tab bar icons
  if (obj.mobileTabBar) {
    const fix = (val) => (typeof val === 'string' && val.startsWith('/uploads/')) ? toAbsolute(req, val) : val;
    try {
      if (obj.mobileTabBar.home) {
        obj.mobileTabBar.home.active = fix(obj.mobileTabBar.home.active);
        obj.mobileTabBar.home.inactive = fix(obj.mobileTabBar.home.inactive);
      }
      if (obj.mobileTabBar.category) {
        obj.mobileTabBar.category.active = fix(obj.mobileTabBar.category.active);
        obj.mobileTabBar.category.inactive = fix(obj.mobileTabBar.category.inactive);
      }
      if (obj.mobileTabBar.cart) {
        obj.mobileTabBar.cart.active = fix(obj.mobileTabBar.cart.active);
        obj.mobileTabBar.cart.inactive = fix(obj.mobileTabBar.cart.inactive);
      }
      if (obj.mobileTabBar.me) {
        obj.mobileTabBar.me.active = fix(obj.mobileTabBar.me.active);
        obj.mobileTabBar.me.inactive = fix(obj.mobileTabBar.me.inactive);
      }
      if (obj.mobileTabBar.center) {
        obj.mobileTabBar.center.icon = fix(obj.mobileTabBar.center.icon);
      }
    } catch {}
  }
    } catch {}
    res.json(obj);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get DeepSeek translation config (admin only for full detail sans secret value)
router.get('/translations/deepseek', adminAuth, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    const ds = settings.translations?.deepseek || { enabled: false, apiKey: '', apiUrl: '', model: '' };
    res.json({
      enabled: !!ds.enabled,
      apiKey: ds.apiKey ? '***' : '',
      apiUrl: ds.apiUrl || '',
      model: ds.model || ''
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Update DeepSeek translation config (admin)
router.put('/translations/deepseek', adminAuth, async (req, res) => {
  try {
    let settings = await Settings.findOne().sort({ updatedAt: -1 });
    if (!settings) settings = new Settings();
    settings.translations = settings.translations || { deepseek: { enabled: false, apiKey: '', apiUrl: '', model: '' } };
    const incoming = req.body || {};
    const prevKey = settings.translations.deepseek?.apiKey || '';
    const next = {
      enabled: typeof incoming.enabled === 'undefined' ? !!settings.translations.deepseek?.enabled : !!incoming.enabled,
      apiKey: typeof incoming.apiKey === 'string' ? (incoming.apiKey === '***' ? prevKey : incoming.apiKey.trim()) : (settings.translations.deepseek?.apiKey || ''),
      apiUrl: typeof incoming.apiUrl === 'string' ? incoming.apiUrl.trim() : (settings.translations.deepseek?.apiUrl || ''),
      model: typeof incoming.model === 'string' ? incoming.model.trim() : (settings.translations.deepseek?.model || '')
    };
    settings.translations.deepseek = next;
    try { settings.markModified('translations'); } catch {}
    await settings.save();
    // Attempt to refresh in-memory DeepSeek config so changes take effect without restart
    try {
      const { loadDeepseekConfigFromDb } = await import('../services/translate/deepseek.js');
      await loadDeepseekConfigFromDb();
    } catch {}
    res.json({ enabled: next.enabled, apiKey: next.apiKey ? '***' : '', apiUrl: next.apiUrl, model: next.model });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Mobile app translation bundles (JSON) – list metadata
router.get('/translations/mobile/locales', adminAuth, async (req, res) => {
  try {
    const codes = await collectLocaleLanguages();
    const languages = [];
    for (const code of codes) {
      const sharedFile = path.join(sharedLocalesDir, code, LOCALE_FILE_NAME);
      const webFile = path.join(publicLocalesDir, code, LOCALE_FILE_NAME);
      const mobileFile = path.join(mobileLocalesDir, code, LOCALE_FILE_NAME);
      const [sharedStat, webStat, mobileStat] = await Promise.all([
        statIfExists(sharedFile),
        statIfExists(webFile),
        statIfExists(mobileFile)
      ]);
      languages.push({
        code,
        shared: buildLocaleMeta(sharedFile, sharedStat),
        web: buildLocaleMeta(webFile, webStat),
        mobile: buildLocaleMeta(mobileFile, mobileStat)
      });
    }
    res.json({
      sharedRoot: relToProject(sharedLocalesDir),
      webRoot: pathExists(publicLocalesDir) ? relToProject(publicLocalesDir) : null,
      mobileRoot: pathExists(mobileLocalesDir) ? relToProject(mobileLocalesDir) : null,
      languages
    });
  } catch (e) {
    res.status(500).json({ message: e?.message || 'Failed to read mobile locales' });
  }
});

// Upload JSON translation bundle for mobile/web (admin only)
router.post('/translations/mobile/upload', adminAuth, runLocaleUpload, async (req, res) => {
  try {
    const langInput = (req.body?.lang || '').trim();
    if (!langInput || !LANG_PATTERN.test(langInput)) {
      return res.status(400).json({ message: 'Language code must be 2-32 characters (letters, numbers, dash or underscore).' });
    }
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      return res.status(400).json({ message: 'JSON translation file is required.' });
    }
    const lang = langInput.toLowerCase();
    let parsed;
    try {
      parsed = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
      return res.status(400).json({ message: 'Invalid JSON file. Please upload a valid translation bundle.' });
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return res.status(400).json({ message: 'Translation JSON must be an object.' });
    }
    const normalizedJson = JSON.stringify(parsed, null, 2) + '\n';
    const bytes = Buffer.byteLength(normalizedJson, 'utf8');
    const sharedFile = path.join(sharedLocalesDir, lang, LOCALE_FILE_NAME);
    await writeJsonAtomic(sharedFile, normalizedJson);
    let webSynced = false;
    if (pathExists(publicLocalesDir)) {
      await writeJsonAtomic(path.join(publicLocalesDir, lang, LOCALE_FILE_NAME), normalizedJson);
      webSynced = true;
    }
    let mobileSynced = false;
    if (pathExists(mobileLocalesDir)) {
      await writeJsonAtomic(path.join(mobileLocalesDir, lang, LOCALE_FILE_NAME), normalizedJson);
      mobileSynced = true;
    }
    res.json({
      message: 'Locale uploaded',
      lang,
      sharedPath: relToProject(sharedFile),
      bytes,
      webSynced,
      mobileSynced
    });
  } catch (e) {
    console.error('[settings] mobile locale upload failed', e);
    res.status(500).json({ message: 'Failed to save translation file.' });
  }
});

router.get('/translations/mobile/download/:lang', adminAuth, async (req, res) => {
  try {
    const langInput = (req.params?.lang || req.query?.lang || '').trim();
    if (!langInput || !LANG_PATTERN.test(langInput)) {
      return res.status(400).json({ message: 'Invalid language code.' });
    }
    const lang = langInput.toLowerCase();
    const candidates = [
      path.join(sharedLocalesDir, lang, LOCALE_FILE_NAME),
      path.join(publicLocalesDir, lang, LOCALE_FILE_NAME),
      path.join(mobileLocalesDir, lang, LOCALE_FILE_NAME)
    ];
    let filePath = '';
    for (const candidate of candidates) {
      if (candidate && pathExists(candidate)) {
        filePath = candidate;
        break;
      }
    }
    if (!filePath) {
      return res.status(404).json({ message: 'Translation file not found for the requested language.' });
    }
    const downloadName = `${lang}-${LOCALE_FILE_NAME}`;
    return res.download(filePath, downloadName, (err) => {
      if (err) {
        if (!res.headersSent) {
          res.status(500).json({ message: 'Failed to download translation file.' });
        }
      }
    });
  } catch (e) {
    console.error('[settings] mobile locale download failed', e);
    return res.status(500).json({ message: 'Failed to download translation file.' });
  }
});

// Get analytics config (subset of settings)
router.get('/analytics', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }

    const analytics = {
      facebookPixel: settings.facebookPixel || { pixelId: '', enabled: false },
      googleAnalytics: settings.googleAnalytics || { trackingId: '', enabled: false },
      googleTagManager: settings.googleTagManager || { containerId: '', enabled: false },
      googleAds: settings.googleAds || { conversionId: '', conversionLabel: '', enabled: false },
      googleMerchantCenter: settings.googleMerchantCenter || { merchantId: '', enabled: false }
    };

    res.json(analytics);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Rivhit integration config (admin only)
router.get('/rivhit', adminAuth, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    const rv = settings.rivhit || { enabled: false, apiUrl: 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc', tokenApi: '', defaultStorageId: 0 };
    res.json({
      enabled: !!rv.enabled,
      apiUrl: rv.apiUrl || 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc',
      tokenApi: rv.tokenApi ? '***' : '',
      defaultStorageId: rv.defaultStorageId || 0
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/rivhit', adminAuth, async (req, res) => {
  try {
    let settings = await Settings.findOne().sort({ updatedAt: -1 });
    if (!settings) settings = new Settings();
    settings.rivhit = settings.rivhit || { enabled: false, apiUrl: 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc', tokenApi: '', defaultStorageId: 0 };
    const inc = req.body || {};
    if (typeof inc.enabled !== 'undefined') settings.rivhit.enabled = !!inc.enabled;
    if (typeof inc.apiUrl === 'string') settings.rivhit.apiUrl = inc.apiUrl.trim();
    if (typeof inc.defaultStorageId !== 'undefined') {
      const n = Number(inc.defaultStorageId);
      settings.rivhit.defaultStorageId = Number.isFinite(n) && n >= 0 ? n : 0;
    }
    if (typeof inc.tokenApi === 'string') {
      if (inc.tokenApi !== '***') settings.rivhit.tokenApi = inc.tokenApi.trim();
    }
    try { settings.markModified('rivhit'); } catch {}
    await settings.save();
    res.json({ enabled: settings.rivhit.enabled, apiUrl: settings.rivhit.apiUrl, tokenApi: settings.rivhit.tokenApi ? '***' : '', defaultStorageId: settings.rivhit.defaultStorageId || 0 });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Inventory settings: GET
router.get('/inventory', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    const inv = settings.inventory || {
      autoDecrementOnOrder: true,
      autoIncrementOnCancel: true,
      autoIncrementOnReturn: true,
      allowNegativeStock: true,
      reserveOnCheckout: true,
      reservationTTLMinutes: 15,
      lowStockThreshold: 5
    };
    res.json(inv);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Inventory settings: PUT (guarded like general settings)
router.put('/inventory', settingsWriteGuard, async (req, res) => {
  try {
    let settings = await Settings.findOne().sort({ updatedAt: -1 });
    if (!settings) settings = new Settings();
    settings.inventory = settings.inventory || {};
    const inc = req.body || {};
    const next = { ...settings.inventory };
    const coerceBool = (v, def) => (typeof v === 'undefined' ? def : !!v);
    const coerceNum = (v, def) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
    };
    next.autoDecrementOnOrder = coerceBool(inc.autoDecrementOnOrder, settings.inventory.autoDecrementOnOrder ?? true);
    next.autoIncrementOnCancel = coerceBool(inc.autoIncrementOnCancel, settings.inventory.autoIncrementOnCancel ?? true);
    next.autoIncrementOnReturn = coerceBool(inc.autoIncrementOnReturn, settings.inventory.autoIncrementOnReturn ?? true);
    next.allowNegativeStock = coerceBool(inc.allowNegativeStock, settings.inventory.allowNegativeStock ?? true);
    next.reserveOnCheckout = coerceBool(inc.reserveOnCheckout, settings.inventory.reserveOnCheckout ?? true);
    let ttl = coerceNum(inc.reservationTTLMinutes, settings.inventory.reservationTTLMinutes || 15);
    if (!(ttl >= 1 && ttl <= 1440)) ttl = 15;
    next.reservationTTLMinutes = ttl;
    const previousLowStockThreshold = Number(settings.inventory.lowStockThreshold || 5);
    let lowStockThreshold = coerceNum(inc.lowStockThreshold, settings.inventory.lowStockThreshold || 5);
    if (!(lowStockThreshold >= 1 && lowStockThreshold <= 100000)) lowStockThreshold = 5;
    next.lowStockThreshold = Math.round(lowStockThreshold);
    settings.inventory = next;
    try { settings.markModified('inventory'); } catch {}
    await settings.save();

    // Keep existing inventory rows aligned with the global low-stock setting so
    // Inventory tab status/threshold behavior matches Admin Settings exactly.
    if (next.lowStockThreshold !== Math.round(previousLowStockThreshold)) {
      const threshold = next.lowStockThreshold;
      await Inventory.updateMany(
        {},
        [
          {
            $set: {
              lowStockThreshold: threshold,
              status: {
                $switch: {
                  branches: [
                    { case: { $lte: ['$quantity', 0] }, then: 'out_of_stock' },
                    { case: { $lte: ['$quantity', threshold] }, then: 'low_stock' }
                  ],
                  default: 'in_stock'
                }
              },
              lastUpdated: '$$NOW'
            }
          }
        ]
      );
    }

    res.json(settings.inventory);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Grooming availability settings: GET (admin only)
router.get('/grooming', adminAuth, async (req, res) => {
  try {
    let settings = await Settings.findOne().sort({ updatedAt: -1 });
    if (!settings) settings = await Settings.create({});
    const g = settings.grooming || { useDateWhitelist: false, enabledDates: [], disabledDates: [], bookingWindowDays: 30 };
    const slots = normalizeSlotList(g.slots);
    // Normalize arrays and values
    const norm = {
      useDateWhitelist: !!g.useDateWhitelist,
      enabledDates: normalizeDateList(g.enabledDates),
      disabledDates: normalizeDateList(g.disabledDates),
      bookingWindowDays: Number(g.bookingWindowDays) || 30,
      slots: slots.length ? slots : ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00'],
      dateSlotOverrides: normalizeDateSlotOverrides(g.dateSlotOverrides),
      slotCapacity: Number(g.slotCapacity) > 0 ? Number(g.slotCapacity) : 4,
      showHeroBanner: g.showHeroBanner !== false,
      heroBannerImage: (() => {
        if (typeof g.heroBannerImage === 'string') {
          const trimmed = g.heroBannerImage.trim();
          return trimmed.length ? trimmed : null;
        }
        return null;
      })()
    };
    res.json(norm);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Grooming availability settings: PUT (guarded like general settings)
router.put('/grooming', settingsWriteGuard, async (req, res) => {
  try {
    let settings = await Settings.findOne().sort({ updatedAt: -1 });
    if (!settings) settings = new Settings();
    const inc = req.body || {};
    const sanitizedSlots = normalizeSlotList(inc.slots);
    const existingSlots = normalizeSlotList(settings.grooming?.slots);
    const slotsFinal = sanitizedSlots.length ? sanitizedSlots : (existingSlots.length ? existingSlots : ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00']);
    const nextOverrides = typeof inc.dateSlotOverrides === 'undefined'
      ? normalizeDateSlotOverrides(settings.grooming?.dateSlotOverrides)
      : normalizeDateSlotOverrides(inc.dateSlotOverrides);
    const next = {
      useDateWhitelist: !!inc.useDateWhitelist,
      enabledDates: normalizeDateList(inc.enabledDates),
      disabledDates: normalizeDateList(inc.disabledDates),
      bookingWindowDays: Number(inc.bookingWindowDays) > 0 ? Number(inc.bookingWindowDays) : (settings.grooming?.bookingWindowDays || 30),
      slots: slotsFinal,
      dateSlotOverrides: nextOverrides,
      slotCapacity: Number(inc.slotCapacity) > 0 ? Number(inc.slotCapacity) : (settings.grooming?.slotCapacity || 4),
      showHeroBanner: typeof inc.showHeroBanner === 'undefined'
        ? settings.grooming?.showHeroBanner !== false
        : !!inc.showHeroBanner,
      heroBannerImage: (() => {
        if (typeof inc.heroBannerImage === 'string') return inc.heroBannerImage.trim();
        if (inc.heroBannerImage === null) return '';
        const existing = settings.grooming?.heroBannerImage;
        return typeof existing === 'string' ? existing : '';
      })()
    };
    settings.grooming = next;
    try { settings.markModified('grooming'); } catch {}
    await settings.save();
    res.json(next);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Grooming availability settings (admin)
router.get('/grooming', adminAuth, async (req, res) => {
  try {
    let settings = await Settings.findOne().sort({ updatedAt: -1 });
    if (!settings) settings = await Settings.create({});
    const grooming = settings.grooming || { useDateWhitelist: false, enabledDates: [], disabledDates: [], bookingWindowDays: 30 };
    const slots = normalizeSlotList(grooming.slots);
    const enabledDates = normalizeDateList(grooming.enabledDates);
    const disabledDates = normalizeDateList(grooming.disabledDates);
    const overrides = normalizeDateSlotOverrides(grooming.dateSlotOverrides);
    res.json({
      ...grooming,
      enabledDates,
      disabledDates,
      dateSlotOverrides: overrides,
      slots: slots.length ? slots : ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00'],
      slotCapacity: Number(grooming.slotCapacity) > 0 ? Number(grooming.slotCapacity) : 4,
      showHeroBanner: grooming.showHeroBanner !== false,
      heroBannerImage: (() => {
        if (typeof grooming.heroBannerImage === 'string') {
          const trimmed = grooming.heroBannerImage.trim();
          return trimmed.length ? trimmed : null;
        }
        return null;
      })()
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.put('/grooming', settingsWriteGuard, async (req, res) => {
  try {
    let settings = await Settings.findOne().sort({ updatedAt: -1 });
    if (!settings) settings = new Settings();
    const inc = req.body || {};
    const existing = settings.grooming || { useDateWhitelist: false, enabledDates: [], disabledDates: [], bookingWindowDays: 30 };
    const sanitizedSlots = normalizeSlotList(inc.slots);
    const existingSlots = normalizeSlotList(existing.slots);
    const slotsFinal = sanitizedSlots.length ? sanitizedSlots : (existingSlots.length ? existingSlots : ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00']);
    const nextOverrides = typeof inc.dateSlotOverrides === 'undefined'
      ? normalizeDateSlotOverrides(existing.dateSlotOverrides)
      : normalizeDateSlotOverrides(inc.dateSlotOverrides);
    const next = {
      useDateWhitelist: typeof inc.useDateWhitelist === 'undefined' ? !!existing.useDateWhitelist : !!inc.useDateWhitelist,
      enabledDates: typeof inc.enabledDates === 'undefined' ? normalizeDateList(existing.enabledDates) : normalizeDateList(inc.enabledDates),
      disabledDates: typeof inc.disabledDates === 'undefined' ? normalizeDateList(existing.disabledDates) : normalizeDateList(inc.disabledDates),
      bookingWindowDays: (() => {
        if (typeof inc.bookingWindowDays === 'undefined') return Number(existing.bookingWindowDays) > 0 ? Number(existing.bookingWindowDays) : 30;
        const n = Number(inc.bookingWindowDays);
        return Number.isFinite(n) && n > 0 ? n : (Number(existing.bookingWindowDays) || 30);
      })(),
      slots: slotsFinal,
      dateSlotOverrides: nextOverrides,
      slotCapacity: (() => {
        if (typeof inc.slotCapacity === 'undefined') return Number(existing.slotCapacity) > 0 ? Number(existing.slotCapacity) : 4;
        const c = Number(inc.slotCapacity);
        if (!Number.isFinite(c) || c <= 0) return Number(existing.slotCapacity) > 0 ? Number(existing.slotCapacity) : 4;
        return Math.min(Math.max(1, Math.round(c)), 50);
      })(),
      showHeroBanner: typeof inc.showHeroBanner === 'undefined'
        ? existing.showHeroBanner !== false
        : !!inc.showHeroBanner,
      heroBannerImage: (() => {
        if (typeof inc.heroBannerImage === 'string') return inc.heroBannerImage.trim();
        if (inc.heroBannerImage === null) return '';
        const fallback = typeof existing.heroBannerImage === 'string' ? existing.heroBannerImage : '';
        return fallback;
      })()
    };
    settings.grooming = next;
    try { settings.markModified('grooming'); } catch {}
    await settings.save();
    res.json(next);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Dedicated endpoint to update only booking hero banner fields without touching other grooming settings
router.put('/grooming/hero', settingsWriteGuard, async (req, res) => {
  try {
    let settings = await Settings.findOne().sort({ updatedAt: -1 });
    if (!settings) settings = await Settings.create({});
    const inc = req.body || {};
    const grooming = settings.grooming || {};
    if (typeof inc.heroBannerImage === 'string') {
      const trimmed = inc.heroBannerImage.trim();
      grooming.heroBannerImage = trimmed;
    } else if (inc.heroBannerImage === null) {
      grooming.heroBannerImage = '';
    }
    if (typeof inc.showHeroBanner !== 'undefined') {
      grooming.showHeroBanner = !!inc.showHeroBanner;
    }
    settings.grooming = grooming;
    try { settings.markModified('grooming'); } catch {}
    await settings.save();
    const response = {
      heroBannerImage: (() => {
        if (typeof grooming.heroBannerImage === 'string') {
          const trimmed = grooming.heroBannerImage.trim();
          return trimmed.length ? trimmed : null;
        }
        return null;
      })(),
      showHeroBanner: grooming.showHeroBanner !== false
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({ message: error?.message || 'Failed to update hero banner' });
  }
});

// Lightweight version endpoint for polling (no secrets, minimal payload)
router.get('/version', async (req, res) => {
  try {
    let settings = await Settings.findOne().select('_id updatedAt logo logoWidthMobile logoMaxHeightMobile logoWidthDesktop');
    if (!settings) {
      settings = await Settings.create({});
    }
    const updatedAt = settings.updatedAt instanceof Date ? settings.updatedAt : new Date();
    // Version can be milliseconds timestamp; easy to compare client-side
    const version = updatedAt.getTime();

    // Conditional GET: honor If-None-Match/If-Modified-Since for lightweight polling
    const etag = `W/"ver-${version}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', updatedAt.toUTCString());
    res.setHeader('Cache-Control', 'no-cache');
    const inm = req.headers['if-none-match'];
    const ims = req.headers['if-modified-since'];
    const notModifiedByEtag = inm && String(inm) === etag;
    const notModifiedByTime = ims && new Date(ims).getTime() >= updatedAt.getTime();
    if (notModifiedByEtag || notModifiedByTime) {
      try { console.log('REQ GET /api/settings/version -> 304 (conditional)'); } catch {}
      return res.status(304).end();
    }

    res.json({ version, updatedAt: updatedAt.toISOString() });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get Facebook Pixel config
router.get('/analytics/facebook-pixel', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }

    const fb = settings.facebookPixel || { pixelId: '', enabled: false };
    res.json(fb);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update Facebook Pixel config (guarded; can be relaxed via env)
router.put('/analytics/facebook-pixel', settingsWriteGuard, async (req, res) => {
  try {
    const { pixelId = '', enabled = false } = req.body || {};

    // Basic validation: when enabled, require 15-16 digit numeric Pixel ID
    if (enabled && !/^\d{15,16}$/.test(String(pixelId))) {
      return res.status(400).json({ message: 'Invalid Facebook Pixel ID format' });
    }

    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
    }

    settings.facebookPixel = { pixelId: String(pixelId), enabled: Boolean(enabled) };
    await settings.save();

    res.json(settings.facebookPixel);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ 
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    } else {
      res.status(500).json({ message: error.message });
    }
  }
});

// Update store settings (guarded; can be relaxed via env)
router.put('/', settingsWriteGuard, async (req, res) => {
  try {
    console.log('[Settings PUT] Incoming payload:', req.body);
    // Always operate on the most recently updated Settings document to avoid splitting state
    let settings = await Settings.findOne().sort({ updatedAt: -1 });
    if (!settings) {
      settings = new Settings();
      console.log('[Settings PUT] Created new Settings document');
    }

    // Update settings
    // Preserve existing secrets when UI sends masked values like '***'
    const prevCloudinarySecret = settings?.cloudinary?.apiSecret;
    const prevCloudinaryKey = settings?.cloudinary?.apiKey;
    const prevPaypalSecret = settings?.payments?.paypal?.secret;
    // Preserve existing visibility so partial updates do not wipe other flags
    const prevVisibility = (settings?.payments?.visibility && typeof settings.payments.visibility === 'object')
      ? { ...settings.payments.visibility }
      : { card: true, cod: true, paypal: true };

    // Shallow assign for top-level scalars and simple objects
    Object.assign(settings, req.body);

    // Deep handling for known nested structures and secret preservation
    if (req.body && typeof req.body === 'object') {
      // Cloudinary (preserve existing apiSecret when omitted in partial updates)
      if (req.body.cloudinary && typeof req.body.cloudinary === 'object') {
        settings.cloudinary = settings.cloudinary || {};
        const incoming = req.body.cloudinary;
        if (typeof incoming.cloudName === 'string') settings.cloudinary.cloudName = incoming.cloudName;
        if (Object.prototype.hasOwnProperty.call(incoming, 'apiKey')) {
          if (typeof incoming.apiKey === 'string') {
            settings.cloudinary.apiKey = incoming.apiKey === '***' ? prevCloudinaryKey : incoming.apiKey;
          } else if (incoming.apiKey === null) {
            settings.cloudinary.apiKey = '';
          }
        } else if (typeof prevCloudinaryKey === 'string' && prevCloudinaryKey) {
          // apiKey not provided -> keep previous value instead of losing it
          settings.cloudinary.apiKey = prevCloudinaryKey;
        }
        if (Object.prototype.hasOwnProperty.call(incoming, 'apiSecret')) {
          if (typeof incoming.apiSecret === 'string') {
            settings.cloudinary.apiSecret = incoming.apiSecret === '***' ? prevCloudinarySecret : incoming.apiSecret;
          } else if (incoming.apiSecret === null) {
            settings.cloudinary.apiSecret = '';
          }
        } else if (typeof prevCloudinarySecret === 'string' && prevCloudinarySecret) {
          // apiSecret not provided -> keep previous value instead of losing it due to Object.assign overwrite
          settings.cloudinary.apiSecret = prevCloudinarySecret;
        }
        try { settings.markModified('cloudinary'); } catch {}
      }

      // Payments: PayPal
      if (req.body.payments && typeof req.body.payments === 'object') {
        settings.payments = settings.payments || {};
        // Handle paypal sub-object
        if (req.body.payments.paypal) {
          const incoming = req.body.payments.paypal || {};
          settings.payments.paypal = settings.payments.paypal || { enabled: false, mode: 'sandbox', clientId: '', secret: '' };
          if (typeof incoming.enabled !== 'undefined') settings.payments.paypal.enabled = !!incoming.enabled;
          if (typeof incoming.mode === 'string') settings.payments.paypal.mode = incoming.mode;
          if (typeof incoming.clientId === 'string') settings.payments.paypal.clientId = incoming.clientId;
          if (typeof incoming.secret === 'string') settings.payments.paypal.secret = incoming.secret === '***' ? prevPaypalSecret : incoming.secret;
        }
        // Handle visibility sub-object
        if (req.body.payments.visibility && typeof req.body.payments.visibility === 'object') {
          // Start from previous persisted visibility (not from a possibly partially-overwritten object)
          settings.payments.visibility = { ...prevVisibility };
          const vis = req.body.payments.visibility;
          // Basic validation: require booleans only
          ['card','cod','paypal'].forEach(k => {
            if (typeof vis[k] !== 'undefined') {
              if (typeof vis[k] !== 'boolean') {
                return res.status(400).json({ message: `payments.visibility.${k} must be a boolean` });
              }
              settings.payments.visibility[k] = vis[k];
            }
          });
        }
        try { settings.markModified('payments'); } catch {}
      }

      // Google Auth (includes optional clientSecret write-only)
      if (req.body.googleAuth && typeof req.body.googleAuth === 'object') {
        settings.googleAuth = settings.googleAuth || { enabled: false, clientId: '', clientSecret: '' };
        const incomingGA = req.body.googleAuth;
        if (typeof incomingGA.enabled !== 'undefined') settings.googleAuth.enabled = !!incomingGA.enabled;
        if (typeof incomingGA.clientId === 'string') settings.googleAuth.clientId = incomingGA.clientId.trim();
        if (typeof incomingGA.clientSecret === 'string') {
          // Mask preservation pattern: if UI sends '***' keep previous secret
          if (incomingGA.clientSecret === '***') {
            // preserve existing
          } else if (incomingGA.clientSecret === '') {
            settings.googleAuth.clientSecret = '';
          } else {
            settings.googleAuth.clientSecret = incomingGA.clientSecret.trim();
          }
        }
        try { settings.markModified('googleAuth'); } catch {}
      }

      // Facebook Auth (write-only appSecret)
      if (req.body.facebookAuth && typeof req.body.facebookAuth === 'object') {
        settings.facebookAuth = settings.facebookAuth || { enabled: false, appId: '', appSecret: '', graphVersion: '' };
        const incomingFB = req.body.facebookAuth;
        if (typeof incomingFB.enabled !== 'undefined') settings.facebookAuth.enabled = !!incomingFB.enabled;
        if (typeof incomingFB.appId === 'string') settings.facebookAuth.appId = incomingFB.appId.trim();
        if (typeof incomingFB.graphVersion === 'string') settings.facebookAuth.graphVersion = incomingFB.graphVersion.trim();
        if (typeof incomingFB.appSecret === 'string') {
          if (incomingFB.appSecret === '***') {
            // preserve existing
          } else if (incomingFB.appSecret === '') {
            settings.facebookAuth.appSecret = '';
          } else {
            settings.facebookAuth.appSecret = incomingFB.appSecret.trim();
          }
        }
        try { settings.markModified('facebookAuth'); } catch {}
      }

      // Facebook Pixel
      if (req.body.facebookPixel && typeof req.body.facebookPixel === 'object') {
        settings.facebookPixel = {
          ...(settings.facebookPixel || { pixelId: '', enabled: false }),
          ...req.body.facebookPixel
        };
        try { settings.markModified('facebookPixel'); } catch {}
      }

      // Google Analytics
      if (req.body.googleAnalytics && typeof req.body.googleAnalytics === 'object') {
        settings.googleAnalytics = {
          ...(settings.googleAnalytics || { trackingId: '', enabled: false }),
          ...req.body.googleAnalytics
        };
        try { settings.markModified('googleAnalytics'); } catch {}
      }

      // Google Tag Manager
      if (req.body.googleTagManager && typeof req.body.googleTagManager === 'object') {
        const incomingGtm = req.body.googleTagManager;
        const containerId = String(incomingGtm.containerId || '').trim();
        const enabled = !!incomingGtm.enabled;
        if (enabled && containerId && !/^GTM-[A-Z0-9]+$/i.test(containerId)) {
          return res.status(400).json({ message: 'Invalid Google Tag Manager container ID format' });
        }
        settings.googleTagManager = {
          ...(settings.googleTagManager || { containerId: '', enabled: false }),
          ...incomingGtm,
          containerId,
          enabled
        };
        try { settings.markModified('googleTagManager'); } catch {}
      }

      // Google Ads
      if (req.body.googleAds && typeof req.body.googleAds === 'object') {
        const incomingAds = req.body.googleAds;
        const conversionId = String(incomingAds.conversionId || '').trim();
        const conversionLabel = String(incomingAds.conversionLabel || '').trim();
        const enabled = !!incomingAds.enabled;
        if (enabled && conversionId && !/^AW-[0-9]+$/i.test(conversionId)) {
          return res.status(400).json({ message: 'Invalid Google Ads conversion ID format' });
        }
        settings.googleAds = {
          ...(settings.googleAds || { conversionId: '', conversionLabel: '', enabled: false }),
          ...incomingAds,
          conversionId,
          conversionLabel,
          enabled
        };
        try { settings.markModified('googleAds'); } catch {}
      }

      // Google Merchant Center
      if (req.body.googleMerchantCenter && typeof req.body.googleMerchantCenter === 'object') {
        const incomingMerchant = req.body.googleMerchantCenter;
        const merchantId = String(incomingMerchant.merchantId || '').trim();
        const enabled = !!incomingMerchant.enabled;
        if (enabled && merchantId && !/^\d{6,20}$/.test(merchantId)) {
          return res.status(400).json({ message: 'Invalid Google Merchant Center ID format' });
        }
        settings.googleMerchantCenter = {
          ...(settings.googleMerchantCenter || { merchantId: '', enabled: false }),
          ...incomingMerchant,
          merchantId,
          enabled
        };
        try { settings.markModified('googleMerchantCenter'); } catch {}
      }

      if (req.body.visitorPopup && typeof req.body.visitorPopup === 'object') {
        const incoming = req.body.visitorPopup;
        const prev = settings.visitorPopup || {};
        const clamp = (value, min, max, fallback) => {
          const num = Number(value);
          if (!Number.isFinite(num)) return fallback;
          return Math.min(max, Math.max(min, num));
        };
        const takeString = (value, fallback = '', limit = 200, allowEmpty = true) => {
          if (typeof value === 'string') {
            const trimmed = value.trim().slice(0, limit);
            if (!trimmed && !allowEmpty) return fallback;
            return trimmed;
          }
          return fallback;
        };
        const sanitizePlatform = (value, fallback = 'both') => {
          const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
          if (raw === 'web' || raw === 'mobile' || raw === 'both') return raw;
          const fb = typeof fallback === 'string' ? fallback.trim().toLowerCase() : '';
          if (fb === 'web' || fb === 'mobile' || fb === 'both') return fb;
          return 'both';
        };
        const sanitizePixelBase = (value, fallback = 'VisitorPopup') => {
          if (typeof value === 'string') {
            const cleaned = value.trim().slice(0, 40).replace(/[^0-9a-z_]/gi, '');
            if (cleaned) return cleaned;
          }
          if (typeof fallback === 'string') {
            const cleanedFallback = fallback.trim().slice(0, 40).replace(/[^0-9a-z_]/gi, '');
            if (cleanedFallback) return cleanedFallback;
          }
          return 'VisitorPopup';
        };
        const sanitizePopupRecord = (source, fallback = {}) => {
          const src = (source && typeof source === 'object') ? source : {};
          const fb = (fallback && typeof fallback === 'object') ? fallback : {};
          const fallbackId = takeString(fb.id, 'default', 80, false);
          const fallbackName = takeString(fb.name, 'Campaign', 80, false);
          const recordId = takeString(src.id, fallbackId || 'default', 80, false);
          const couponCode = (() => {
            const next = takeString(src.couponCode, typeof fb.couponCode === 'string' ? fb.couponCode : '', 80);
            return next ? next.toUpperCase() : '';
          })();
          return {
            id: recordId,
            name: takeString(src.name, fallbackName || 'Campaign', 80, false),
            enabled: typeof src.enabled === 'undefined' ? !!fb.enabled : !!src.enabled,
            fullScreenMode: typeof src.fullScreenMode === 'undefined' ? !!fb.fullScreenMode : !!src.fullScreenMode,
            platform: sanitizePlatform(src.platform, fb.platform || 'both'),
            showOnScroll: typeof src.showOnScroll === 'undefined' ? (typeof fb.showOnScroll === 'boolean' ? fb.showOnScroll : true) : !!src.showOnScroll,
            showExitIntent: typeof src.showExitIntent === 'undefined' ? (typeof fb.showExitIntent === 'boolean' ? fb.showExitIntent : true) : !!src.showExitIntent,
            frequencyDays: Math.round(clamp(src.frequencyDays, 1, 30, typeof fb.frequencyDays === 'number' ? fb.frequencyDays : 7)),
            scrollThreshold: Math.round(clamp(src.scrollThreshold, 0, 4000, typeof fb.scrollThreshold === 'number' ? fb.scrollThreshold : 360)),
            heading: takeString(src.heading, fb.heading || 'Register & get 10% OFF', 160, false),
            bodyAr: takeString(src.bodyAr, typeof fb.bodyAr === 'string' ? fb.bodyAr : '', 400),
            bodyHe: takeString(src.bodyHe, typeof fb.bodyHe === 'string' ? fb.bodyHe : '', 400),
            bodyEn: takeString(src.bodyEn, typeof fb.bodyEn === 'string' ? fb.bodyEn : '', 400),
            ctaLabel: takeString(src.ctaLabel, fb.ctaLabel || 'Register now', 80, false),
            ctaHref: takeString(src.ctaHref, fb.ctaHref || '/register', 400, false),
            couponCode,
            couponNote: takeString(src.couponNote, typeof fb.couponNote === 'string' ? fb.couponNote : '* Coupon applied automatically after you finish registering.', 400),
            pixelEventBase: sanitizePixelBase(src.pixelEventBase, fb.pixelEventBase || 'VisitorPopup'),
            accentColor: takeString(src.accentColor, fb.accentColor || '', 32),
            textColor: takeString(src.textColor, fb.textColor || '', 32),
            backgroundColor: takeString(src.backgroundColor, fb.backgroundColor || '', 32),
            backgroundImage: takeString(src.backgroundImage, fb.backgroundImage || '', 1000),
            headingColor: takeString(src.headingColor, fb.headingColor || '', 32),
            bodyColor: takeString(src.bodyColor, fb.bodyColor || '', 32),
            headingFontSize: Math.round(clamp(src.headingFontSize, 16, 72, typeof fb.headingFontSize === 'number' ? fb.headingFontSize : 32)),
            bodyFontSize: Math.round(clamp(src.bodyFontSize, 12, 32, typeof fb.bodyFontSize === 'number' ? fb.bodyFontSize : 16)),
            ctaFontSize: Math.round(clamp(src.ctaFontSize, 12, 32, typeof fb.ctaFontSize === 'number' ? fb.ctaFontSize : 18)),
            metaFontSize: Math.round(clamp(src.metaFontSize, 8, 24, typeof fb.metaFontSize === 'number' ? fb.metaFontSize : 12))
          };
        };
        const fallbackRecord = sanitizePopupRecord({
          ...prev,
          id: prev.activeRecordId || prev.id || 'default',
          name: prev.activeRecordName || prev.name || 'Default Campaign'
        });
        const incomingRecords = Array.isArray(incoming.records) ? incoming.records.slice(0, 50) : [];
        const prevRecords = Array.isArray(prev.records) ? prev.records : [];
        let records = incomingRecords
          .map((record, index) => sanitizePopupRecord(record, prevRecords[index] || fallbackRecord))
          .filter((record, index, arr) => record.id && arr.findIndex((r) => r.id === record.id) === index);
        if (!records.length) {
          records = [sanitizePopupRecord({
            ...incoming,
            id: incoming.id || prev.activeRecordId || prev.id || 'default',
            name: incoming.name || prev.activeRecordName || prev.name || 'Default Campaign'
          }, fallbackRecord)];
        }
        const requestedActiveId = takeString(incoming.activeRecordId, takeString(prev.activeRecordId, records[0]?.id || 'default', 80, false), 80, false);
        const activeRecord = records.find((record) => record.id === requestedActiveId) || records[0];
        settings.visitorPopup = {
          ...activeRecord,
          activeRecordId: activeRecord.id,
          activeRecordName: activeRecord.name,
          records
        };
        try { settings.markModified('visitorPopup'); } catch {}
      }

      // Social links
      if (req.body.socialLinks && typeof req.body.socialLinks === 'object') {
        settings.socialLinks = { ...(settings.socialLinks || {}), ...req.body.socialLinks };
        try { settings.markModified('socialLinks'); } catch {}
      }

      // Checkout form
      if (req.body.checkoutForm && typeof req.body.checkoutForm === 'object') {
        settings.checkoutForm = { ...(settings.checkoutForm || {}), ...req.body.checkoutForm };
        try { settings.markModified('checkoutForm'); } catch {}
      }

      // Shipping settings
      if (req.body.shipping && typeof req.body.shipping === 'object') {
        settings.shipping = settings.shipping || { fixedFeeEnabled: false, fixedFeeAmount: 0 };
        const s = req.body.shipping;
        if (typeof s.fixedFeeEnabled !== 'undefined') settings.shipping.fixedFeeEnabled = !!s.fixedFeeEnabled;
        if (typeof s.fixedFeeAmount !== 'undefined') {
          const num = Number(s.fixedFeeAmount);
          if (!isNaN(num) && num >= 0) settings.shipping.fixedFeeAmount = num;
        }
        // Free shipping threshold
        if (typeof s.freeShippingEnabled !== 'undefined') settings.shipping.freeShippingEnabled = !!s.freeShippingEnabled;
        if (typeof s.freeShippingMinSubtotal !== 'undefined') {
          const min = Number(s.freeShippingMinSubtotal);
          if (!isNaN(min) && min >= 0) settings.shipping.freeShippingMinSubtotal = min;
        }
        try { settings.markModified('shipping'); } catch {}
      }

      // Header icon configurations
      if (Object.prototype.hasOwnProperty.call(req.body, 'headerIcons')) {
        try { settings.markModified('headerIcons'); } catch {}
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'headerIconVariants')) {
        try { settings.markModified('headerIconVariants'); } catch {}
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'headerIconAssets')) {
        try { settings.markModified('headerIconAssets'); } catch {}
      }
      // Mobile home header toggles (messages/calendar)
      if (Object.prototype.hasOwnProperty.call(req.body, 'mobileHomeHeader')) {
        settings.mobileHomeHeader = { ...(settings.mobileHomeHeader || {}), ...req.body.mobileHomeHeader };
        try { settings.markModified('mobileHomeHeader'); } catch {}
      }
      // Simple boolean toggles
      if (Object.prototype.hasOwnProperty.call(req.body, 'showColorFilter')) {
        settings.showColorFilter = !!req.body.showColorFilter;
      }

      // Accessibility toggles
      if (req.body.a11y && typeof req.body.a11y === 'object') {
        settings.a11y = { ...(settings.a11y || {}), ...req.body.a11y };
        try { settings.markModified('a11y'); } catch {}
      }
    }

    await settings.save();

    // Optional singleton enforcement / pruning of duplicates
    try {
      const all = await Settings.find({}, '_id updatedAt').sort({ updatedAt: -1 });
      if (all.length > 1) {
        if (process.env.PRUNE_EXTRA_SETTINGS === '1') {
          const toDelete = all.slice(1).map(d => d._id);
            if (toDelete.length) {
              await Settings.deleteMany({ _id: { $in: toDelete } });
              console.warn(`[Settings] Pruned ${toDelete.length} older Settings documents to enforce singleton.`);
            }
        } else {
          console.warn(`[Settings] Detected ${all.length} Settings documents (expected 1). Set PRUNE_EXTRA_SETTINGS=1 to auto-prune older ones.`);
        }
      }
    } catch (e) {
      console.warn('[Settings] Duplicate detection/pruning skipped:', e.message);
    }

    // Emit real-time event to notify clients of settings change
    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({
          type: 'settings_updated',
          data: {
            // Currency default
            currency: settings.currency,
            // Send only fields that impact design/theme to avoid oversharing
            primaryColor: settings.primaryColor,
            secondaryColor: settings.secondaryColor,
            accentColor: settings.accentColor,
            searchBorderColor: settings.searchBorderColor,
            // Navigation styles
            navCategoryFontColor: settings.navCategoryFontColor,
            navCategoryFontSize: settings.navCategoryFontSize,
            navPanelFontColor: settings.navPanelFontColor,
            navPanelColumnActiveBgColor: settings.navPanelColumnActiveBgColor,
            navPanelAccentColor: settings.navPanelAccentColor,
            navPanelHeaderColor: settings.navPanelHeaderColor,
            fontFamily: settings.fontFamily,
            borderRadius: settings.borderRadius,
            buttonStyle: settings.buttonStyle,
            headerLayout: settings.headerLayout,
            headerBackgroundColor: settings.headerBackgroundColor,
            headerTextColor: settings.headerTextColor,
            headerBackgroundImage: settings.headerBackgroundImage,
            navBackgroundImage: settings.navBackgroundImage,
            announcementsBackgroundImage: settings.announcementsBackgroundImage,
            // Global store background
            storeBackgroundImage: settings.storeBackgroundImage ? toAbsolute(req, settings.storeBackgroundImage) : settings.storeBackgroundImage,
            storeBackgroundColor: settings.storeBackgroundColor,
            productDetailBackgroundColor: settings.productDetailBackgroundColor,
            productDetailBackgroundImage: settings.productDetailBackgroundImage ? toAbsolute(req, settings.productDetailBackgroundImage) : settings.productDetailBackgroundImage,
            productCardBackgroundColor: settings.productCardBackgroundColor,
            productCardBackgroundImage: settings.productCardBackgroundImage ? toAbsolute(req, settings.productCardBackgroundImage) : settings.productCardBackgroundImage,
            productImageBackgroundColor: settings.productImageBackgroundColor,
            productImageBackgroundImage: settings.productImageBackgroundImage ? toAbsolute(req, settings.productImageBackgroundImage) : settings.productImageBackgroundImage,
            categoryBackgroundColor: settings.categoryBackgroundColor,
            categoryBackgroundImage: settings.categoryBackgroundImage ? toAbsolute(req, settings.categoryBackgroundImage) : settings.categoryBackgroundImage,
            customCss: settings.customCss,
            headerIcons: settings.headerIcons,
            headerIconVariants: settings.headerIconVariants,
            headerIconBackgrounds: settings.headerIconBackgrounds,
            footerStyle: settings.footerStyle,
            productCardStyle: settings.productCardStyle,
            productGridStyle: settings.productGridStyle,
            showColorFilter: settings.showColorFilter,
            // Component behavior
            heroAutoplayMs: settings.heroAutoplayMs,
            // Scroll-to-top
            scrollTopBgColor: settings.scrollTopBgColor,
            scrollTopTextColor: settings.scrollTopTextColor,
            scrollTopHoverBgColor: settings.scrollTopHoverBgColor,
            scrollTopPingColor: settings.scrollTopPingColor,
            // Accessibility feature toggles
            a11y: settings.a11y,
            // SEO fields
            siteTitle: settings.siteTitle,
            siteDescription: settings.siteDescription,
            keywords: settings.keywords,
            socialLinks: settings.socialLinks,
            // Contact info fields
            phone: settings.phone,
            address: settings.address,
            addressLink: settings.addressLink,
            email: settings.email,
            name: settings.name,
            // Added logo & logo sizing so all clients update immediately when admin changes logo
            logo: settings.logo,
            logoWidthMobile: settings.logoWidthMobile,
            logoMaxHeightMobile: settings.logoMaxHeightMobile,
            logoWidthDesktop: settings.logoWidthDesktop,
            // Favicon
            favicon: settings.favicon ? toAbsolute(req, settings.favicon) : settings.favicon,
            // ATC theme colors (newly persisted)
            atcBgColor: settings.atcBgColor,
            atcTextColor: settings.atcTextColor,
            atcHoverBgColor: settings.atcHoverBgColor,
            // New Arrivals mobile theme
            newArrivalsMobileHeadingColor: settings.newArrivalsMobileHeadingColor,
            newArrivalsMobileTextColor: settings.newArrivalsMobileTextColor,
            newArrivalsMobileOverlayBg: settings.newArrivalsMobileOverlayBg,
            newArrivalsMobileProductNameColor: settings.newArrivalsMobileProductNameColor,
            newArrivalsMobileProductPriceColor: settings.newArrivalsMobileProductPriceColor,
            // New Arrivals banner
            newArrivalsBannerEnabled: settings.newArrivalsBannerEnabled,
            newArrivalsBannerImage: settings.newArrivalsBannerImage ? toAbsolute(req, settings.newArrivalsBannerImage) : settings.newArrivalsBannerImage,
            newArrivalsBannerHeading: settings.newArrivalsBannerHeading,
            newArrivalsBannerSubheading: settings.newArrivalsBannerSubheading,
            // Auth pages background image
            authBackgroundImage: settings.authBackgroundImage,
            // Auth provider toggles
            googleAuth: settings.googleAuth ? { enabled: !!settings.googleAuth.enabled, clientId: settings.googleAuth.clientId || '', secretSet: !!(settings.googleAuth.clientSecret && settings.googleAuth.clientSecret.length > 0) } : { enabled: false, clientId: '', secretSet: false },
            facebookAuth: settings.facebookAuth ? { enabled: !!settings.facebookAuth.enabled, appId: settings.facebookAuth.appId || '', secretSet: !!(settings.facebookAuth.appSecret && settings.facebookAuth.appSecret.length > 0), graphVersion: settings.facebookAuth.graphVersion || '' } : { enabled: false, appId: '', secretSet: false, graphVersion: '' }
          }
        });
      }
    } catch (e) {
      console.error('Failed to broadcast settings update:', e);
    }

    // Sanitize response like GET
    const savedObj = settings.toObject();
    try {
  if (savedObj.favicon) savedObj.favicon = toAbsolute(req, savedObj.favicon);
      if (savedObj.logo && savedObj.logo.startsWith('/uploads/')) savedObj.logo = toAbsolute(req, savedObj.logo);
  if (savedObj.authBackgroundImage && savedObj.authBackgroundImage.startsWith('/uploads/')) savedObj.authBackgroundImage = toAbsolute(req, savedObj.authBackgroundImage);
  if (savedObj.headerBackgroundImage && savedObj.headerBackgroundImage.startsWith('/uploads/')) savedObj.headerBackgroundImage = toAbsolute(req, savedObj.headerBackgroundImage);
  if (savedObj.navBackgroundImage && savedObj.navBackgroundImage.startsWith('/uploads/')) savedObj.navBackgroundImage = toAbsolute(req, savedObj.navBackgroundImage);
    if (savedObj.announcementsBackgroundImage && savedObj.announcementsBackgroundImage.startsWith('/uploads/')) savedObj.announcementsBackgroundImage = toAbsolute(req, savedObj.announcementsBackgroundImage);
      if (savedObj.storeBackgroundImage && savedObj.storeBackgroundImage.startsWith('/uploads/')) savedObj.storeBackgroundImage = toAbsolute(req, savedObj.storeBackgroundImage);
      if (savedObj.productDetailBackgroundImage && savedObj.productDetailBackgroundImage.startsWith('/uploads/')) savedObj.productDetailBackgroundImage = toAbsolute(req, savedObj.productDetailBackgroundImage);
      if (savedObj.productCardBackgroundImage && savedObj.productCardBackgroundImage.startsWith('/uploads/')) savedObj.productCardBackgroundImage = toAbsolute(req, savedObj.productCardBackgroundImage);
      if (savedObj.productImageBackgroundImage && savedObj.productImageBackgroundImage.startsWith('/uploads/')) savedObj.productImageBackgroundImage = toAbsolute(req, savedObj.productImageBackgroundImage);
      if (savedObj.categoryBackgroundImage && savedObj.categoryBackgroundImage.startsWith('/uploads/')) savedObj.categoryBackgroundImage = toAbsolute(req, savedObj.categoryBackgroundImage);
      if (savedObj.headerIconBackgrounds) {
        ['cart','wishlist','account','search','language','currency'].forEach(k => {
          const v = savedObj.headerIconBackgrounds?.[k]?.image;
          if (typeof v === 'string' && v.startsWith('/uploads/')) {
            savedObj.headerIconBackgrounds[k].image = toAbsolute(req, v);
          }
        });
      }
      if (savedObj.newArrivalsBannerImage && savedObj.newArrivalsBannerImage.startsWith('/uploads/')) savedObj.newArrivalsBannerImage = toAbsolute(req, savedObj.newArrivalsBannerImage);
    } catch {}
    if (savedObj.googleAuth) {
      savedObj.googleAuth = {
        enabled: !!savedObj.googleAuth.enabled,
        clientId: savedObj.googleAuth.clientId || '',
        secretSet: !!(savedObj.googleAuth.clientSecret && savedObj.googleAuth.clientSecret.length > 0)
      };
    }
    if (savedObj.facebookAuth) {
      savedObj.facebookAuth = {
        enabled: !!savedObj.facebookAuth.enabled,
        appId: savedObj.facebookAuth.appId || '',
        secretSet: !!(savedObj.facebookAuth.appSecret && savedObj.facebookAuth.appSecret.length > 0),
        graphVersion: savedObj.facebookAuth.graphVersion || ''
      };
    }
    // Ensure addressLink always present for clients (empty string fallback)
    if (typeof savedObj.addressLink === 'undefined') {
      savedObj.addressLink = '';
    }
    // Ensure a11y object exists in response
    if (!savedObj.a11y) savedObj.a11y = { showReadPageButton: true };
    res.json(savedObj);
  } catch (error) {
  console.error('[Settings PUT] Error:', error);
    if (error.name === 'ValidationError') {
      res.status(400).json({ 
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    } else {
      res.status(500).json({ message: error.message });
    }
  }
});

// Upload custom header icon asset (admin only)
router.post('/upload/header-icon/:key', adminAuth, upload.single('file'), async (req, res) => {
  try {
    const { key } = req.params; // cart|wishlist|account|search|language|currency
    const allowed = ['cart','wishlist','account','search','language','currency'];
    if (!allowed.includes(key)) {
      return res.status(400).json({ message: 'Invalid header icon key' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    // Default to local uploads path
    let finalUrl = `/uploads/${req.file.filename}`;
    const hasCloud = await hasCloudinaryCredentials();

    // Prefer Cloudinary when configured
    if (hasCloud) {
      try {
        await ensureCloudinaryConfig();
        const uploadResult = await cloudinary.uploader.upload(path.join(uploadDir, req.file.filename), {
          folder: `settings/header-icons/${key}`,
          resource_type: 'image',
          use_filename: true,
          unique_filename: false,
          overwrite: true
        });
        if (uploadResult?.secure_url) {
          finalUrl = uploadResult.secure_url;
          try { fs.unlinkSync(path.join(uploadDir, req.file.filename)); } catch {}
        }
      } catch (cloudErr) {
        console.warn('[header-icon] Cloudinary upload failed, keeping local file:', cloudErr.message);
      }
    }

    // If no Cloudinary configured, inline as data URI so it persists across restarts
    if (!hasCloud) {
      try {
        const filePath = path.join(uploadDir, req.file.filename);
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString('base64');
        const mime = req.file.mimetype || 'image/png';
        finalUrl = `data:${mime};base64,${b64}`;
        try { fs.unlinkSync(filePath); } catch {}
      } catch (inlineErr) {
        console.warn('[header-icon] Failed to inline image, using relative path:', inlineErr.message);
      }
    }

    settings.headerIconAssets = settings.headerIconAssets || {};
    settings.headerIconAssets[key] = finalUrl;
    settings.markModified('headerIconAssets');
    await settings.save();

    // Broadcast minimal update
    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        // Ensure absolute URL if still relative
        const val = settings.headerIconAssets[key];
        const absVal = /^data:|^https?:/i.test(val) ? val : toAbsolute(req, val);
        const payload = { ...(settings.headerIconAssets || {}) };
        payload[key] = absVal;
        broadcast({ type: 'settings_updated', data: { headerIconAssets: payload } });
      }
    } catch {}

    const responseUrl = /^data:|^https?:/i.test(finalUrl) ? finalUrl : toAbsolute(req, finalUrl);
    res.json({ key, url: responseUrl, stored: hasCloud ? 'cloudinary' : 'inline' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload header icon background image (admin only)
router.post('/upload/header-icon-bg/:key', adminAuth, upload.single('file'), async (req, res) => {
  try {
    const { key } = req.params; // cart|wishlist|account|search|language|currency
    const allowed = ['cart','wishlist','account','search','language','currency'];
    if (!allowed.includes(key)) {
      return res.status(400).json({ message: 'Invalid header icon key' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    let finalUrl = `/uploads/${req.file.filename}`;
    const hasCloudinaryCreds = await hasCloudinaryCredentials();
    if (hasCloudinaryCreds) {
      try {
        await ensureCloudinaryConfig();
        const uploadResult = await cloudinary.uploader.upload(path.join(uploadDir, req.file.filename), {
          folder: `settings/header-icons/${key}`,
          resource_type: 'image',
          use_filename: true,
          unique_filename: false,
          overwrite: true
        });
        if (uploadResult?.secure_url) {
          finalUrl = uploadResult.secure_url;
          try { fs.unlinkSync(path.join(uploadDir, req.file.filename)); } catch {}
        }
      } catch (cloudErr) {
        console.warn('[header-icon-bg] Cloudinary upload failed, keeping local file:', cloudErr.message);
      }
    }

    if (!hasCloudinaryCreds) {
      try {
        const filePath = path.join(uploadDir, req.file.filename);
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString('base64');
        const mime = req.file.mimetype || 'image/png';
        finalUrl = `data:${mime};base64,${b64}`;
        try { fs.unlinkSync(filePath); } catch {}
      } catch (inlineErr) {
        console.warn('[header-icon-bg] Failed to inline image, using relative path:', inlineErr.message);
      }
    }

    settings.headerIconBackgrounds = settings.headerIconBackgrounds || {};
    settings.headerIconBackgrounds[key] = settings.headerIconBackgrounds[key] || { color: '', image: '' };
    settings.headerIconBackgrounds[key].image = finalUrl;
    settings.markModified('headerIconBackgrounds');
    await settings.save();

    // Broadcast minimal update
    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        const payload = { ...settings.headerIconBackgrounds };
        // Ensure absolute for this one key if needed
        const maybeRel = payload?.[key]?.image;
        if (typeof maybeRel === 'string' && maybeRel.startsWith('/uploads/')) {
          payload[key].image = toAbsolute(req, maybeRel);
        }
        broadcast({ type: 'settings_updated', data: { headerIconBackgrounds: payload } });
      }
    } catch {}

    res.json({ key, url: toAbsolute(req, settings.headerIconBackgrounds[key].image), stored: hasCloudinaryCreds ? 'cloudinary' : 'inline' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload mobile tab bar icon (admin only)
// key: home.active|home.inactive|category.active|category.inactive|cart.active|cart.inactive|me.active|me.inactive|center.icon
router.post('/upload/mobile-tab-icon/:key', adminAuth, upload.single('file'), async (req, res) => {
  try {
    const { key } = req.params;
    const allowed = new Set([
      'home.active','home.inactive','category.active','category.inactive','cart.active','cart.inactive','me.active','me.inactive','center.icon'
    ]);
    if (!allowed.has(key)) {
      return res.status(400).json({ message: 'Invalid mobile tab icon key' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    // Store at /uploads/... (or data URI fallback if no persistent storage)
    let finalUrl = `/uploads/${req.file.filename}`;
    // Optional: if Cloudinary configured, upload there
    const hasCloud = await hasCloudinaryCredentials?.();
    if (hasCloud) {
      try {
        await ensureCloudinaryConfig();
        const folder = `settings/mobile-tabs/${key.replace(/\./g,'_')}`;
        const uploadResult = await cloudinary.uploader.upload(path.join(uploadDir, req.file.filename), {
          folder,
          resource_type: 'image',
          use_filename: true,
          unique_filename: false,
          overwrite: true
        });
        if (uploadResult?.secure_url) {
          finalUrl = uploadResult.secure_url;
          try { fs.unlinkSync(path.join(uploadDir, req.file.filename)); } catch {}
        }
      } catch (e) {
        console.warn('[mobile-tab-icon] Cloudinary upload failed; keeping local file:', e?.message);
      }
    } else {
      // Inline file so it survives ephemeral storages
      try {
        const filePath = path.join(uploadDir, req.file.filename);
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString('base64');
        const mime = req.file.mimetype || 'image/png';
        finalUrl = `data:${mime};base64,${b64}`;
        try { fs.unlinkSync(filePath); } catch {}
      } catch (inlineErr) {
        console.warn('[mobile-tab-icon] Failed to inline image, using relative path:', inlineErr.message);
      }
    }

    // Persist in settings.mobileTabBar at specified key
    settings.mobileTabBar = settings.mobileTabBar || {};
    const [section, field] = key.split('.');
    if (section === 'center' && field === 'icon') {
      settings.mobileTabBar.center = settings.mobileTabBar.center || {};
      settings.mobileTabBar.center.icon = finalUrl;
    } else {
      settings.mobileTabBar[section] = settings.mobileTabBar[section] || {};
      settings.mobileTabBar[section][field] = finalUrl;
    }
    settings.markModified('mobileTabBar');
    await settings.save();

    // Broadcast minimal update
    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'settings_updated', data: { mobileTabBar: settings.mobileTabBar } });
      }
    } catch {}

    // Respond with absolute URL for convenience
    const abs = (u) => (/^data:|^https?:/i.test(u) ? u : toAbsolute(req, u));
    return res.json({ key, url: abs(finalUrl) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update mobile tab bar config via JSON (admin only)
router.put('/mobile-tab', settingsWriteGuard, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    const incoming = req.body?.mobileTabBar || req.body;
    if (incoming && typeof incoming === 'object') {
      settings.mobileTabBar = { ...(settings.mobileTabBar || {}), ...incoming };
      settings.markModified('mobileTabBar');
      await settings.save();
    }
    res.json(settings.mobileTabBar || {});
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Update labels/icons for mobile tabs (admin or relaxed guard)
router.put('/mobile-tab/labels', settingsWriteGuard, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    const incoming = req.body || {};
    const merge = (section) => {
      if (!incoming[section]) return;
      settings.mobileTabBar = settings.mobileTabBar || {};
      settings.mobileTabBar[section] = settings.mobileTabBar[section] || {};
      ['label','ionActive','ionInactive'].forEach(k => {
        if (typeof incoming[section][k] === 'string') settings.mobileTabBar[section][k] = incoming[section][k];
      });
    };
    ['home','category','cart','me','center'].forEach(merge);
    settings.markModified('mobileTabBar');
    await settings.save();
    res.json(settings.mobileTabBar || {});
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Update icon sizes for mobile tabs
router.put('/mobile-tab/sizes', settingsWriteGuard, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    const incoming = req.body || {};
    const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));
    const applySize = (section, key = 'size', min = 12, max = 48) => {
      if (incoming?.[section]?.[key] == null) return;
      settings.mobileTabBar = settings.mobileTabBar || {};
      settings.mobileTabBar[section] = settings.mobileTabBar[section] || {};
      settings.mobileTabBar[section][key] = clamp(incoming[section][key], min, max);
    };
    applySize('home');
    applySize('category');
    applySize('cart');
    applySize('me');
    applySize('center', 'iconSize', 16, 56);
    settings.markModified('mobileTabBar');
    await settings.save();
    res.json(settings.mobileTabBar || {});
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Upload authentication background image (admin only)
router.post('/upload/auth-background', adminAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    // Decide whether to push to Cloudinary (more persistent) or keep local file.
  let finalUrl = `/uploads/${req.file.filename}`; // default local path (ephemeral if host has no persistent disk)
  const hasCloudinaryCreds = await hasCloudinaryCredentials();

    if (hasCloudinaryCreds) {
      try {
        await ensureCloudinaryConfig();
        const uploadResult = await cloudinary.uploader.upload(path.join(uploadDir, req.file.filename), {
          folder: 'settings/auth',
          resource_type: 'image',
          use_filename: true,
          unique_filename: false,
          overwrite: true
        });
        if (uploadResult && uploadResult.secure_url) {
          finalUrl = uploadResult.secure_url;
          // Remove local temp file to save space
          try { fs.unlinkSync(path.join(uploadDir, req.file.filename)); } catch {}
        }
      } catch (cloudErr) {
        console.warn('[auth-background] Cloudinary upload failed, keeping local file:', cloudErr.message);
      }
    }

    // If no Cloudinary credentials are configured we currently store a relative /uploads path.
    // On many hosts (Render free tier, some serverless containers) this directory is ephemeral
    // and wiped on each redeploy/restart – causing the auth background to "disappear".
    // To make the background persist, inline it as a data URI in Mongo when Cloudinary isn't used.
    if (!hasCloudinaryCreds) {
      try {
        const filePath = path.join(uploadDir, req.file.filename);
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString('base64');
        const mime = req.file.mimetype || 'image/png';
        // Store as data URI so frontend can render without hitting /uploads
        finalUrl = `data:${mime};base64,${b64}`;
        // Optionally remove temp file to save disk (it won't be referenced anymore)
        try { fs.unlinkSync(filePath); } catch {}
      } catch (inlineErr) {
        console.warn('[auth-background] Failed to inline image, falling back to relative path:', inlineErr.message);
      }
    }

    settings.authBackgroundImage = finalUrl;
    await settings.save();

    // Broadcast minimal update
    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'settings_updated', data: { authBackgroundImage: settings.authBackgroundImage } });
      }
    } catch {}

  res.json({ url: finalUrl, stored: hasCloudinaryCreds ? 'cloudinary' : 'inline' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload header background image (admin only)
router.post('/upload/header-background', adminAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    let finalUrl = `/uploads/${req.file.filename}`;
    const hasCloudinaryCreds = await hasCloudinaryCredentials();
    if (hasCloudinaryCreds) {
      try {
        await ensureCloudinaryConfig();
        const uploadResult = await cloudinary.uploader.upload(path.join(uploadDir, req.file.filename), {
          folder: 'settings/header',
          resource_type: 'image',
          use_filename: true,
          unique_filename: false,
          overwrite: true
        });
        if (uploadResult?.secure_url) {
          finalUrl = uploadResult.secure_url;
          try { fs.unlinkSync(path.join(uploadDir, req.file.filename)); } catch {}
        }
      } catch (cloudErr) {
        console.warn('[header-background] Cloudinary upload failed, keeping local file:', cloudErr.message);
      }
    }

    if (!hasCloudinaryCreds) {
      try {
        const filePath = path.join(uploadDir, req.file.filename);
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString('base64');
        const mime = req.file.mimetype || 'image/png';
        finalUrl = `data:${mime};base64,${b64}`;
        try { fs.unlinkSync(filePath); } catch {}
      } catch (inlineErr) {
        console.warn('[header-background] Failed to inline image, falling back to relative path:', inlineErr.message);
      }
    }

    settings.headerBackgroundImage = finalUrl;
    await settings.save();

    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'settings_updated', data: { headerBackgroundImage: settings.headerBackgroundImage } });
      }
    } catch {}

    res.json({ url: toAbsolute(req, finalUrl), stored: hasCloudinaryCreds ? 'cloudinary' : 'inline' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload navigation bar background image (admin only)
router.post('/upload/nav-background', adminAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    let finalUrl = `/uploads/${req.file.filename}`;
    const hasCloudinaryCreds = await hasCloudinaryCredentials();
    if (hasCloudinaryCreds) {
      try {
        await ensureCloudinaryConfig();
        const uploadResult = await cloudinary.uploader.upload(path.join(uploadDir, req.file.filename), {
          folder: 'settings/nav',
          resource_type: 'image',
          use_filename: true,
          unique_filename: false,
          overwrite: true
        });
        if (uploadResult?.secure_url) {
          finalUrl = uploadResult.secure_url;
          try { fs.unlinkSync(path.join(uploadDir, req.file.filename)); } catch {}
        }
      } catch (cloudErr) {
        console.warn('[nav-background] Cloudinary upload failed, keeping local file:', cloudErr.message);
      }
    }

    // Inline when no Cloudinary to persist across ephemeral storage
    if (!hasCloudinaryCreds) {
      try {
        const filePath = path.join(uploadDir, req.file.filename);
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString('base64');
        const mime = req.file.mimetype || 'image/png';
        finalUrl = `data:${mime};base64,${b64}`;
        try { fs.unlinkSync(filePath); } catch {}
      } catch (inlineErr) {
        console.warn('[nav-background] Failed to inline image, using relative path:', inlineErr.message);
      }
    }

    settings.navBackgroundImage = finalUrl;
    await settings.save();
    // Broadcast minimal update
    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'settings_updated', data: { navBackgroundImage: toAbsolute(req, finalUrl) } });
      }
    } catch {}

    res.json({ url: toAbsolute(req, finalUrl), stored: hasCloudinaryCreds ? 'cloudinary' : 'inline' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload visitor popup background image (admin only)
router.post('/upload/visitor-popup-background', adminAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    settings.visitorPopup = settings.visitorPopup || {};

    let finalUrl = `/uploads/${req.file.filename}`;
    const hasCloudinaryCreds = await hasCloudinaryCredentials();

    if (hasCloudinaryCreds) {
      try {
        await ensureCloudinaryConfig();
        const uploadResult = await cloudinary.uploader.upload(path.join(uploadDir, req.file.filename), {
          folder: 'settings/visitor-popup',
          resource_type: 'image',
          use_filename: true,
          unique_filename: false,
          overwrite: true
        });
        if (uploadResult?.secure_url) {
          finalUrl = uploadResult.secure_url;
          try { fs.unlinkSync(path.join(uploadDir, req.file.filename)); } catch {}
        }
      } catch (cloudErr) {
        console.warn('[visitor-popup-background] Cloudinary upload failed, keeping local file:', cloudErr.message);
      }
    }

    if (!hasCloudinaryCreds) {
      try {
        const filePath = path.join(uploadDir, req.file.filename);
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString('base64');
        const mime = req.file.mimetype || 'image/png';
        finalUrl = `data:${mime};base64,${b64}`;
        try { fs.unlinkSync(filePath); } catch {}
      } catch (inlineErr) {
        console.warn('[visitor-popup-background] Failed to inline image, falling back to relative path:', inlineErr.message);
      }
    }

    settings.visitorPopup.backgroundImage = finalUrl;
    try { settings.markModified('visitorPopup'); } catch {}
    await settings.save();

    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'settings_updated', data: { visitorPopup: { backgroundImage: finalUrl } } });
      }
    } catch {}

    res.json({ url: toAbsolute(req, finalUrl), stored: hasCloudinaryCreds ? 'cloudinary' : 'inline' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload announcements bar background image (admin only)
router.post('/upload/announcements-background', adminAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    let finalUrl = `/uploads/${req.file.filename}`;
    const hasCloudinaryCreds = await hasCloudinaryCredentials();
    if (hasCloudinaryCreds) {
      try {
        await ensureCloudinaryConfig();
        const uploadResult = await cloudinary.uploader.upload(path.join(uploadDir, req.file.filename), {
          folder: 'settings/announcements',
          resource_type: 'image',
          use_filename: true,
          unique_filename: false,
          overwrite: true
        });
        if (uploadResult?.secure_url) {
          finalUrl = uploadResult.secure_url;
          try { fs.unlinkSync(path.join(uploadDir, req.file.filename)); } catch {}
        }
      } catch (cloudErr) {
        console.warn('[announcements-background] Cloudinary upload failed, keeping local file:', cloudErr.message);
      }
    }

    // Inline when no Cloudinary to persist across ephemeral storage
    if (!hasCloudinaryCreds) {
      try {
        const filePath = path.join(uploadDir, req.file.filename);
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString('base64');
        const mime = req.file.mimetype || 'image/png';
        finalUrl = `data:${mime};base64,${b64}`;
        try { fs.unlinkSync(filePath); } catch {}
      } catch (inlineErr) {
        console.warn('[announcements-background] Failed to inline image, using relative path:', inlineErr.message);
      }
    }

    settings.announcementsBackgroundImage = finalUrl;
    await settings.save();

    // Broadcast minimal update
    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'settings_updated', data: { announcementsBackgroundImage: toAbsolute(req, finalUrl) } });
      }
    } catch {}

    res.json({ url: toAbsolute(req, finalUrl), stored: hasCloudinaryCreds ? 'cloudinary' : 'inline' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload global store background image (admin only)
router.post('/upload/store-background', adminAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    let finalUrl = `/uploads/${req.file.filename}`;
    const hasCloudinaryCreds = await hasCloudinaryCredentials();
    if (hasCloudinaryCreds) {
      try {
        await ensureCloudinaryConfig();
        const uploadResult = await cloudinary.uploader.upload(path.join(uploadDir, req.file.filename), {
          folder: 'settings/store',
          resource_type: 'image',
          use_filename: true,
          unique_filename: false,
          overwrite: true
        });
        if (uploadResult?.secure_url) {
          finalUrl = uploadResult.secure_url;
          try { fs.unlinkSync(path.join(uploadDir, req.file.filename)); } catch {}
        }
      } catch (cloudErr) {
        console.warn('[store-background] Cloudinary upload failed, keeping local file:', cloudErr.message);
      }
    }

    // Inline when no Cloudinary to persist across ephemeral storage
    if (!hasCloudinaryCreds) {
      try {
        const filePath = path.join(uploadDir, req.file.filename);
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString('base64');
        const mime = req.file.mimetype || 'image/png';
        finalUrl = `data:${mime};base64,${b64}`;
        try { fs.unlinkSync(filePath); } catch {}
      } catch (inlineErr) {
        console.warn('[store-background] Failed to inline image, using relative path:', inlineErr.message);
      }
    }

    settings.storeBackgroundImage = finalUrl;
    await settings.save();

    // Broadcast minimal update
    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'settings_updated', data: { storeBackgroundImage: toAbsolute(req, finalUrl) } });
      }
    } catch {}

    res.json({ url: toAbsolute(req, finalUrl), stored: hasCloudinaryCreds ? 'cloudinary' : 'inline' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload New Arrivals banner image (admin only)
router.post('/upload/new-arrivals-banner', adminAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    let finalUrl = `/uploads/${req.file.filename}`;
    const hasCloudinaryCreds = await hasCloudinaryCredentials();
    if (hasCloudinaryCreds) {
      try {
        await ensureCloudinaryConfig();
        const uploadResult = await cloudinary.uploader.upload(path.join(uploadDir, req.file.filename), {
          folder: 'settings/new-arrivals',
          resource_type: 'image',
          use_filename: true,
          unique_filename: false,
          overwrite: true
        });
        if (uploadResult?.secure_url) {
          finalUrl = uploadResult.secure_url;
          try { fs.unlinkSync(path.join(uploadDir, req.file.filename)); } catch {}
        }
      } catch (cloudErr) {
        console.warn('[new-arrivals-banner] Cloudinary upload failed, keeping local file:', cloudErr.message);
      }
    }

    // Inline when no Cloudinary to persist across ephemeral storage
    if (!hasCloudinaryCreds) {
      try {
        const filePath = path.join(uploadDir, req.file.filename);
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString('base64');
        const mime = req.file.mimetype || 'image/png';
        finalUrl = `data:${mime};base64,${b64}`;
        try { fs.unlinkSync(filePath); } catch {}
      } catch (inlineErr) {
        console.warn('[new-arrivals-banner] Failed to inline image, using relative path:', inlineErr.message);
      }
    }

    settings.newArrivalsBannerImage = finalUrl;
    await settings.save();

    // Broadcast minimal update
    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'settings_updated', data: { newArrivalsBannerImage: toAbsolute(req, finalUrl) } });
      }
    } catch {}

    res.json({ url: toAbsolute(req, finalUrl) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload favicon (admin only). Accepts image/svg+xml, image/png, image/x-icon. Stores at /uploads or Cloudinary folder settings/favicon
router.post('/upload/favicon', adminAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    // Basic content-type check
    const allowed = ['image/svg+xml','image/png','image/x-icon','image/vnd.microsoft.icon'];
    if (!allowed.includes(req.file.mimetype)) {
      return res.status(400).json({ message: 'Unsupported favicon file type' });
    }

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    let finalUrl = `/uploads/${req.file.filename}`; // default local path (may be ephemeral)
  const hasCloudinaryCreds = await hasCloudinaryCredentials();
    if (hasCloudinaryCreds) {
      try {
        await ensureCloudinaryConfig();
        const uploadResult = await cloudinary.uploader.upload(path.join(uploadDir, req.file.filename), {
          folder: 'settings/favicon',
            resource_type: 'image',
            use_filename: true,
            unique_filename: false,
            overwrite: true,
            type: 'upload'
          });
          if (uploadResult?.secure_url) {
            finalUrl = uploadResult.secure_url;
            try { fs.unlinkSync(path.join(uploadDir, req.file.filename)); } catch {}
          }
        } catch (cloudErr) {
          console.warn('[favicon] Cloudinary upload failed, keeping local file:', cloudErr.message);
        }
    }
    // Inline as data URI when Cloudinary not configured to persist across restarts
    if (!hasCloudinaryCreds) {
      try {
        const filePath = path.join(uploadDir, req.file.filename);
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString('base64');
        const mime = req.file.mimetype || 'image/png';
        finalUrl = `data:${mime};base64,${b64}`;
        try { fs.unlinkSync(filePath); } catch {}
      } catch (inlineErr) {
        console.warn('[favicon] Failed to inline favicon, leaving relative path:', inlineErr.message);
      }
    }

    settings.favicon = finalUrl;
    await settings.save();

    // Prepare absolute (or inline) URL
    const absoluteUrl = settings.favicon ? toAbsolute(req, settings.favicon) : settings.favicon;

    // Broadcast minimal update with absolute / inline URL (so clients on different origins can consume directly)
    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'settings_updated', data: { favicon: absoluteUrl } });
      }
    } catch {}

    res.json({ url: absoluteUrl, stored: hasCloudinaryCreds ? 'cloudinary' : 'inline' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

// Cloudinary admin config endpoints
// Cloudinary settings are sensitive; admin only
router.get('/cloudinary', adminAuth, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    const c = settings.cloudinary || { cloudName: '', apiKey: '', apiSecret: '' };
    // Allow explicit reveal of secret for admin when query param reveal=1 provided.
    // This is intentionally permissive per user request ("keep them available").
    // WARNING: Exposing the raw apiSecret increases risk – ensure HTTPS and restrict admin access.
    const reveal = req.query.reveal === '1' || req.query.reveal === 'true';
    res.json({
      cloudName: c.cloudName || '',
      apiKey: c.apiKey || '',
      apiSecret: c.apiSecret ? (reveal ? c.apiSecret : '***') : ''
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.put('/cloudinary', adminAuth, async (req, res) => {
  try {
    const { cloudName = '', apiKey = '', apiSecret = '', clearSecret = false } = req.body || {};
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    settings.cloudinary = settings.cloudinary || {};
    // Only update fields when non-empty strings provided. Allow explicit clearing via clearSecret flag.
    if (typeof cloudName === 'string' && cloudName.trim().length) settings.cloudinary.cloudName = cloudName.trim();
    if (typeof apiKey === 'string' && apiKey.trim().length) settings.cloudinary.apiKey = apiKey.trim();
    if (clearSecret === true) {
      settings.cloudinary.apiSecret = '';
    } else if (typeof apiSecret === 'string' && apiSecret !== '***' && apiSecret.trim().length) {
      settings.cloudinary.apiSecret = apiSecret.trim();
    }
    await settings.save();
    const configured = await ensureCloudinaryConfig();
    const c = settings.cloudinary || {};
    res.json({ ok: true, configured, cloudinary: { cloudName: c.cloudName || '', apiKey: c.apiKey || '', apiSecret: c.apiSecret ? '***' : '' } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post('/cloudinary/test', adminAuth, async (req, res) => {
  try {
    const ok = await ensureCloudinaryConfig();
    if (!ok) return res.status(400).json({ ok: false, message: 'Missing Cloudinary credentials' });
    // Simple API ping: list 1 image; if auth fails, it will throw
    await import('../services/cloudinaryClient.js');
    const { v2: sdk } = await import('cloudinary');
    const r = await sdk.api.resources({ max_results: 1, type: 'upload', resource_type: 'image' });
    res.json({ ok: true, count: (r.resources || []).length });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  }
});

// PayPal config endpoint (public: returns only non-sensitive fields)
router.get('/payments/paypal', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    const p = (settings.payments && settings.payments.paypal) || { enabled: false, mode: 'sandbox', clientId: '', secret: '' };
    res.json({ enabled: !!p.enabled, mode: p.mode || 'sandbox', clientId: p.clientId || '', secret: p.secret ? '***' : '' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Updating PayPal credentials should be admin-only
router.put('/payments/paypal', adminAuth, async (req, res) => {
  try {
    const { enabled, mode, clientId, secret } = req.body || {};
    if (mode && !['sandbox', 'live'].includes(String(mode))) {
      return res.status(400).json({ message: 'Invalid mode. Use sandbox or live.' });
    }
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    settings.payments = settings.payments || {};
    settings.payments.paypal = settings.payments.paypal || { enabled: false, mode: 'sandbox', clientId: '', secret: '' };
    if (typeof enabled !== 'undefined') settings.payments.paypal.enabled = !!enabled;
    if (typeof mode === 'string') settings.payments.paypal.mode = mode;
    if (typeof clientId === 'string') settings.payments.paypal.clientId = clientId.trim();
    if (typeof secret === 'string' && secret !== '***') settings.payments.paypal.secret = secret.trim();
    settings.markModified('payments');
    await settings.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Checkout form customization endpoints
router.get('/checkout', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    const cf = settings.checkoutForm || {};
    const cityTable = buildCityTable(cf);
    const cityList = cityTable.length
      ? cityTable.map(canonicalCityValue).filter(Boolean)
      : (Array.isArray(cf.cities) ? cf.cities.filter(c => typeof c === 'string' && c.trim()).map(c => c.trim()) : []);
    res.json({
      showEmail: !!cf.showEmail,
      showLastName: !!cf.showLastName,
      allowGuestCheckout: cf.allowGuestCheckout !== false, // default true
      showSecondaryMobile: !!cf.showSecondaryMobile,
      showCountry: !!cf.showCountry,
      allowOtherCity: !!cf.allowOtherCity,
      cities: cityList,
      cityTable
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Update checkout form (guarded; can be relaxed via env)
router.put('/checkout', settingsWriteGuard, async (req, res) => {
  try {
    const { showEmail, showLastName, showSecondaryMobile, showCountry, cities, allowOtherCity, allowGuestCheckout, cityTable } = req.body || {};
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    settings.checkoutForm = settings.checkoutForm || {};
    if (typeof showEmail === 'boolean') settings.checkoutForm.showEmail = showEmail;
    if (typeof showLastName === 'boolean') settings.checkoutForm.showLastName = showLastName;
    if (typeof showSecondaryMobile === 'boolean') settings.checkoutForm.showSecondaryMobile = showSecondaryMobile;
    if (typeof showCountry === 'boolean') settings.checkoutForm.showCountry = showCountry;
  if (typeof allowGuestCheckout === 'boolean') settings.checkoutForm.allowGuestCheckout = allowGuestCheckout;
    if (typeof allowOtherCity === 'boolean') settings.checkoutForm.allowOtherCity = allowOtherCity;
    if (Array.isArray(cityTable)) {
      const normalized = cityTable
        .map(entry => normalizeCityRow(entry))
        .filter(Boolean);
      settings.checkoutForm.cityTable = normalized;
      settings.checkoutForm.cities = normalized.map(canonicalCityValue).filter(Boolean);
    } else if (Array.isArray(cities)) {
      const clean = cities.filter(c => typeof c === 'string' && c.trim().length).map(c => c.trim());
      settings.checkoutForm.cities = clean;
      if (!Array.isArray(settings.checkoutForm.cityTable) || !settings.checkoutForm.cityTable.length) {
        settings.checkoutForm.cityTable = clean.map(label => ({ ar: label, en: '', he: '' }));
      }
    }
    settings.markModified('checkoutForm');
    await settings.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PayPal config test endpoint
router.post('/payments/paypal/test', adminAuth, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings || !settings.payments || !settings.payments.paypal || !settings.payments.paypal.clientId || !settings.payments.paypal.secret) {
      return res.status(400).json({ ok: false, message: 'Missing PayPal credentials' });
    }
    // Simple auth test: get an access token via SDK by creating a minimal order and not executing
    const { getPayPalClient, paypalSdk } = await import('../services/paypalClient.js');
    try {
      const client = getPayPalClient();
      const request = new paypalSdk.orders.OrdersCreateRequest();
      request.prefer('return=representation');
      request.requestBody({ intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'USD', value: '1.00' } }] });
      await client.execute(request);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(400).json({ ok: false, message: e.message });
    }
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// iCredit (Rivhit Payment Page) config endpoints
router.get('/payments/icredit', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    const c = (settings.payments && settings.payments.icredit) || {};
    return res.json({
      enabled: !!c.enabled,
      apiUrl: c.apiUrl || 'https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl',
      transport: c.transport || 'auto',
      groupPrivateToken: c.groupPrivateToken ? '***' : '',
      redirectURL: c.redirectURL || '',
      ipnURL: c.ipnURL || '',
      exemptVAT: !!c.exemptVAT,
      maxPayments: Number.isFinite(Number(c.maxPayments)) ? Number(c.maxPayments) : 1,
      creditFromPayment: Number(c.creditFromPayment) || 0,
      documentLanguage: c.documentLanguage || 'he',
      createToken: !!c.createToken,
      hideItemList: !!c.hideItemList,
      emailBcc: c.emailBcc || '',
      defaultDiscount: Number(c.defaultDiscount) || 0
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.put('/payments/icredit', adminAuth, async (req, res) => {
  try {
    const inc = req.body || {};
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    settings.payments = settings.payments || {};
    settings.payments.icredit = settings.payments.icredit || {};
    const prevToken = settings.payments.icredit.groupPrivateToken || '';
    const setIf = (cond, setter) => { if (typeof cond !== 'undefined') setter(); };
    setIf(inc.enabled, () => settings.payments.icredit.enabled = !!inc.enabled);
    setIf(inc.apiUrl, () => settings.payments.icredit.apiUrl = String(inc.apiUrl).trim());
    if (typeof inc.transport === 'string') {
      const tr = String(inc.transport).toLowerCase();
      if (['auto','json','soap'].includes(tr)) settings.payments.icredit.transport = tr;
    }
    if (typeof inc.groupPrivateToken === 'string') {
      settings.payments.icredit.groupPrivateToken = inc.groupPrivateToken === '***' ? prevToken : inc.groupPrivateToken.trim();
    }
    setIf(inc.redirectURL, () => settings.payments.icredit.redirectURL = String(inc.redirectURL).trim());
    setIf(inc.ipnURL, () => settings.payments.icredit.ipnURL = String(inc.ipnURL).trim());
    if (typeof inc.exemptVAT !== 'undefined') settings.payments.icredit.exemptVAT = !!inc.exemptVAT;
    if (typeof inc.maxPayments !== 'undefined') {
      const n = Number(inc.maxPayments); settings.payments.icredit.maxPayments = Number.isFinite(n) && n >= 1 ? n : 1;
    }
    if (typeof inc.creditFromPayment !== 'undefined') {
      const n = Number(inc.creditFromPayment); settings.payments.icredit.creditFromPayment = Number.isFinite(n) && n >= 0 ? n : 0;
    }
    if (typeof inc.documentLanguage === 'string') settings.payments.icredit.documentLanguage = inc.documentLanguage;
    if (typeof inc.createToken !== 'undefined') settings.payments.icredit.createToken = !!inc.createToken;
    if (typeof inc.hideItemList !== 'undefined') settings.payments.icredit.hideItemList = !!inc.hideItemList;
    if (typeof inc.emailBcc === 'string') settings.payments.icredit.emailBcc = inc.emailBcc.trim();
    if (typeof inc.defaultDiscount !== 'undefined') {
      const n = Number(inc.defaultDiscount); settings.payments.icredit.defaultDiscount = Number.isFinite(n) && n >= 0 ? n : 0;
    }
    try { settings.markModified('payments'); } catch {}
    await settings.save();
    return res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Basic test endpoint: validates required fields presence
router.post('/payments/icredit/test', adminAuth, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    const c = settings?.payments?.icredit || {};
    if (!c.enabled) return res.status(400).json({ ok: false, message: 'iCredit is disabled' });
    if (!c.apiUrl) return res.status(400).json({ ok: false, message: 'Missing API URL' });
    if (!c.groupPrivateToken) return res.status(400).json({ ok: false, message: 'Missing GroupPrivateToken' });
    // We don't call the remote API here to avoid network dependency; this endpoint checks local config only.
    return res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// Public IPN endpoint for iCredit payment notifications
// Note: Depending on iCredit's IPN sender, you might need to disable auth and use a shared secret
router.post('/payments/icredit/ipn', async (req, res) => {
  try {
    const payload = req.body || {};
    // Basic acceptance; later: verify signature/token if provided, then update order status
    console.log('[iCredit][IPN] payload', JSON.stringify(payload).slice(0,2000));
    // Example: const orderId = payload?.Custom1 or Reference
    // TODO: implement verification and order status update
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});