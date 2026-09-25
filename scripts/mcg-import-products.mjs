#!/usr/bin/env node
/*
  Import products from MCG and seed local Products with mcgItemId/mcgBarcode.
  - Works without starting the HTTP server; connects directly to MongoDB using dbManager.
  - Supports both legacy v2.6 and Uplîcali flavors via mcgService.
  - Creates a default category if not provided and none exists.
  - Optionally creates a Main Warehouse and an Inventory row per product using item_inventory from MCG when available.

  Usage examples:
    node project/server/scripts/mcg-import-products.mjs --dry-run
    node project/server/scripts/mcg-import-products.mjs --page 1 --pageSize 200
    node project/server/scripts/mcg-import-products.mjs --defaultCategoryId <ObjectId>

  ENV requirements:
    - .env at project/.env should contain MONGODB_URI
    - MCG config should be set via /api/mcg/config or seeded in Settings.mcg (clientId/secret, baseUrl, etc.)
*/

import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Settings from '../models/Settings.js';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import Warehouse from '../models/Warehouse.js';
import Inventory from '../models/Inventory.js';
import InventoryHistory from '../models/InventoryHistory.js';
import { connectWithRetry } from '../services/dbManager.js';
import { getItemsList } from '../services/mcgService.js';
import { extractFinalPrice } from '../utils/mcgPrice.js';
import { normalizeTaxMultiplier } from '../utils/mcgTax.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run' || a === '--dry' || a === '-n') out.dryRun = true;
    else if (a === '--page' && args[i+1]) { out.page = Number(args[++i]); }
    else if (a === '--pageSize' && args[i+1]) { out.pageSize = Number(args[++i]); }
    else if (a === '--defaultCategoryId' && args[i+1]) { out.defaultCategoryId = args[++i]; }
  }
  return out;
}

function detectLangFromText(text) {
  try {
    const s = (text || '') + '';
    const ar = (s.match(/[\u0600-\u06FF]/g) || []).length; // Arabic
    const he = (s.match(/[\u0590-\u05FF]/g) || []).length; // Hebrew
    if (ar > he && ar > 0) return 'ar';
    if (he > ar && he > 0) return 'he';
    return 'en';
  } catch { return 'en'; }
}

async function ensureMainWarehouse() {
  let warehouses = await Warehouse.find({});
  if (!warehouses || warehouses.length === 0) {
    const main = await Warehouse.findOneAndUpdate(
      { name: 'Main Warehouse' },
      { $setOnInsert: { name: 'Main Warehouse' } },
      { new: true, upsert: true }
    );
    return main;
  }
  const main = warehouses.find(w => String(w?.name || '').toLowerCase() === 'main warehouse') || warehouses[0];
  return main;
}

