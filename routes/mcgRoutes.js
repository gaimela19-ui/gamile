import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import Settings from '../models/Settings.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import { getItemsList, setItemsList } from '../services/mcgService.js';
import { collectMcgIdentifiers, persistMcgBlocklistEntries, persistMcgArchiveEntries, propagateMcgDeletion, markMcgItemsArchived, ensureIdentifiersHaveMcgIds } from '../services/mcgDeletionService.js';
import Inventory from '../models/Inventory.js';
import InventoryHistory from '../models/InventoryHistory.js';
import Warehouse from '../models/Warehouse.js';
import { inventoryService } from '../services/inventoryService.js';
import { runMcgSyncOnce } from '../services/mcgSyncScheduler.js';
import McgItemBlock from '../models/McgItemBlock.js';
import McgArchivedItem from '../models/McgArchivedItem.js';
import { hasArchivedAttribute } from '../utils/mcgAttributes.js';
import { normalizeTaxMultiplier, percentToMultiplier } from '../utils/mcgTax.js';
import { extractFinalPrice } from '../utils/mcgPrice.js';

const router = express.Router();

// Heuristic language detector for incoming MCG text
function detectLangFromText(text) {
  try {
    const s = (text || '') + '';
    const ar = (s.match(/[\u0600-\u06FF]/g) || []).length; // Arabic block
    const he = (s.match(/[\u0590-\u05FF]/g) || []).length; // Hebrew block
    if (ar > he && ar > 0) return 'ar';
    if (he > ar && he > 0) return 'he';
    return 'en';
  } catch {
    return 'en';
  }
}

// Normalize imported MCG price values for all items to a clean "even" whole number.
// Policy:
//  - Always round UP to the next whole number (Math.ceil). Examples: 9.92 -> 10, 89.24 -> 90
//  - Non-finite or negative inputs return 0
// Note: stored as a Number (no forced .00). Formatting is a UI concern.
function normalizeMcgImportedPrice(p) {
  const val = Number(p);
  if (!Number.isFinite(val) || val < 0) return 0;
  return Math.ceil(val);
}

function resolvePriceFromMcgItem(it, taxMultiplier) {
  const finalPrice = extractFinalPrice(it);
  if (finalPrice !== null) return normalizeMcgImportedPrice(finalPrice);
  const priceRaw = Number(it?.Price ?? it?.price ?? it?.item_price ?? 0);
  const base = Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : 0;
  const multiplied = Math.round(base * taxMultiplier * 100) / 100;
  return normalizeMcgImportedPrice(multiplied);
}

// Public health ping (no auth). Returns a simple OK to verify routing reaches this service.
router.get('/ping', (req, res) => {
  res.json({ ok: true, service: 'mcg', timestamp: new Date().toISOString() });
});

// Proxy to MCG get_items_list with OAuth2
// POST /api/mcg/items
router.post('/items', adminAuth, async (req, res) => {
  try {
    const { PageNumber, PageSize, Filter } = req.body || {};
    const s = await Settings.findOne();
    if (!s?.mcg?.enabled) return res.status(412).json({ message: 'MCG integration disabled' });
    const data = await getItemsList({ PageNumber, PageSize, Filter });
    res.json(data);
  } catch (e) {
    const status = e?.status || 500;
    res.status(status).json({ message: e?.message || 'mcg_items_failed' });
  }
});

export default router;

// Config endpoints
router.get('/config', adminAuth, async (req, res) => {
  try {
    let s = await Settings.findOne();
    if (!s) s = await Settings.create({});
    const m = s.mcg || {};
    const taxMultiplier = normalizeTaxMultiplier(m.taxMultiplier ?? 1.18);
    res.json({
      enabled: !!m.enabled,
      baseUrl: m.baseUrl || 'https://api.mcgateway.com',
      apiFlavor: m.apiFlavor || '',
      clientId: m.clientId ? '***' : '',
      clientSecret: m.clientSecret ? '***' : '',
      scope: m.scope || '',
      apiVersion: m.apiVersion || 'v2.6',
      tokenUrl: m.tokenUrl || '',
      extraHeaderName: m.extraHeaderName || '',
      extraHeaderValue: m.extraHeaderValue ? '***' : '',
      group: typeof m.group === 'number' ? m.group : undefined,
  vendorCode: m.vendorCode || '',
  retailerKey: m.retailerKey ? '***' : '',
      retailerClientId: m.retailerClientId || '',
      taxMultiplier,
      pushStockBackEnabled: !!m.pushStockBackEnabled,
      autoPullEnabled: !!m.autoPullEnabled,
      pullEveryMinutes: typeof m.pullEveryMinutes === 'number' ? m.pullEveryMinutes : 1,
      autoCreateItemsEnabled: !!m.autoCreateItemsEnabled
      , autoPullAllPages: !!m.autoPullAllPages
    });
  } catch (e) {
    res.status(500).json({ message: e?.message || 'mcg_config_read_failed' });
  }
});

