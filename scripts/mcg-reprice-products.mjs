#!/usr/bin/env node
import dbManager from '../services/dbManager.js';
import Settings from '../models/Settings.js';
import Product from '../models/Product.js';
import { getItemsList } from '../services/mcgService.js';
import { normalizeTaxMultiplier, percentToMultiplier } from '../utils/mcgTax.js';

const DEFAULT_PAGE_SIZE = 200;

function parseArgs(argv) {
  const opts = { pageSize: DEFAULT_PAGE_SIZE, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--page-size':
      case '--pageSize':
        if (i + 1 < argv.length) {
          const val = Number(argv[++i]);
          if (Number.isFinite(val) && val > 0) {
            opts.pageSize = Math.min(500, Math.max(10, Math.floor(val)));
          }
        }
        break;
      case '--max-pages':
      case '--maxPages':
        if (i + 1 < argv.length) {
          const val = Number(argv[++i]);
          if (Number.isFinite(val) && val > 0) opts.maxPages = Math.floor(val);
        }
        break;
      case '--limit':
        if (i + 1 < argv.length) {
          const val = Number(argv[++i]);
          if (Number.isFinite(val) && val > 0) opts.limit = Math.floor(val);
        }
        break;
      case '--percent':
      case '--pct':
        if (i + 1 < argv.length) {
          opts.percent = Number(argv[++i]);
        }
        break;
      case '--multiplier':
      case '--mul':
        if (i + 1 < argv.length) {
          opts.multiplier = Number(argv[++i]);
        }
        break;
      default:
        break;
    }
  }
  return opts;
}

function detectUpli(settings) {
  const apiFlavor = String(settings?.mcg?.apiFlavor || '').trim().toLowerCase();
  const baseUrl = String(settings?.mcg?.baseUrl || '').trim();
  return apiFlavor === 'uplicali' || /apis\.uplicali\.com/i.test(baseUrl) || /SuperMCG\/MCG_API/i.test(baseUrl);
}

function normalizePrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.ceil(num);
}

function resolveFinalPriceField(item) {
  const keys = ['item_final_price', 'itemFinalPrice', 'FinalPrice', 'finalPrice'];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(item || {}, key)) {
      const val = Number(item[key]);
      if (Number.isFinite(val) && val >= 0) {
        return val;
      }
    }
  }
  return null;
}

function resolveRemotePrice(item, taxMultiplier) {
  const direct = resolveFinalPriceField(item);
  if (direct !== null) {
    return normalizePrice(direct);
  }
  const baseRaw = Number(item?.Price ?? item?.price ?? item?.item_price ?? item?.itemPrice ?? 0);
  const base = Number.isFinite(baseRaw) && baseRaw >= 0 ? baseRaw : 0;
  return normalizePrice(base * (taxMultiplier > 0 ? taxMultiplier : 1));
}

function extractMcgId(item) {
  const keys = ['ItemID', 'ItemId', 'itemID', 'itemId', 'item_id', 'id'];
  for (const key of keys) {
    const val = item?.[key];
    if (val === undefined || val === null) continue;
    const trimmed = String(val).trim();
    if (trimmed) return trimmed;
  }
  return '';
}