async function run() {
  const opts = parseArgs();
  const startedAt = Date.now();
  try {
    await connectWithRetry(5);
    let s = await Settings.findOne();
    if (!s) s = await Settings.create({});
    if (!s?.mcg?.enabled) {
      console.error('[mcg][import] Settings.mcg.enabled is false. Enable MCG first using /api/mcg/config.');
      process.exitCode = 2;
      return;
    }

    const apiFlavor = String(s?.mcg?.apiFlavor || '').trim().toLowerCase();
    const baseUrl = String(s?.mcg?.baseUrl || '').trim();
    const isUpli = apiFlavor === 'uplicali' || /apis\.uplicali\.com/i.test(baseUrl) || /SuperMCG\/MCG_API/i.test(baseUrl);
    const taxMultiplier = normalizeTaxMultiplier(s?.mcg?.taxMultiplier ?? 1.18);

    // Resolve category
    let categoryId = null;
    if (typeof opts.defaultCategoryId === 'string' && /^[a-fA-F0-9]{24}$/.test(opts.defaultCategoryId)) {
      const ok = await Category.findById(opts.defaultCategoryId).select('_id');
      if (ok) categoryId = ok._id;
    }
    if (!categoryId) {
      const first = await Category.findOne({}).select('_id').sort({ createdAt: 1 });
      if (first) categoryId = first._id;
    }
    if (!categoryId) {
      const created = await Category.create({ name: 'Imported from MCG' });
      categoryId = created._id;
      console.log('[mcg][import] Created default category:', String(categoryId));
    }

    // Fetch items
    const doLoop = !isUpli && (!Number.isFinite(Number(opts.page)) || !Number.isFinite(Number(opts.pageSize)));
    const effPageSize = Number.isFinite(Number(opts.pageSize)) && Number(opts.pageSize) > 0 ? Number(opts.pageSize) : 200;
    let page = Number.isFinite(Number(opts.page)) && Number(opts.page) > 0 ? Number(opts.page) : 1;

    const createdAll = [];
    const reactivatedAll = [];
    let skippedByMissingKey = 0;
    let skippedAsDuplicate = 0;
    let incomingTotal = 0;
    const seenIds = new Set();

    const processItems = async (items) => {
      const ids = items.map(it => ((it?.ItemID ?? it?.id ?? it?.itemId ?? it?.item_id ?? '') + '').trim()).filter(Boolean);
      const uniqueIds = Array.from(new Set(ids));
      const existing = await Product.find({ $or: [ uniqueIds.length ? { mcgItemId: { $in: uniqueIds } } : null ].filter(Boolean) }).select('mcgItemId isActive _id');
      const existId = new Set(existing.filter(p => p.isActive !== false).map(p => (p.mcgItemId || '').toString()));
      const existById = new Map(existing.map(p => [ (p.mcgItemId || '').toString(), p ]));

      const toInsert = [];
      const reactivated = [];
      for (const it of items) {
        const mcgId = ((it?.ItemID ?? it?.id ?? it?.itemId ?? it?.item_id ?? '') + '').trim();
        const barcode = ((it?.Barcode ?? it?.barcode ?? it?.item_code ?? '') + '').trim();
        if (!mcgId && !barcode) { skippedByMissingKey++; continue; }
        const isDupById = mcgId && (existId.has(mcgId) || seenIds.has(mcgId));
        if (isDupById) { skippedAsDuplicate++; continue; }

        const name = (it?.Name ?? it?.name ?? it?.item_name ?? (barcode || mcgId || 'MCG Item')) + '';
        const desc = (it?.Description ?? it?.description ?? (it?.item_department ? `Department: ${it.item_department}` : 'Imported from MCG')) + '';
        const finalPrice = extractFinalPrice(it);
        let price;
        if (finalPrice !== null) {
          price = finalPrice;
        } else {
          const priceRaw = Number(it?.Price ?? it?.price ?? it?.item_price ?? 0);
          const base = Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : 0;
          price = Math.round(base * taxMultiplier * 100) / 100;
        }
        const stockRaw = Number(it?.StockQuantity ?? it?.stock ?? it?.item_inventory ?? 0);
        const stock = Number.isFinite(stockRaw) ? Math.max(0, stockRaw) : 0;
        const img = (it?.ImageURL ?? it?.imageUrl ?? (it?.item_image || '')) + '';
        const imgOk = /^(https?:\/\/|\/)/i.test(img) ? img : '';
        const images = imgOk ? [imgOk] : ['/placeholder-image.svg'];
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
          mcgBarcode: barcode || undefined,
          ...(name_i18n ? { name_i18n } : {}),
          ...(description_i18n ? { description_i18n } : {})
        };

        if (mcgId && existById.has(mcgId) && existById.get(mcgId)?.isActive === false) {
          if (!opts.dryRun) {
            await Product.findOneAndUpdate(
              { _id: existById.get(mcgId)._id },
              { $set: doc },
              { new: true }
            );
          }
          reactivated.push({ mcgItemId: mcgId });
          if (mcgId) seenIds.add(mcgId);
          continue;
        }

        toInsert.push(doc);
        if (mcgId) seenIds.add(mcgId);
      }

      if (opts.dryRun) return { created: [], reactivated, toInsert };
      let created = [];
      if (toInsert.length) {
        try {
          created = await Product.insertMany(toInsert, { ordered: false });
        } catch (e) {
          if (e?.writeErrors) {
            const inserted = e.result?.nInserted || 0;
            created = toInsert.slice(0, inserted);
          } else {
            throw e;
          }
        }
      }

      // Seed inventory where available
      const withStock = [...created, ...reactivated.map(x => x._id ? x : null)].filter(Boolean);
      // For simplicity, we just seed for newly created items here using their provided stock
      if (created.length) {
        try {
          const mainWh = await ensureMainWarehouse();
          const bulkInv = [];
          for (const p of created) {
            const qty = Number(p.stock) || 0;
            if (qty <= 0) continue;
            bulkInv.push({
              insertOne: {
                document: {
                  product: p._id,
                  size: 'Default',
                  color: 'Default',
                  warehouse: mainWh._id,
                  quantity: qty,
                  location: mainWh.name,
                  lowStockThreshold: 5
                }
              }
            });
          }
          if (bulkInv.length) await Inventory.bulkWrite(bulkInv, { ordered: false });
          // History records (one per inserted inventory row)
          const hist = [];
          for (const p of created) {
            const qty = Number(p.stock) || 0;
            if (qty <= 0) continue;
            hist.push({ product: p._id, type: 'increase', quantity: qty, reason: 'Initial stock (MCG import)', user: null });
          }
          if (hist.length) await InventoryHistory.insertMany(hist, { ordered: false });
        } catch (invErr) {
          try { console.warn('[mcg][import] inventory seed skipped:', invErr?.message || invErr); } catch {}
        }
      }

      return { created, reactivated, toInsert };
    };

    let iterations = 0;
    for (;;) {
      iterations++;
      const resp = await getItemsList({ PageNumber: page, PageSize: effPageSize });
      const items = Array.isArray(resp?.data?.items) ? resp.data.items
        : Array.isArray(resp?.items) ? resp.items
        : Array.isArray(resp?.data) ? resp.data
        : Array.isArray(resp) ? resp
        : [];
      incomingTotal += items.length;
      const { created, reactivated } = await processItems(items);
      createdAll.push(...(created || []));
      reactivatedAll.push(...(reactivated || []));

      const totalCount = Number(resp?.data?.TotalCount ?? resp?.TotalCount ?? 0);
      const pageCount = Number(resp?.data?.PageCount ?? resp?.PageCount ?? 0);

      if (isUpli) break; // no pagination
      if (!doLoop) break; // single page requested
      const hasMore = pageCount ? (page < pageCount) : (items.length === effPageSize);
      if (!hasMore) break;
      page++;
      if (iterations > 200) break; // safety
    }

    console.log('\n[mcg][import][done]', {
      durationSec: Math.round((Date.now() - startedAt) / 1000),
      dryRun: !!opts.dryRun,
      incomingTotal,
      created: createdAll.length,
      reactivated: reactivatedAll.length,
      skippedByMissingKey,
      skippedAsDuplicate
    });
  } catch (e) {
    console.error('[mcg][import][error]', e?.message || e);
    process.exitCode = 1;
  } finally {
    try { await mongoose.disconnect(); } catch {}
  }
}

run();