router.put('/config', adminAuth, async (req, res) => {
  try {
    let s = await Settings.findOne().sort({ updatedAt: -1 });
    if (!s) s = new Settings();
    const inc = req.body || {};
    s.mcg = s.mcg || { enabled: false, baseUrl: 'https://api.mcgateway.com', clientId: '', clientSecret: '', scope: '', apiVersion: 'v2.6' };
    if (typeof inc.enabled !== 'undefined') s.mcg.enabled = !!inc.enabled;
    if (typeof inc.apiFlavor === 'string') s.mcg.apiFlavor = inc.apiFlavor.trim().toLowerCase();
    if (typeof inc.baseUrl === 'string') {
      let b = (inc.baseUrl || '').trim();
      if (b && !/^https?:\/\//i.test(b)) b = 'https://' + b;
      // Validate URL format. For 'uplicali' flavor keep full path; otherwise strip to origin only.
      try {
        const u = new URL(b);
        if ((s.mcg.apiFlavor || '').toLowerCase() === 'uplicali') {
          s.mcg.baseUrl = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname.replace(/\/$/, '')}`;
        } else {
          s.mcg.baseUrl = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
        }
      } catch {
        return res.status(400).json({ message: 'Invalid baseUrl. For legacy use origin like https://api.mcgateway.com; for Uplîcali you may include /SuperMCG/MCG_API.' });
      }
    }
    if (typeof inc.clientId === 'string') {
      if (inc.clientId !== '***') s.mcg.clientId = inc.clientId.trim();
    }
    if (typeof inc.clientSecret === 'string') {
      if (inc.clientSecret !== '***') s.mcg.clientSecret = inc.clientSecret.trim();
    }
    if (typeof inc.scope === 'string') s.mcg.scope = inc.scope.trim();
    if (typeof inc.apiVersion === 'string') s.mcg.apiVersion = inc.apiVersion.trim();
    if (typeof inc.tokenUrl === 'string') {
      let t = (inc.tokenUrl || '').trim();
      if (t) {
        if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
        try {
          const u = new URL(t);
          // Keep full path for token URL since Azure AD includes a path
          s.mcg.tokenUrl = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}`;
        } catch {
          return res.status(400).json({ message: 'Invalid tokenUrl. Example: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token' });
        }
      } else {
        s.mcg.tokenUrl = '';
      }
    }
    if (typeof inc.extraHeaderName === 'string') s.mcg.extraHeaderName = inc.extraHeaderName.trim();
    if (typeof inc.extraHeaderValue === 'string') {
      if (inc.extraHeaderValue !== '***') s.mcg.extraHeaderValue = inc.extraHeaderValue.trim();
    }
    if (typeof inc.vendorCode === 'string') s.mcg.vendorCode = inc.vendorCode.trim();
    if (typeof inc.retailerKey === 'string') {
      if (inc.retailerKey !== '***') s.mcg.retailerKey = inc.retailerKey.trim();
    }
    if (typeof inc.retailerClientId === 'string') s.mcg.retailerClientId = inc.retailerClientId.trim();
    if (typeof inc.group !== 'undefined') {
      const g = Number(inc.group);
      if (Number.isFinite(g)) s.mcg.group = g; else s.mcg.group = undefined;
    }
    if (typeof inc.taxMultiplier !== 'undefined') {
      const normalized = normalizeTaxMultiplier(inc.taxMultiplier);
      if (Number.isFinite(normalized) && normalized >= 1) s.mcg.taxMultiplier = normalized;
    } else if (typeof inc.taxPercent !== 'undefined') {
      const normalized = percentToMultiplier(inc.taxPercent);
      if (Number.isFinite(normalized) && normalized >= 1) s.mcg.taxMultiplier = normalized;
    }
    if (typeof inc.pushStockBackEnabled !== 'undefined') s.mcg.pushStockBackEnabled = !!inc.pushStockBackEnabled;
    if (typeof inc.autoPullEnabled !== 'undefined') s.mcg.autoPullEnabled = !!inc.autoPullEnabled;
    if (typeof inc.pullEveryMinutes !== 'undefined') {
      const m = Number(inc.pullEveryMinutes);
      if (Number.isFinite(m) && m >= 1 && m <= 720) s.mcg.pullEveryMinutes = Math.floor(m);
    }
    if (typeof inc.autoCreateItemsEnabled !== 'undefined') s.mcg.autoCreateItemsEnabled = !!inc.autoCreateItemsEnabled;
    if (typeof inc.autoPullAllPages !== 'undefined') s.mcg.autoPullAllPages = !!inc.autoPullAllPages;
    if (typeof inc.autoCreatePlaceholderImage === 'string') s.mcg.autoCreatePlaceholderImage = inc.autoCreatePlaceholderImage.trim();
    try { s.markModified('mcg'); } catch {}
    await s.save();
    res.json({
      enabled: s.mcg.enabled,
      baseUrl: s.mcg.baseUrl,
      apiFlavor: s.mcg.apiFlavor || '',
      clientId: s.mcg.clientId ? '***' : '',
      clientSecret: s.mcg.clientSecret ? '***' : '',
      scope: s.mcg.scope || '',
      apiVersion: s.mcg.apiVersion || 'v2.6',
      tokenUrl: s.mcg.tokenUrl || '',
      extraHeaderName: s.mcg.extraHeaderName || '',
      extraHeaderValue: s.mcg.extraHeaderValue ? '***' : '',
      group: typeof s.mcg.group === 'number' ? s.mcg.group : undefined,
  vendorCode: s.mcg.vendorCode || '',
  retailerKey: s.mcg.retailerKey ? '***' : '',
      retailerClientId: s.mcg.retailerClientId || '',
      taxMultiplier: normalizeTaxMultiplier(s.mcg.taxMultiplier ?? 1.18),
      pushStockBackEnabled: !!s.mcg.pushStockBackEnabled,
      autoPullEnabled: !!s.mcg.autoPullEnabled,
      pullEveryMinutes: typeof s.mcg.pullEveryMinutes === 'number' ? s.mcg.pullEveryMinutes : 1,
      autoCreateItemsEnabled: !!s.mcg.autoCreateItemsEnabled,
      autoCreatePlaceholderImage: s.mcg.autoCreatePlaceholderImage || ''
    });
  } catch (e) {
    res.status(500).json({ message: e?.message || 'mcg_config_update_failed' });
  }
});

// Lookup a single item in MCG by barcode (item_code) or item_id
// POST /api/mcg/item-lookup { code?: string, id?: string, group?: number }
router.post('/item-lookup', adminAuth, async (req, res) => {
  try {
    const { code, id, group } = req.body || {};
    const norm = (v) => (v === undefined || v === null) ? '' : String(v).trim();
    const c = norm(code);
    const i = norm(id);
    if (!c && !i) return res.status(400).json({ message: 'Provide code or id' });
    const s = await Settings.findOne();
    if (!s?.mcg?.enabled) return res.status(412).json({ message: 'MCG integration disabled' });
    const grp = (group !== undefined && group !== null && !Number.isNaN(Number(group))) ? Number(group) : (Number.isFinite(Number(s?.mcg?.group)) ? Number(s.mcg.group) : undefined);
    const data = await getItemsList({ group: grp });
    const arr = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []));
    const getCode = (x) => norm(x?.item_code ?? x?.Barcode ?? x?.barcode);
    const getId = (x) => norm(x?.item_id ?? x?.ItemID ?? x?.id ?? x?.itemId);
    const found = arr.find(x => (c && getCode(x) === c) || (i && getId(x) === i));
    if (!found) return res.status(404).json({ message: 'not_found', count: Array.isArray(arr) ? arr.length : 0, group: grp ?? 'default' });
    return res.json({ group: grp ?? 'default', item: found });
  } catch (e) {
    const status = e?.status || 500;
    res.status(status).json({ message: e?.message || 'mcg_item_lookup_failed' });
  }
});

