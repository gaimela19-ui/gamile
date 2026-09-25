import express from 'express';
import Settings from '../models/Settings.js';
import { adminAuth } from '../middleware/auth.js';
import { getItemQuantity, updateItem, testConnectivity, getLastRequest, getErrorMessage, listItems } from '../services/rivhitService.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';

const router = express.Router();

// Get Rivhit config (mask token)
router.get('/config', adminAuth, async (req, res) => {
  try {
    let s = await Settings.findOne();
    if (!s) s = await Settings.create({});
    const r = s.rivhit || {};
    res.json({
      enabled: !!r.enabled,
      apiUrl: r.apiUrl || 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc',
      tokenApi: r.tokenApi ? '***' : '',
      defaultStorageId: r.defaultStorageId || 0,
      transport: r.transport || 'json'
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Update Rivhit config
router.put('/config', adminAuth, async (req, res) => {
  try {
    let s = await Settings.findOne().sort({ updatedAt: -1 });
    if (!s) s = new Settings();
    const inc = req.body || {};
    s.rivhit = s.rivhit || { enabled: false, apiUrl: 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc', tokenApi: '', defaultStorageId: 0, transport: 'json' };
    if (typeof inc.enabled !== 'undefined') s.rivhit.enabled = !!inc.enabled;
    if (typeof inc.apiUrl === 'string') s.rivhit.apiUrl = inc.apiUrl.trim();
    if (typeof inc.defaultStorageId !== 'undefined') {
      const n = Number(inc.defaultStorageId);
      s.rivhit.defaultStorageId = Number.isFinite(n) && n >= 0 ? n : 0;
    }
    if (typeof inc.transport === 'string' && ['json', 'soap'].includes(inc.transport)) {
      s.rivhit.transport = inc.transport;
    }
    if (typeof inc.tokenApi === 'string') {
      if (inc.tokenApi !== '***') s.rivhit.tokenApi = inc.tokenApi.trim();
    }
    try { s.markModified('rivhit'); } catch {}
    await s.save();
    res.json({ enabled: s.rivhit.enabled, apiUrl: s.rivhit.apiUrl, tokenApi: s.rivhit.tokenApi ? '***' : '', defaultStorageId: s.rivhit.defaultStorageId || 0, transport: s.rivhit.transport || 'json' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Test connectivity
router.get('/test', adminAuth, async (req, res) => {
  try {
    const r = await testConnectivity();
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'test_failed' });
  }
});

// Diagnostics: last request/response seen by Rivhit
router.get('/status/last', adminAuth, async (req, res) => {
  try {
    const format = typeof req.query.format === 'string' ? req.query.format : 'json';
    const r = await getLastRequest(format);
    res.json(r);
  } catch (e) {
    res.status(400).json({ message: e?.message || 'status_last_failed' });
  }
});

// Diagnostics: get error message for an error code
router.get('/status/error-message', adminAuth, async (req, res) => {
  try {
    const code = Number(req.query.code);
    const r = await getErrorMessage(code || 0);
    res.json(r);
  } catch (e) {
    res.status(400).json({ message: e?.message || 'status_error_message_failed' });
  }
});

// Get current quantity for an item
router.post('/quantity', adminAuth, async (req, res) => {
  try {
    const { id_item, storage_id } = req.body || {};
    if (!id_item) return res.status(400).json({ message: 'id_item is required' });
    const r = await getItemQuantity({ id_item, storage_id });
    res.json(r);
  } catch (e) {
    res.status(400).json({ message: e?.message || 'quantity_failed', code: e?.code || 0 });
  }
});

// Update item (price/cost/etc.)
router.post('/update', adminAuth, async (req, res) => {
  try {
    const { id_item } = req.body || {};
    if (!id_item) return res.status(400).json({ message: 'id_item is required' });
    const { storage_id, reference_request, ...fields } = req.body || {};
    const r = await updateItem({ id_item, storage_id, reference_request, ...fields });
    res.json(r);
  } catch (e) {
    res.status(400).json({ message: e?.message || 'update_failed', code: e?.code || 0 });
  }
});

// Sync items from Rivhit into Products: create only new ones (no duplicates)
router.post('/sync-items', adminAuth, async (req, res) => {
  try {
    // Incoming mapping options
    const { defaultCategoryId, page, page_size, dryRun } = req.body || {};
    const dry = !!dryRun || String(req.query?.dryRun || '').toLowerCase() === 'true';
    // Fetch items list from Rivhit (may be paginated); for MVP, one page
  const items = await listItems({ page, page_size });
  const sampleKeys = Array.isArray(items) && items[0] ? Object.keys(items[0]) : [];
    // Build a map of existing rivhitItemIds to skip duplicates
    const ids = items
      .map((it) => Number(it?.id_item ?? it?.item_id ?? it?.id))
      .filter((n) => Number.isFinite(n) && n > 0);
    const codes = items
      .map((it) => {
        const c = (it?.item_code ?? it?.code ?? it?.ItemCode ?? it?.item_part_num ?? it?.part_num ?? it?.itempartnum ?? it?.barcode ?? '').toString().trim();
        return c;
      })
      .filter(Boolean);
    const uniqueIds = Array.from(new Set(ids));
    const uniqueCodes = Array.from(new Set(codes));
    const existing = await Product.find({ $or: [
      uniqueIds.length ? { rivhitItemId: { $in: uniqueIds } } : null,
      uniqueCodes.length ? { rivhitItemCode: { $in: uniqueCodes } } : null
    ].filter(Boolean) }).select('rivhitItemId rivhitItemCode');
    const existingIdSet = new Set(existing.map((p) => Number(p.rivhitItemId)).filter((n) => Number.isFinite(n) && n > 0));
    const existingCodeSet = new Set(existing.map((p) => (p.rivhitItemCode ? String(p.rivhitItemCode) : '')).filter(Boolean));
    // Pick a default category if provided, else first category
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

    const toInsert = [];
    let skippedByMissingKey = 0;
    let skippedAsDuplicate = 0;
    for (const it of items) {
      const rid = Number(it?.id_item ?? it?.item_id ?? it?.id);
      const rcode = (it?.item_code ?? it?.code ?? it?.ItemCode ?? it?.item_part_num ?? it?.part_num ?? it?.itempartnum ?? it?.barcode ?? '').toString().trim();
      if ((!Number.isFinite(rid) || rid <= 0) && !rcode) { skippedByMissingKey++; continue; }
      if ((Number.isFinite(rid) && rid > 0 && existingIdSet.has(rid)) || (rcode && existingCodeSet.has(rcode))) { skippedAsDuplicate++; continue; }
      // Map fields with safe defaults
      const nameCandidate = (it?.item_name ?? it?.name ?? it?.item_name_en ?? rcode ?? (Number.isFinite(rid) && rid > 0 ? `Item ${rid}` : '')).toString().trim();
      const name = nameCandidate || (Number.isFinite(rid) && rid > 0 ? `Item ${rid}` : (rcode || 'Rivhit Item'));
      const desc = (it?.item_extended_description ?? it?.description ?? it?.item_description ?? '').toString();
      const priceRaw = Number(
        it?.sale_nis ?? it?.sale_price ?? it?.price ?? it?.Price ?? it?.sale_mtc ?? it?.cost_nis ?? 0
      );
      const price = Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : 0;
      const stockRaw = Number(it?.quantity ?? it?.stock ?? it?.Quantity);
      // If quantity is negative in Rivhit, import as positive by taking absolute value
      const stock = Number.isFinite(stockRaw)
        ? (stockRaw < 0 ? Math.abs(stockRaw) : stockRaw)
        : 0;
      const picture = (it?.picture_link ?? '').toString().trim();
      const pictureUrl = /^(https?:\/\/|\/)/i.test(picture) ? picture : '';
      const images = Array.isArray(it?.images) && it.images.length
        ? it.images.map(String)
        : (pictureUrl ? [pictureUrl] : []);
      const doc = {
        name,
        description: desc || 'Imported from Rivhit',
        price,
        originalPrice: undefined,
        images: images.length ? images : ['/placeholder-image.svg'],
        category: categoryId,
        stock,
        relatedProducts: [],
        isActive: true,
        rivhitItemId: Number.isFinite(rid) && rid > 0 ? rid : undefined,
        rivhitItemCode: rcode || undefined
      };
      toInsert.push(doc);
    }
    if (dry) {
      return res.json({
        dryRun: true,
        total: items.length,
        uniqueIds: uniqueIds.length,
        uniqueCodes: uniqueCodes.length,
        existingById: existingIdSet.size,
        existingByCode: existingCodeSet.size,
        toInsert: toInsert.length,
        skippedByMissingKey,
        skippedAsDuplicate,
        sampleKeys,
        sampleNew: toInsert.slice(0, 3).map(x => ({ name: x.name, rivhitItemId: x.rivhitItemId, rivhitItemCode: x.rivhitItemCode }))
      });
    }
    let created = [];
    if (toInsert.length) {
      created = await Product.insertMany(toInsert, { ordered: false }).catch((e) => {
        // Ignore duplicate key errors due to race conditions
        if (e?.writeErrors) {
          const inserted = e.result?.nInserted || 0;
          return toInsert.slice(0, inserted);
        }
        throw e;
      });
    }
    res.json({
      total: items.length,
      existingById: existingIdSet.size,
      existingByCode: existingCodeSet.size,
      created: created.length,
      skipped: items.length - created.length,
      skippedByMissingKey,
      skippedAsDuplicate,
      sampleKeys,
      sampleNew: toInsert.slice(0, 3).map(x => ({ name: x.name, rivhitItemId: x.rivhitItemId, rivhitItemCode: x.rivhitItemCode }))
    });
  } catch (e) {
    res.status(400).json({ message: e?.message || 'sync_items_failed' });
  }
});

export default router;