async function processBatch(items, ctx) {
  const ids = items.map(extractMcgId).filter(Boolean);
  if (!ids.length) return;
  const existing = await Product.find({ mcgItemId: { $in: ids } }).select('_id name price mcgItemId isActive').lean();
  const map = new Map(existing.map(doc => [String(doc.mcgItemId || ''), doc]));
  const bulk = [];
  for (const item of items) {
    const mcgId = extractMcgId(item);
    if (!mcgId) continue;
    const product = map.get(mcgId);
    if (!product) {
      ctx.missing += 1;
      continue;
    }
    ctx.matched += 1;
    if (product.isActive === false) {
      ctx.skippedInactive += 1;
      continue;
    }
    const nextPrice = resolveRemotePrice(item, ctx.multiplier);
    if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
      ctx.skippedInvalid += 1;
      continue;
    }
    const currentPrice = Number(product.price ?? 0);
    if (Math.abs(currentPrice - nextPrice) < 0.001) continue;
    ctx.changed += 1;
    if (ctx.samples.length < 8) {
      ctx.samples.push({ mcgItemId: mcgId, before: currentPrice, after: nextPrice, name: product.name || '' });
    }
    if (ctx.dryRun) continue;
    bulk.push({
      updateOne: {
        filter: { _id: product._id },
        update: { $set: { price: nextPrice } }
      }
    });
  }
  if (bulk.length) {
    const res = await Product.bulkWrite(bulk, { ordered: false });
    ctx.modified += res?.modifiedCount || 0;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log('[mcg-reprice] connecting to database...');
  await dbManager.connectWithRetry();
  const settings = await Settings.findOne();
  if (!settings?.mcg?.enabled) {
    throw new Error('MCG integration is disabled in settings. Enable it before running this script.');
  }

  let multiplier;
  if (Number.isFinite(options.percent)) {
    multiplier = percentToMultiplier(options.percent);
  } else if (Number.isFinite(options.multiplier)) {
    multiplier = normalizeTaxMultiplier(options.multiplier);
  } else {
    multiplier = normalizeTaxMultiplier(settings?.mcg?.taxMultiplier ?? 1.18);
  }
  const percent = ((multiplier - 1) * 100).toFixed(2);
  console.log(`[mcg-reprice] using tax multiplier ${multiplier.toFixed(4)} (${percent}% VAT)`);
  if (options.dryRun) {
    console.log('[mcg-reprice] running in dry-run mode; no documents will be modified.');
  }

  const ctx = {
    dryRun: options.dryRun,
    multiplier,
    processed: 0,
    matched: 0,
    missing: 0,
    skippedInactive: 0,
    skippedInvalid: 0,
    changed: 0,
    modified: 0,
    samples: []
  };

  const isUpli = detectUpli(settings);
  let page = 1;
  let pageRuns = 0;

  while (true) {
    const params = isUpli ? {} : { PageNumber: page, PageSize: options.pageSize };
    const data = await getItemsList(params);
    const rawItems = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []));
    if (!rawItems.length) break;
    let items = rawItems;
    if (options.limit && ctx.processed + items.length > options.limit) {
      items = items.slice(0, Math.max(0, options.limit - ctx.processed));
    }
    ctx.processed += items.length;
    if (options.verbose) {
      console.log(`[mcg-reprice] page ${page} -> processing ${items.length} items`);
    }
    await processBatch(items, ctx);
    if (options.limit && ctx.processed >= options.limit) break;
    if (isUpli) break;
    if (rawItems.length < options.pageSize) break;
    page += 1;
    pageRuns += 1;
    if (options.maxPages && pageRuns >= options.maxPages) break;
    if (pageRuns > 10000) break;
  }

  console.log(`[mcg-reprice] processed ${ctx.processed} remote items.`);
  console.log(`[mcg-reprice] matched ${ctx.matched}, missing ${ctx.missing}, inactive ${ctx.skippedInactive}, invalid ${ctx.skippedInvalid}.`);
  if (ctx.dryRun) {
    console.log(`[mcg-reprice] would update ${ctx.changed} products.`);
  } else {
    console.log(`[mcg-reprice] updated ${ctx.modified} products (changes detected: ${ctx.changed}).`);
  }
  if (ctx.samples.length) {
    console.log('[mcg-reprice] sample price changes:');
    for (const sample of ctx.samples) {
      console.log(`  - ${sample.mcgItemId}: ${sample.before} -> ${sample.after}${sample.name ? ` (${sample.name})` : ''}`);
    }
  }
  if (options.dryRun) {
    console.log('[mcg-reprice] dry-run complete. Re-run without --dry-run to apply changes.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[mcg-reprice] failed:', err?.message || err);
  process.exit(1);
});