// Sync inventory quantities from MCG into local Inventory
// POST /api/mcg/sync-inventory
// Body: { dryRun?: boolean, page?: number, pageSize?: number, syncAll?: boolean }
router.post('/sync-inventory', adminAuth, async (req, res) => {
  try {
    const s = await Settings.findOne();
    if (!s?.mcg?.enabled) return res.status(412).json({ message: 'MCG integration disabled' });

    const { page, pageSize, dryRun, syncAll } = req.body || {};
    const isDry = !!dryRun || String(req.query?.dryRun || '').toLowerCase() === 'true';

    // Detect Uplîcali flavor which ignores pagination and returns the full list
    const apiFlavor = String(s?.mcg?.apiFlavor || '').trim().toLowerCase();
    const baseUrl = String(s?.mcg?.baseUrl || '').trim();
    const isUpli = apiFlavor === 'uplicali' || /apis\.uplicali\.com/i.test(baseUrl) || /SuperMCG\/MCG_API/i.test(baseUrl);

    // For legacy, if syncAll requested or page/pageSize missing, loop pages until empty
    const doLoop = !isUpli && ( !!syncAll || !Number.isFinite(Number(page)) || !Number.isFinite(Number(pageSize)) );
    const effPageSize = Number.isFinite(Number(pageSize)) && Number(pageSize) > 0 ? Number(pageSize) : 200;
    let pageNum = Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : 1;

    let processed = 0;
    let updated = 0;
    let created = 0;
    let skippedNoMatch = 0;
    let skippedNoop = 0;
    let skippedArchivedAttr = 0;
    let skippedArchivedProducts = 0;
    let skippedConflict = 0;
    let errors = 0;
    let updatedProductNames = 0;
    let updatedProductPrices = 0;
    let updatedVariantPrices = 0;

    const taxMultiplier = normalizeTaxMultiplier(s?.mcg?.taxMultiplier ?? 1.18);

    const ensureMainWarehouse = async () => {
      let wh = await Warehouse.findOne({ name: 'Main Warehouse' });
      if (!wh && !isDry) {
        wh = await Warehouse.findOneAndUpdate(
          { name: 'Main Warehouse' },
          { $setOnInsert: { name: 'Main Warehouse' } },
          { new: true, upsert: true }
        );
      }
      return wh;
    };

    const upsertInventoryFor = async ({ productId, variantId, qty, size, color }) => {
      const wh = await ensureMainWarehouse();
      const filter = variantId
        ? { product: productId, variantId, warehouse: wh?._id }
        : { product: productId, size: size || 'Default', color: color || 'Default', warehouse: wh?._id };
      const nextQty = Math.max(0, Number(qty) || 0);
      const protectSecondsRaw = Number(process.env.MCG_PULL_PROTECT_SECONDS);
      const protectMs = (Number.isFinite(protectSecondsRaw) && protectSecondsRaw >= 0 ? protectSecondsRaw : 300) * 1000;

      // Keep recent local app updates authoritative when pull tries to increase stock.
      const current = await Inventory.findOne(filter).select('quantity updatedAt').lean();
      const currQty = Number(current?.quantity) || 0;
      const updatedAtMs = current?.updatedAt ? new Date(current.updatedAt).getTime() : 0;
      const ageMs = updatedAtMs > 0 ? (Date.now() - updatedAtMs) : Number.POSITIVE_INFINITY;
      if (current && nextQty === currQty) {
        return { inv: null, applied: false, skippedConflict: false, skippedNoop: true };
      }
      if (current && nextQty > currQty && ageMs >= 0 && ageMs <= protectMs) {
        return { inv: null, applied: false, skippedConflict: true, skippedNoop: false };
      }

      const update = { $set: { quantity: nextQty } };
      const opts = { new: true, upsert: true, setDefaultsOnInsert: true };
      if (!isDry) {
        const inv = await Inventory.findOneAndUpdate(filter, update, opts);
        await inventoryService.recomputeProductStock(productId);
        await new InventoryHistory({
          product: productId,
          type: 'update',
          quantity: nextQty,
          reason: 'MCG sync (pull)'
        }).save();
        return { inv, applied: true, skippedConflict: false, skippedNoop: false };
      }
      return { inv: null, applied: true, skippedConflict: false, skippedNoop: false };
    };

    const processItems = async (items) => {
      for (const it of items) {
        try {
          processed++;
          if (hasArchivedAttribute(it)) {
            skippedArchivedAttr++;
            continue;
          }

          const mcgId = ((it?.ItemID ?? it?.ItemId ?? it?.itemID ?? it?.id ?? it?.itemId ?? it?.item_id ?? '') + '').trim();
          const barcode = ((it?.Barcode ?? it?.BarCode ?? it?.ItemCode ?? it?.ItemCODE ?? it?.itemCode ?? it?.barcode ?? it?.item_code ?? it?.code ?? '') + '').trim();
          const qty = Number(it?.StockQuantity ?? it?.stock ?? it?.item_inventory ?? 0);
          const qtySafe = Number.isFinite(qty) ? qty : 0;

          // Try variant match by barcode first
          let prod = null; let variant = null;
          if (barcode) {
            prod = await Product.findOne({ 'variants.barcode': barcode }).select('_id variants isActive name price mcgBarcode');
            if (prod && Array.isArray(prod.variants)) {
              variant = prod.variants.find(v => String(v?.barcode || '').trim() === barcode);
            }
          }
          // Fallback: product barcode
          if (!prod && barcode) {
            prod = await Product.findOne({ mcgBarcode: barcode }).select('_id isActive name price mcgBarcode');
          }
          // Fallback: product by mcgItemId (non-variant)
          if (!prod && mcgId) {
            prod = await Product.findOne({ mcgItemId: mcgId }).select('_id isActive name price mcgBarcode');
          }

          if (!prod) { skippedNoMatch++; continue; }

          if (prod.isActive === false) {
            skippedArchivedProducts++;
            continue;
          }

          // Keep product/variant fields in sync with remote MCG values.
          const remotePrice = resolvePriceFromMcgItem(it, taxMultiplier);
          if (variant && variant._id) {
            const currentVariantPrice = Number(variant?.price);
            const hasVariantPrice = Number.isFinite(currentVariantPrice);
            if (!hasVariantPrice || currentVariantPrice !== remotePrice) {
              updatedVariantPrices++;
              if (!isDry) {
                await Product.updateOne(
                  { _id: prod._id, 'variants._id': variant._id },
                  { $set: { 'variants.$.price': remotePrice } }
                );
              }
            }
          } else {
            const setPayload = {};
            const currentProductPrice = Number(prod?.price);
            const hasProductPrice = Number.isFinite(currentProductPrice);
            if (!hasProductPrice || currentProductPrice !== remotePrice) {
              setPayload.price = remotePrice;
              updatedProductPrices++;
            }

            const numericLike = (v) => /^\d{8,}$/.test(String(v || ''));
            let remoteName = (it?.ItemName ?? it?.Name ?? it?.name ?? it?.item_name ?? '') + '';
            const remoteDesc = ((it?.ItemDescription ?? it?.Description ?? it?.description ?? '') + '').trim();
            remoteName = remoteName.trim();
            if (!remoteName || numericLike(remoteName)) {
              remoteName = (remoteDesc || barcode || mcgId || remoteName).trim();
            }
            const currentName = String(prod?.name || '').trim();
            if (remoteName && remoteName.toLowerCase() !== currentName.toLowerCase()) {
              setPayload.name = remoteName;
              const langGuess = detectLangFromText(`${remoteName} ${remoteDesc}`);
              if (langGuess && langGuess !== 'en') {
                setPayload[`name_i18n.${langGuess}`] = remoteName;
                if (remoteDesc) setPayload[`description_i18n.${langGuess}`] = remoteDesc;
              }
              updatedProductNames++;
            }

            const currentBarcode = String(prod?.mcgBarcode || '').trim();
            if (barcode && barcode !== currentBarcode) {
              setPayload.mcgBarcode = barcode;
            }

            if (Object.keys(setPayload).length && !isDry) {
              await Product.updateOne({ _id: prod._id }, { $set: setPayload });
            }
          }

          if (variant && variant._id) {
            const result = await upsertInventoryFor({ productId: prod._id, variantId: variant._id, qty: qtySafe });
            if (result?.skippedConflict) skippedConflict++;
            else if (result?.skippedNoop) skippedNoop++;
            else if (result?.applied) updated++;
          } else {
            const result = await upsertInventoryFor({ productId: prod._id, qty: qtySafe, size: 'Default', color: 'Default' });
            if (result?.skippedConflict) skippedConflict++;
            else if (result?.skippedNoop) skippedNoop++;
            else if (result?.inv && result.inv.wasNew) created++;
            else if (result?.applied) updated++;
          }
        } catch (err) {
          errors++;
        }
      }
    };

    if (isUpli || !doLoop) {
      const data = await getItemsList({ PageNumber: pageNum, PageSize: effPageSize });
      const items = Array.isArray(data?.items || data?.data || data?.Items) ? (data?.items || data?.data || data?.Items) : (Array.isArray(data) ? data : []);
      await processItems(items);
    } else {
      // Legacy: paginate until empty
      while (true) {
        const data = await getItemsList({ PageNumber: pageNum, PageSize: effPageSize });
        const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
        if (!items.length) break;
        await processItems(items);
        if (!syncAll) break; // process only one page unless syncAll=true
        pageNum++;
      }
    }

    res.json({
      ok: true,
      dryRun: isDry,
      processed,
      updated,
      created,
      skippedNoMatch,
      skippedNoop,
      skippedConflict,
      skippedArchivedAttr,
      skippedArchivedProducts,
      updatedProductNames,
      updatedProductPrices,
      updatedVariantPrices,
      errors
    });
  } catch (e) {
    const status = e?.status || 500;
    res.status(status).json({ message: e?.message || 'mcg_sync_inventory_failed' });
  }
});

// Force an immediate automated stock sync using the scheduler's logic (single run)
// POST /api/mcg/auto-sync/run-now { }
router.post('/auto-sync/run-now', adminAuth, async (req, res) => {
  try {
    const s = await Settings.findOne();
    if (!s?.mcg?.enabled) return res.status(412).json({ message: 'MCG integration disabled' });
    await runMcgSyncOnce();
    return res.json({ ok: true, message: 'MCG auto sync executed once' });
  } catch (e) {
    const status = e?.status || 500;
    res.status(status).json({ message: e?.message || 'mcg_auto_sync_run_failed' });
  }
});

