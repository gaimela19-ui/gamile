#!/usr/bin/env node
/**
 * Full-catalog absolute stock sync to MCG (Uplîcali flavor).
 *
 * - Reads current quantities from Inventory as the source of truth
 * - Builds set_items_list payload with item_code (barcode) when present
 *   and falls back to item_id (mcgItemId) only for products without variants
 * - Sends in batches of 200 to avoid oversized requests
 *
 * Usage:
 *   node project/server/scripts/mcg-full-sync.mjs
 */

import dbManager from '../services/dbManager.js';
import Settings from '../models/Settings.js';
import Product from '../models/Product.js';
import Inventory from '../models/Inventory.js';
import { setItemsList } from '../services/mcgService.js';

const BATCH_SIZE = 200;

async function sumQty(filter) {
  const rows = await Inventory.find(filter).select('quantity').lean();
  return rows.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
}

async function main() {
  await dbManager.connectWithRetry();
  const settings = await Settings.findOne().lean();
  const mcg = settings?.mcg || {};
  if (!mcg?.enabled || !mcg?.pushStockBackEnabled) {
    console.log('[mcg][full-sync] Skipped: MCG not enabled or pushStockBackEnabled=false');
    process.exit(0);
  }
  const flavor = String(mcg.apiFlavor || '').toLowerCase();
  if (flavor !== 'uplicali') {
    console.log('[mcg][full-sync] Only supported for Uplîcali flavor; exiting.');
    process.exit(0);
  }

  console.log('[mcg][full-sync] Starting inventory sync...');

  // Stream products to limit memory usage
  const cursor = Product.find({ isActive: { $ne: false } })
    .select('mcgBarcode mcgItemId variants._id variants.barcode')
    .lean()
    .cursor();

  let batch = [];
  let pushed = 0;
  for await (const p of cursor) {
    const pid = p._id;
    const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;
    if (hasVariants) {
      for (const v of p.variants) {
        const barcode = String(v?.barcode || '').trim();
        if (!barcode) continue; // require barcode for variant-level mapping
        const qty = await sumQty({ product: pid, variantId: v._id });
        batch.push({ item_code: barcode, item_inventory: Math.max(0, qty) });
        if (batch.length >= BATCH_SIZE) {
          const sample = batch[0]?.item_code;
          try { console.log('[mcg][full-sync] pushing %d items (sample=%s)', batch.length, sample); } catch {}
          await setItemsList(batch);
          pushed += batch.length;
          batch = [];
        }
      }
    } else {
      const barcode = String(p?.mcgBarcode || '').trim();
      const itemId = String(p?.mcgItemId || '').trim();
      const qty = await sumQty({ product: pid });
      if (barcode) batch.push({ item_code: barcode, item_inventory: Math.max(0, qty) });
      else if (itemId) batch.push({ item_id: itemId, item_inventory: Math.max(0, qty) });
      if (batch.length >= BATCH_SIZE) {
        const sample = batch[0]?.item_code || batch[0]?.item_id;
        try { console.log('[mcg][full-sync] pushing %d items (sample=%s)', batch.length, sample); } catch {}
        await setItemsList(batch);
        pushed += batch.length;
        batch = [];
      }
    }
  }

  if (batch.length) {
    const sample = batch[0]?.item_code || batch[0]?.item_id;
    try { console.log('[mcg][full-sync] pushing %d items (sample=%s)', batch.length, sample); } catch {}
    await setItemsList(batch);
    pushed += batch.length;
  }

  console.log('[mcg][full-sync] Done. Total items pushed:', pushed);
  process.exit(0);
}

main().catch(err => {
  console.error('[mcg][full-sync] failed:', err?.message || err);
  process.exit(1);
});