// Import items from MCG into Products (create-only, skip duplicates)
router.post('/sync-items', adminAuth, async (req, res) => {
  try {
    const s = await Settings.findOne();
    if (!s?.mcg?.enabled) return res.status(412).json({ message: 'MCG integration disabled' });

  const { defaultCategoryId, page, pageSize, dryRun, syncAll } = req.body || {};
    const dry = !!dryRun || String(req.query?.dryRun || '').toLowerCase() === 'true';

    // Detect Uplîcali flavor which ignores pagination and returns the full list
    const apiFlavor = String(s?.mcg?.apiFlavor || '').trim().toLowerCase();
    const baseUrl = String(s?.mcg?.baseUrl || '').trim();
    const isUpli = apiFlavor === 'uplicali' || /apis\.uplicali\.com/i.test(baseUrl) || /SuperMCG\/MCG_API/i.test(baseUrl);

    // Pagination loop: disabled for Uplîcali since their API returns all items regardless of page params
    const doLoop = !isUpli && ( !!syncAll || !Number.isFinite(Number(page)) || !Number.isFinite(Number(pageSize)) );
    const effPageSize = Number.isFinite(Number(pageSize)) && Number(pageSize) > 0 ? Number(pageSize) : 200;
    let pageNum = Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    let totalCount = 0;

    // Accumulators across pages
  const createdAll = [];
  let skippedByMissingKey = 0;
  let skippedAsDuplicate = 0;
  let skippedByBlocklist = 0;
  let skippedByArchivedAttribute = 0;
  let skippedArchivedProducts = 0;
  let incomingTotal = 0;
  // Maintain seen set across the whole run to avoid duplicates across pages (by mcgItemId only)
  const seenIds = new Set();
    // Track name updates for existing products whose MCG name changed
    const updatedNames = [];
    const updatedBarcodes = [];
    const updatedPrices = [];

    // Determine category
    let categoryId = null;
    if (typeof defaultCategoryId === 'string' && /^[a-fA-F0-9]{24}$/.test(defaultCategoryId)) {
      const ok = await Category.findById(defaultCategoryId).select('_id');
      if (ok) categoryId = ok._id;
    }
    if (!categoryId) {
      const first = await Category.findOne({}).select('_id').sort({ createdAt: 1 });
      if (first) categoryId = first._id;
    }
    if (!categoryId) return res.status(400).json({ message: 'No category available; create a category first or pass defaultCategoryId' });

    const taxMultiplier = normalizeTaxMultiplier(s?.mcg?.taxMultiplier ?? 1.18);

    // Load blocklisted + archived identifiers to avoid recreating deleted products
    const [blockDocs, archivedDocs] = await Promise.all([
      McgItemBlock.find({}, 'barcode mcgItemId').lean(),
      McgArchivedItem.find({}, 'barcode mcgItemId').lean()
    ]);
    const blockedBarcodes = new Set();
    const blockedItemIds = new Set();
    const normalizeBlockKey = (value) => {
      if (value === undefined || value === null) return '';
      return String(value).trim().toLowerCase();
    };
    const canonicalKey = (value) => {
      const s = normalizeBlockKey(value);
      if (!s) return '';
      return s.replace(/[^a-z0-9]/g, '');
    };
    const stripLeadingZerosNumeric = (value) => {
      const s = canonicalKey(value);
      if (!s) return '';
      if (!/^\d+$/.test(s)) return '';
      const stripped = s.replace(/^0+/, '');
      return stripped || '0';
    };
    for (const doc of [...(blockDocs || []), ...(archivedDocs || [])]) {
      const bc = normalizeBlockKey(doc?.barcode);
      const id = normalizeBlockKey(doc?.mcgItemId);
      const bcCanonical = canonicalKey(doc?.barcode);
      const idCanonical = canonicalKey(doc?.mcgItemId);
      const bcNoZeros = stripLeadingZerosNumeric(doc?.barcode);
      const idNoZeros = stripLeadingZerosNumeric(doc?.mcgItemId);
      if (bc) blockedBarcodes.add(bc);
      if (bcCanonical) blockedBarcodes.add(bcCanonical);
      if (bcNoZeros) blockedBarcodes.add(bcNoZeros);
      if (id) blockedItemIds.add(id);
      if (idCanonical) blockedItemIds.add(idCanonical);
      if (idNoZeros) blockedItemIds.add(idNoZeros);
    }
    const isBlockedIdentifier = (mcgId, barcode) => {
      const idKey = normalizeBlockKey(mcgId);
      const idKeyCanonical = canonicalKey(mcgId);
      const idKeyNoZeros = stripLeadingZerosNumeric(mcgId);
      if (idKey && blockedItemIds.has(idKey)) return true;
      if (idKeyCanonical && blockedItemIds.has(idKeyCanonical)) return true;
      if (idKeyNoZeros && blockedItemIds.has(idKeyNoZeros)) return true;
      const bcKey = normalizeBlockKey(barcode);
      const bcKeyCanonical = canonicalKey(barcode);
      const bcKeyNoZeros = stripLeadingZerosNumeric(barcode);
      if (bcKey && blockedBarcodes.has(bcKey)) return true;
      if (bcKeyCanonical && blockedBarcodes.has(bcKeyCanonical)) return true;
      if (bcKeyNoZeros && blockedBarcodes.has(bcKeyNoZeros)) return true;
      return false;
    };

    // Helper to process a single page of results
    const processPage = async (items) => {
      // Build per-page dedupe sets and fetch existing once per page
      const ids = items
        .map(it => (it?.ItemID ?? it?.ItemId ?? it?.itemID ?? it?.id ?? it?.itemId ?? it?.item_id ?? '') + '')
        .map(v => v.trim())
        .filter(Boolean);
      const barcodes = items
        .map(it => (it?.Barcode ?? it?.BarCode ?? it?.ItemCode ?? it?.ItemCODE ?? it?.itemCode ?? it?.barcode ?? it?.item_code ?? it?.code ?? '') + '')
        .map(v => v.trim())
        .filter(Boolean);
      const uniqueIds = Array.from(new Set(ids));
      const uniqueBarcodes = Array.from(new Set(barcodes));

      const existing = await Product.find({ $or: [
        uniqueIds.length ? { mcgItemId: { $in: uniqueIds } } : null,
        uniqueBarcodes.length ? { mcgBarcode: { $in: uniqueBarcodes } } : null
      ].filter(Boolean) }).select('mcgItemId mcgBarcode isActive _id name price');
      const existId = new Set(existing.filter(p => p.isActive !== false).map(p => (p.mcgItemId || '').toString()));
      const existBarcode = new Set(existing.filter(p => p.isActive !== false).map(p => (p.mcgBarcode || '').toString()));
      const existById = new Map(existing.map(p => [ (p.mcgItemId || '').toString(), p ]));
      const existByBarcode = new Map(existing.map(p => [ (p.mcgBarcode || '').toString(), p ]));

      const toInsert = [];
      const reactivated = [];
      for (const it of items) {
        if (hasArchivedAttribute(it)) {
          skippedByArchivedAttribute++;
          continue;
        }
      const mcgId = ((it?.ItemID ?? it?.ItemId ?? it?.itemID ?? it?.id ?? it?.itemId ?? it?.item_id ?? '') + '').trim();
      const barcode = ((it?.Barcode ?? it?.BarCode ?? it?.ItemCode ?? it?.ItemCODE ?? it?.itemCode ?? it?.barcode ?? it?.item_code ?? it?.code ?? '') + '').trim();
        if (!mcgId && !barcode) { skippedByMissingKey++; continue; }
        if (isBlockedIdentifier(mcgId, barcode)) {
          skippedByBlocklist++;
          try { console.log('[mcg][sync-items] skip blocked: item_id=%s barcode=%s', String(mcgId || ''), String(barcode || '')); } catch {}
          continue;
        }
        const existingDoc = (mcgId && existById.get(mcgId)) || (barcode && existByBarcode.get(barcode));
        if (existingDoc && existingDoc.isActive === false) {
          skippedArchivedProducts++;
          continue;
        }

  const isDupById = mcgId && (existId.has(mcgId) || seenIds.has(mcgId));
  const isDupByBarcode = barcode && existBarcode.has(barcode);
  const isDuplicate = !!existingDoc || !!isDupById || !!isDupByBarcode;
  if (isDuplicate) {
    // Attempt name resync for existing active product
    try {
      const pDoc = existingDoc || (mcgId ? existById.get(mcgId) : null) || (barcode ? existByBarcode.get(barcode) : null);
      if (pDoc && pDoc.isActive !== false) {
        const numericLike = (s) => /^\d{8,}$/.test(String(s||''));
        let remoteName = (it?.ItemName ?? it?.Name ?? it?.name ?? it?.item_name ?? it?.ItemDescription ?? it?.Description ?? '') + '';
        remoteName = remoteName.trim();
        const descTemp = (it?.ItemDescription ?? it?.Description ?? it?.description ?? '') + '';
        const remoteDesc = descTemp.trim();
        if (!remoteName || numericLike(remoteName)) remoteName = remoteDesc || remoteName;
        const langGuess = detectLangFromText(`${remoteName} ${remoteDesc}`);
        if (remoteName && remoteName !== pDoc.name && remoteName.toLowerCase() !== String(pDoc.name||'').toLowerCase()) {
          if (!dry) {
            const setPayload = { name: remoteName };
            if (langGuess && langGuess !== 'en') {
              setPayload[`name_i18n.${langGuess}`] = remoteName;
              if (remoteDesc) setPayload[`description_i18n.${langGuess}`] = remoteDesc;
            }
            await Product.updateOne({ _id: pDoc._id }, { $set: setPayload });
            updatedNames.push({ mcgItemId: mcgId, before: pDoc.name, after: remoteName, lang: langGuess || 'en' });
          } else {
            updatedNames.push({ mcgItemId: mcgId, before: pDoc.name, after: remoteName, lang: langGuess || 'en', dryRun: true });
          }
        }
        const nextPrice = resolvePriceFromMcgItem(it, taxMultiplier);
        const currentPrice = Number(pDoc?.price);
        if (!Number.isFinite(currentPrice) || currentPrice !== nextPrice) {
          if (!dry) {
            await Product.updateOne({ _id: pDoc._id }, { $set: { price: nextPrice } });
            updatedPrices.push({ mcgItemId: mcgId, before: Number.isFinite(currentPrice) ? currentPrice : null, after: nextPrice });
          } else {
            updatedPrices.push({ mcgItemId: mcgId, before: Number.isFinite(currentPrice) ? currentPrice : null, after: nextPrice, dryRun: true });
          }
        }
        const currentBarcode = (pDoc.mcgBarcode || '').trim();
        if (barcode && barcode !== currentBarcode) {
          if (!dry) {
            await Product.updateOne({ _id: pDoc._id }, { $set: { mcgBarcode: barcode } });
            updatedBarcodes.push({ productId: String(pDoc._id), mcgItemId: mcgId || null, before: currentBarcode || null, after: barcode });
          } else {
            updatedBarcodes.push({ productId: String(pDoc._id), mcgItemId: mcgId || null, before: currentBarcode || null, after: barcode, dryRun: true });
          }
        }
        if (mcgId && String(pDoc?.mcgItemId || '').trim() !== mcgId) {
          if (!dry) {
            await Product.updateOne({ _id: pDoc._id }, { $set: { mcgItemId: mcgId } });
          }
        }
      }
    } catch {}
    skippedAsDuplicate++; continue; }
  // Prefer human-friendly names: ItemName/Name; fall back to ItemDescription/Description when name looks numeric.
  const numericLike = (s) => /^\d{8,}$/.test(String(s||''));
  let name = (it?.ItemName ?? it?.Name ?? it?.name ?? it?.item_name ?? it?.ItemDescription ?? it?.Description ?? '') + '';
  name = name.trim();
  const desc = (it?.ItemDescription ?? it?.Description ?? it?.description ?? (it?.item_department ? `Department: ${it.item_department}` : 'Imported from MCG')) + '';
  if (!name || numericLike(name)) {
    name = (desc || barcode || mcgId || 'MCG Item') + '';
  }
      // Prefer provider's final (VAT-inclusive) price when available; otherwise apply configured tax multiplier
      let price = resolvePriceFromMcgItem(it, taxMultiplier);
      const stockRaw = Number(it?.StockQuantity ?? it?.stock ?? it?.item_inventory ?? 0);
      const stock = Number.isFinite(stockRaw) ? Math.max(0, stockRaw) : 0;
      const img = (it?.ImageURL ?? it?.imageUrl ?? (it?.item_image || '')) + '';
      const imgOk = /^(https?:\/\/|\/)/i.test(img) ? img : '';
      const images = imgOk ? [imgOk] : ['/placeholder-image.svg'];
      // Detect language and seed i18n maps so Quick Translate tabs show the right values
      const detectedLang = detectLangFromText(`${name} ${desc}`);
      const name_i18n = (detectedLang === 'en') ? undefined : new Map([[detectedLang, name]]);
      const description_i18n = (detectedLang === 'en') ? undefined : new Map([[detectedLang, desc]]);
      const doc = {
        name,
        description: desc,
        price,
        images,
        category: categoryId,
        stock,
        relatedProducts: [],
        isActive: true,
        mcgItemId: mcgId || undefined,
        // Keep real barcode when present; UI will display mcgItemId if barcode is missing
        mcgBarcode: barcode || undefined,
        ...(name_i18n ? { name_i18n } : {}),
        ...(description_i18n ? { description_i18n } : {})
      };
        toInsert.push(doc);
        // Mark keys as seen to prevent duplicates within the same run
  if (mcgId) seenIds.add(mcgId);
      }

      incomingTotal += items.length;
      if (dry) {
        return { toInsert, created: [], insertedCount: 0, reactivated: [], reactivatedCount: 0 };
      }
      let created = [];
      if (toInsert.length) {
        created = await Product.insertMany(toInsert, { ordered: false }).catch((e) => {
          if (e?.writeErrors) {
            const inserted = e.result?.nInserted || 0;
            return toInsert.slice(0, inserted);
          }
          throw e;
        });
      }
      createdAll.push(...created);
      return { toInsert, created, insertedCount: created.length, reactivated, reactivatedCount: reactivated.length };
    };

    // Loop pages
  let iterations = 0;
  const reactivatedAll = [];
    while (true) {
      // For Uplîcali flavor, the service ignores PageNumber/PageSize – call once and break
      const data = await getItemsList({ PageNumber: isUpli ? undefined : pageNum, PageSize: isUpli ? undefined : effPageSize, Filter: req.body?.Filter });
      const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data?.items) ? data.items : []);
      if (!totalCount) totalCount = Number(data?.TotalCount || 0) || 0;
      if (!items || items.length === 0) break;
      const { reactivated, reactivatedCount } = await processPage(items);
      if (reactivatedCount) reactivatedAll.push(...reactivated);
      if (!doLoop || isUpli) break; // single page mode for explicit request or Uplîcali flavor
      // stop if this was the last page
      if (items.length < effPageSize) break;
      pageNum += 1;
      iterations += 1;
      if (iterations > 10000) break; // absolute safety
    }

    if (dry) {
      return res.json({
        dryRun: true,
        page: Number(page)||1,
        pageSize: Number(pageSize)||effPageSize,
        totalCount,
        incoming: incomingTotal,
        uniqueIds: undefined,
        uniqueBarcodes: undefined,
        existingById: undefined,
        existingByBarcode: undefined,
        toInsert: createdAll.length,
        skippedByMissingKey,
        skippedByArchivedAttribute,
        skippedByBlocklist,
        skippedArchivedProducts,
        skippedAsDuplicate,
        sampleNew: createdAll.slice(0, 3).map(x => ({ name: x.name, mcgItemId: x.mcgItemId, mcgBarcode: x.mcgBarcode })),
        updatedNames,
        updatedPrices,
        updatedBarcodes
      });
    }

    // After creating products, create initial inventory rows per product in Main Warehouse
    if (createdAll.length || reactivatedAll.length) {
      try {
        // Ensure at least one warehouse exists
        let warehouses = await Warehouse.find({});
        if (!warehouses || warehouses.length === 0) {
          const main = await Warehouse.findOneAndUpdate(
            { name: 'Main Warehouse' },
            { $setOnInsert: { name: 'Main Warehouse' } },
            { new: true, upsert: true }
          );
          warehouses = main ? [main] : [];
        }
        const mainWh = warehouses.find(w => String(w?.name || '').toLowerCase() === 'main warehouse') || warehouses[0];
        if (mainWh && (createdAll.length || reactivatedAll.length)) {
          // Build inventory docs for created products
          const invDocs = createdAll.map(p => new Inventory({
            product: p._id,
            size: 'Default',
            color: 'Default',
            quantity: Math.max(0, Number(p?.stock) || 0),
            warehouse: mainWh._id,
            location: mainWh.name,
            lowStockThreshold: 5
          }));
          // Upsert inventory for reactivated products
          for (const p of reactivatedAll) {
            try {
              const filter = { product: p._id, size: 'Default', color: 'Default', warehouse: mainWh._id };
              const updateInv = { $set: { quantity: Math.max(0, Number(p?.stock) || 0) }, $setOnInsert: { product: p._id, size: 'Default', color: 'Default', warehouse: mainWh._id } };
              await Inventory.findOneAndUpdate(filter, updateInv, { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true });
            } catch {}
          }
          // Insert inventory rows (ignore duplicates if any)
          if (invDocs.length) {
            try {
              await Inventory.insertMany(invDocs, { ordered: false });
            } catch (invErr) {
              // tolerate partial insertion errors
              try { console.warn('[mcg][sync-items] inventory insert partial', invErr?.message || invErr); } catch {}
            }
          }
          // Create history entries
          const historyDocs = [
            ...createdAll.map(p => new InventoryHistory({
            product: p._id,
            type: 'increase',
            quantity: Math.max(0, Number(p?.stock) || 0),
            reason: 'Initial stock (MCG import)',
            user: req.user?._id
            })),
            ...reactivatedAll.map(p => new InventoryHistory({
              product: p._id,
              type: 'increase',
              quantity: Math.max(0, Number(p?.stock) || 0),
              reason: 'Reactivated from MCG sync',
              user: req.user?._id
            }))
          ];
          try { if (historyDocs.length) await InventoryHistory.insertMany(historyDocs, { ordered: false }); } catch {}
          // Recompute product stocks to reflect inserted inventory
          try {
            for (const p of [...createdAll, ...reactivatedAll]) {
              try { await inventoryService.recomputeProductStock(p._id); } catch {}
            }
          } catch {}
        }
      } catch (invSetupErr) {
        try { console.warn('[mcg][sync-items] warehouse/inventory setup skipped:', invSetupErr?.message || invSetupErr); } catch {}
      }
    }
    res.json({
      page: Number(page)||1,
      pageSize: Number(pageSize)||effPageSize,
      totalCount,
      created: createdAll.length,
      reactivated: reactivatedAll.length,
      skipped: Math.max(0, incomingTotal - createdAll.length - reactivatedAll.length),
      skippedByMissingKey,
      skippedByArchivedAttribute,
      skippedByBlocklist,
      skippedArchivedProducts,
      skippedAsDuplicate,
      sampleNew: createdAll.slice(0, 3).map(x => ({ name: x.name, mcgItemId: x.mcgItemId, mcgBarcode: x.mcgBarcode })),
      updatedNames,
      updatedPrices,
      updatedBarcodes
    });
  } catch (e) {
    const status = e?.status || e?.response?.status || 400;
    res.status(status).json({ message: e?.message || 'mcg_sync_items_failed' });
  }
});

// Backfill product names/descriptions for existing items from MCG
// POST /api/mcg/backfill-names
// Behavior:
// - Reads the full items list from MCG (single call for Uplîcali, paged for legacy)
// - For each local Product that has mcgItemId or mcgBarcode, if its current name is empty,
//   equals its barcode, equals its mcgItemId, or is a long numeric-only token (likely EAN),
//   updates name/description from the MCG item fields. Language is detected heuristically
//   and stored into name_i18n/description_i18n maps as well (base name remains readable).
router.post('/backfill-names', adminAuth, async (req, res) => {
  try {
    const s = await Settings.findOne();
    if (!s?.mcg?.enabled) return res.status(412).json({ message: 'MCG integration disabled' });

    const apiFlavor = String(s?.mcg?.apiFlavor || '').trim().toLowerCase();
    const baseUrl = String(s?.mcg?.baseUrl || '').trim();
    const isUpli = apiFlavor === 'uplicali' || /apis\.uplicali\.com/i.test(baseUrl) || /SuperMCG\/MCG_API/i.test(baseUrl);

    // Pull items from MCG
    const itemsById = new Map();
    const itemsByBarcode = new Map();
    const addItem = (it) => {
      if (!it) return;
      const id = ((it?.ItemID ?? it?.id ?? it?.itemId ?? it?.item_id ?? '') + '').trim();
      const bc = ((it?.Barcode ?? it?.barcode ?? it?.item_code ?? '') + '').trim();
      if (id) itemsById.set(id, it);
      if (bc) itemsByBarcode.set(bc, it);
    };

    const effPageSize = 500;
    if (isUpli) {
      const data = await getItemsList({});
      const list = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []));
      for (const it of list) addItem(it);
    } else {
      let pageNum = 1;
      while (true) {
        const data = await getItemsList({ PageNumber: pageNum, PageSize: effPageSize });
        const list = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
        if (!list.length) break;
        for (const it of list) addItem(it);
        if (list.length < effPageSize) break;
        pageNum += 1;
        if (pageNum > 10000) break; // absolute safety
      }
    }

    // Fetch mapped products
    const products = await Product.find({ $or: [
      { mcgItemId: { $exists: true, $ne: '' } },
      { mcgBarcode: { $exists: true, $ne: '' } }
    ] }).select('name description mcgItemId mcgBarcode name_i18n description_i18n').lean();

    const isNumericLike = (s) => /^\d{8,}$/.test(String(s||''));
    let checked = 0; let updated = 0; let skipped = 0; let notFound = 0;
    const bulk = [];
    for (const p of products) {
      checked++;
      const id = String(p.mcgItemId || '').trim();
      const bc = String(p.mcgBarcode || '').trim();
      const it = (id && itemsById.get(id)) || (bc && itemsByBarcode.get(bc)) || null;
      if (!it) { notFound++; continue; }

      const pickRawName = (it?.ItemName ?? it?.Name ?? it?.name ?? it?.item_name ?? it?.ItemDescription ?? it?.Description ?? '').toString().trim();
      const srcDesc = (it?.ItemDescription ?? it?.Description ?? it?.description ?? (it?.item_department ? `Department: ${it.item_department}` : '')).toString();
      const isNumericLike = (s) => /^\d{8,}$/.test(String(s||''));
      const srcName = (pickRawName && !isNumericLike(pickRawName)) ? pickRawName : (srcDesc || pickRawName);
      if (!srcName) { skipped++; continue; }

      const curr = String(p.name || '').trim();
      const shouldReplace = !curr || curr === id || curr === bc || isNumericLike(curr) || curr.toLowerCase() === 'mcg item';
      if (!shouldReplace) { skipped++; continue; }

      const lang = detectLangFromText(`${srcName} ${srcDesc}`);
      const set = { name: srcName };
      if (srcDesc) set.description = srcDesc;
      if (lang && lang !== 'en') {
        set[`name_i18n.${lang}`] = srcName;
        if (srcDesc) set[`description_i18n.${lang}`] = srcDesc;
      }
      bulk.push({ updateOne: { filter: { _id: p._id }, update: { $set: set } } });
      updated++;
    }

    if (bulk.length) {
      try { await Product.bulkWrite(bulk, { ordered: false }); } catch {}
    }

    return res.json({ ok: true, checked, updated, skipped, notFound, itemsById: itemsById.size, itemsByBarcode: itemsByBarcode.size });
  } catch (e) {
    const status = e?.status || e?.response?.status || 500;
    res.status(status).json({ message: e?.message || 'mcg_backfill_names_failed' });
  }
});

// Sync a single existing product from MCG by mcgItemId or mcgBarcode
router.post('/sync-product/:productId', adminAuth, async (req, res) => {
  try {

    const s = await Settings.findOne();
    if (!s?.mcg?.enabled) return res.status(412).json({ message: 'MCG integration disabled' });

    const { productId } = req.params;
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    if (product.isActive === false) {
      return res.status(409).json({ message: 'Archived products cannot be synced from MCG' });
    }

    // Determine lookup keys: prefer explicit override, then saved mapping on product
    let mcgItemId = (req.body?.mcgItemId || product.mcgItemId || '').toString().trim();
    let mcgBarcode = (req.body?.mcgBarcode || product.mcgBarcode || '').toString().trim();
    if (!mcgItemId && !mcgBarcode) {
      return res.status(400).json({ message: 'Provide mcgItemId or mcgBarcode on the product or in request body' });
    }

    const archivedFilters = [];
    if (mcgItemId) archivedFilters.push({ mcgItemId });
    if (mcgBarcode) archivedFilters.push({ barcode: mcgBarcode });
    if (archivedFilters.length) {
      const archivedMatch = await McgArchivedItem.findOne({ $or: archivedFilters }).lean();
      if (archivedMatch) {
        return res.status(409).json({ message: 'This MCG item was archived and cannot be synced' });
      }
    }

    // Fetch items. For Uplîcali flavor the service ignores Filter and returns the whole list,
    // so we must match client-side by id/barcode.
    const Filter = mcgItemId ? { ItemID: mcgItemId } : { Barcode: mcgBarcode };
    const data = await getItemsList({ PageNumber: 1, PageSize: 1, Filter });
    const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data?.items) ? data.items : []);
    // Try to match exact item by various possible field names
    const norm = (v) => (v === undefined || v === null) ? '' : String(v).trim();
    const wantedId = norm(mcgItemId);
    const wantedBarcode = norm(mcgBarcode);
    const it = items.find(raw => {
      const id = norm(raw?.ItemID ?? raw?.id ?? raw?.itemId ?? raw?.item_id);
      const bc = norm(raw?.Barcode ?? raw?.barcode ?? raw?.item_code);
      return (wantedId && id && id === wantedId) || (wantedBarcode && bc && bc === wantedBarcode);
    }) || {};
    if (!Object.keys(it).length) return res.status(404).json({ message: 'No matching item found in MCG' });
    if (hasArchivedAttribute(it)) {
      return res.status(409).json({ message: 'This MCG item is marked as archived and cannot be synced' });
    }

    // Map fields
  const nameFromMcg = (it?.Name ?? it?.name ?? it?.item_name ?? '').toString();
  const descFromMcg = (it?.Description ?? it?.description ?? (it?.item_department ? `Department: ${it.item_department}` : '')).toString();
    const taxMultiplier = normalizeTaxMultiplier(s?.mcg?.taxMultiplier ?? 1.18);
    let price = resolvePriceFromMcgItem(it, taxMultiplier);
  const barcodeFromMcg = ((it?.Barcode ?? it?.barcode ?? it?.item_code ?? '') + '').trim();
  const idFromMcg = ((it?.ItemID ?? it?.id ?? it?.itemId ?? it?.item_id ?? '') + '').trim();

    // Decide target language
    const reqLangRaw = (req.query?.lang || req.body?.lang || '').toString().toLowerCase();
    const detected = detectLangFromText(`${nameFromMcg} ${descFromMcg}`);
    const targetLang = ['ar','he','en'].includes(reqLangRaw) ? reqLangRaw : detected;

    // Build atomic update combining base fields and i18n maps
    const $set = {};
    const $unset = {};
    // Default fields: set only when English or when empty/placeholder to avoid overwriting non-English defaults
    if (targetLang === 'en') {
      if (nameFromMcg) ($set).name = nameFromMcg;
      if (descFromMcg) ($set).description = descFromMcg;
    } else {
      if ((!product.name || product.name === 'MCG Item') && nameFromMcg) ($set).name = nameFromMcg;
      // Only set default description if it's empty; otherwise keep existing language-neutral value
      if ((!product.description || !product.description.trim()) && descFromMcg) ($set).description = descFromMcg;
      if (nameFromMcg) ($set)[`name_i18n.${targetLang}`] = nameFromMcg;
      if (descFromMcg) ($set)[`description_i18n.${targetLang}`] = descFromMcg;
    }
    if (typeof price === 'number') ($set).price = price;
    if (idFromMcg) ($set).mcgItemId = idFromMcg;
    if (barcodeFromMcg) ($set).mcgBarcode = barcodeFromMcg;

    const ops = { };
    if (Object.keys($set).length) ops.$set = $set;
    if (Object.keys($unset).length) ops.$unset = $unset;
    const updated = await Product.findByIdAndUpdate(productId, ops, { new: true });

    // Also upsert inventory using item inventory from MCG (if available)
    try {
      const qtyRaw = Number(it?.StockQuantity ?? it?.stock ?? it?.item_inventory ?? it?.qty ?? 0);
      const quantity = Number.isFinite(qtyRaw) ? Math.max(0, qtyRaw) : 0;
      // Resolve warehouse (create Main Warehouse if needed)
      let warehouses = await Warehouse.find({});
      if (!warehouses || warehouses.length === 0) {
        const main = await Warehouse.findOneAndUpdate(
          { name: 'Main Warehouse' },
          { $setOnInsert: { name: 'Main Warehouse' } },
          { new: true, upsert: true }
        );
        warehouses = main ? [main] : [];
      }
      if (warehouses && warehouses.length) {
        const mainWh = warehouses.find(w => String(w?.name || '').toLowerCase() === 'main warehouse') || warehouses[0];
        // If product has variants, try smart mapping:
        // 1) If a variant barcode matches MCG barcode -> update that variant row
        // 2) Else if exactly one variant exists -> update that variant row
        // 3) Else fallback to Default/Default non-variant row
        let didVariant = false;
        try {
          const prod = await Product.findById(productId).select('variants').lean();
          const variants = Array.isArray(prod?.variants) ? prod.variants : [];
          let targetVariantId = null;
          if (variants.length > 0) {
            // Try barcode match first
            if (barcodeFromMcg) {
              const match = variants.find(v => String(v?.barcode || '').trim() === barcodeFromMcg);
              if (match && match._id) targetVariantId = String(match._id);
            }
            // If none matched and there is exactly one variant, use it
            if (!targetVariantId && variants.length === 1 && variants[0]?._id) {
              targetVariantId = String(variants[0]._id);
            }
          }
          if (targetVariantId) {
            const filterVar = { product: productId, variantId: targetVariantId, warehouse: mainWh._id };
            const setOnInsert = { product: productId, variantId: targetVariantId, warehouse: mainWh._id };
            await Inventory.findOneAndUpdate(
              filterVar,
              { $set: { quantity }, $setOnInsert: setOnInsert },
              { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
            );
            didVariant = true;
          }
        } catch {}

        if (!didVariant) {
          const filter = { product: productId, size: 'Default', color: 'Default', warehouse: mainWh._id };
          const updateInv = { $set: { quantity }, $setOnInsert: { product: productId, size: 'Default', color: 'Default', warehouse: mainWh._id } };
          await Inventory.findOneAndUpdate(filter, updateInv, { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true });
        }
        try { await inventoryService.recomputeProductStock(productId); } catch {}
      }
    } catch (invErr) {
      try { console.warn('[mcg][sync-product] inventory upsert skipped:', invErr?.message || invErr); } catch {}
    }

    res.json(updated);
  } catch (e) {
    const status = e?.status || e?.response?.status || 400;
    res.status(status).json({ message: e?.message || 'mcg_sync_product_failed' });
  }
});

// Delete mapped identifiers from MCG without removing the local product
router.post('/delete-product/:productId', adminAuth, async (req, res) => {
  try {
    const settings = await Settings.findOne();
    const rawAllow = req.body?.allowWhenDisabled;
    const allowWhenDisabled = rawAllow === undefined
      ? true
      : (typeof rawAllow === 'string'
          ? rawAllow.trim().toLowerCase() !== 'false'
          : rawAllow !== false);

    const { productId } = req.params;
    const includeVariants = req.body?.includeVariants !== false;
    const blocklist = req.body?.blocklist !== false;
    const archive = req.body?.archive !== false;
    const reasonRaw = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const reason = reasonRaw || 'manual_delete';
    const overrideMcgItemId = (req.body?.mcgItemId || '').toString().trim();
    const overrideBarcode = (req.body?.mcgBarcode || '').toString().trim();
    const additionalIdentifiers = Array.isArray(req.body?.identifiers) ? req.body.identifiers : [];

    const product = await Product.findById(productId).select('name mcgItemId mcgBarcode variants.mcgItemId variants.barcode');

    const identifierOptions = {
      includeVariants,
      additionalIdentifiers,
      overrideMcgItemId: overrideMcgItemId || undefined,
      overrideBarcode: overrideBarcode || undefined
    };
    const identifiers = collectMcgIdentifiers(product, identifierOptions);
    await ensureIdentifiersHaveMcgIds(identifiers, { groupOverride: req.body?.group });

    if (!product && !identifiers.mcgIds.size && !identifiers.barcodes.size) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (product && !identifiers.mcgIds.size && !identifiers.barcodes.size) {
      return res.status(400).json({ message: 'Product is not linked to MCG (missing barcode/item id)' });
    }

    let mcgArchive = null;
    if (archive) {
      mcgArchive = await markMcgItemsArchived(product, {
        identifiers,
        includeVariants,
        additionalIdentifiers,
        overrideMcgItemId: overrideMcgItemId || undefined,
        overrideBarcode: overrideBarcode || undefined,
        settingsDoc: settings,
        allowWhenDisabled,
        groupOverride: req.body?.group,
        sendUpdateItemRequest: true
      });
    }

    const mcgResp = await propagateMcgDeletion(product, {
      identifiers,
      includeVariants,
      settingsDoc: settings,
      allowWhenDisabled
    });

    if (mcgResp?.skipped && mcgResp.reason === 'mcg_disabled' && !allowWhenDisabled) {
      return res.status(412).json({ message: 'MCG integration disabled' });
    }

    if (blocklist) {
      await persistMcgBlocklistEntries(product, req.user?._id, reason, {
        identifiers,
        includeVariants,
        additionalIdentifiers,
        overrideMcgItemId: overrideMcgItemId || undefined,
        overrideBarcode: overrideBarcode || undefined
      });
    }

    if (archive) {
      await persistMcgArchiveEntries(product, req.user?._id, reason, {
        identifiers,
        includeVariants,
        additionalIdentifiers,
        overrideMcgItemId: overrideMcgItemId || undefined,
        overrideBarcode: overrideBarcode || undefined
      });
    }

    if (product && (product.mcgItemId || product.mcgBarcode)) {
      const unsetPayload = {};
      if (product.mcgItemId) unsetPayload.mcgItemId = '';
      if (product.mcgBarcode) unsetPayload.mcgBarcode = '';
      try {
        if (Object.keys(unsetPayload).length) {
          await Product.updateOne({ _id: product._id }, { $unset: unsetPayload });
        }
      } catch (clearErr) {
        try { console.warn('[mcg][delete-product] failed to clear mcg mappings', clearErr?.message || clearErr); } catch {}
      }
    }

    res.json({
      ok: mcgResp?.skipped ? false : mcgResp?.ok !== false,
      deletedCount: identifiers.mcgIds.size + identifiers.barcodes.size,
      mcgItemIds: Array.from(identifiers.mcgIds),
      barcodes: Array.from(identifiers.barcodes),
      mcgResponse: mcgResp,
      mcgArchive
    });
  } catch (e) {
    const status = e?.status || e?.response?.status || 500;
    res.status(status).json({ message: e?.message || 'mcg_delete_product_failed' });
  }
});

// Push a single absolute inventory value to MCG for diagnostics/testing
// POST /api/mcg/push-absolute
// Body can be: { productId, variantId?, quantity?, group? } or { code?, id?, quantity?, group? }
router.post('/push-absolute', adminAuth, async (req, res) => {
  try {
    const { productId, variantId, code, id, quantity, group } = req.body || {};
    const s = await Settings.findOne();
    if (!s?.mcg?.enabled) return res.status(412).json({ message: 'MCG integration disabled' });

    // Resolve identifier
    const norm = (v) => (v === undefined || v === null) ? '' : String(v).trim();
    let item_code = norm(code);
    let item_id = norm(id);

    let computedQty = undefined;
    if (!item_code && !item_id) {
      // Derive mapping from product
      if (!productId) return res.status(400).json({ message: 'Provide productId (or code/id)' });
      const prod = await Product.findById(productId).select('variants mcgBarcode mcgItemId').lean();
      if (!prod) return res.status(404).json({ message: 'Product not found' });
      if (variantId && Array.isArray(prod.variants)) {
        const v = prod.variants.find(x => String(x?._id) === String(variantId));
        if (v && v.barcode) item_code = norm(v.barcode);
      }
      if (!item_code) item_code = norm(prod.mcgBarcode);
      const preferItemId = String(s?.mcg?.apiFlavor || '').toLowerCase() === 'uplicali' && !!s?.mcg?.preferItemId && norm(prod.mcgItemId);
      if (preferItemId) {
        item_id = norm(prod.mcgItemId);
        item_code = '';
      } else if (!item_code && norm(prod.mcgItemId)) {
        item_id = norm(prod.mcgItemId);
      }
      if (!item_code && !item_id) return res.status(400).json({ message: 'No MCG mapping found. Set variant.barcode or product.mcgBarcode (or mcgItemId for Uplîcali).' });
    }

    // Resolve quantity: use provided override or compute from Inventory
    const qtyOverride = Number(quantity);
    if (Number.isFinite(qtyOverride) && qtyOverride >= 0) {
      computedQty = Math.floor(qtyOverride);
    } else {
      if (productId) {
        const filter = variantId ? { product: productId, variantId } : { product: productId };
        const rows = await Inventory.find(filter).select('quantity').lean();
        const total = rows.reduce((s,x)=> s + (Number(x.quantity)||0), 0);
        computedQty = Math.max(0, total);
      } else {
        return res.status(400).json({ message: 'Provide quantity or productId to compute from inventory' });
      }
    }

    const grp = (group !== undefined && group !== null && !Number.isNaN(Number(group))) ? Number(group) : (Number.isFinite(Number(s?.mcg?.group)) ? Number(s.mcg.group) : undefined);
    const item = { ...(item_code ? { item_code } : {}), ...(item_id ? { item_id } : {}), item_inventory: computedQty };
    const resp = await setItemsList([item], grp);
    return res.json({ ok: true, group: grp ?? 'default', pushed: item, response: resp });
  } catch (e) {
    const status = e?.status || 500;
    res.status(status).json({ message: e?.message || 'mcg_push_absolute_failed' });
  }
});
