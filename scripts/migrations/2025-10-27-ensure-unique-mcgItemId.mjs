import { pathToFileURL } from 'url';
import path from 'path';
import dbManager from '../../services/dbManager.js';

async function main() {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../');
  // Import Product model dynamically to ensure mongoose connection uses same instance
  const Product = (await import(pathToFileURL(path.join(root, 'models/Product.js')).href)).default;

  await dbManager.connectWithRetry();

  // 1) Find duplicates by mcgItemId (non-empty)
  const dupAgg = await Product.aggregate([
    { $match: { mcgItemId: { $exists: true, $ne: null, $ne: '' } } },
    { $group: { _id: '$mcgItemId', ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]);

  let removed = 0;
  for (const g of dupAgg) {
    const mcgId = g._id;
    const docs = await Product.find({ _id: { $in: g.ids } }).sort({ isActive: -1, createdAt: 1 }).lean();
    if (!docs || docs.length <= 1) continue;
    // Keep the first (prefer active, then oldest), remove the rest
    const keep = docs[0];
    const toRemoveIds = docs.slice(1).map(d => d._id);
    if (toRemoveIds.length) {
      await Product.deleteMany({ _id: { $in: toRemoveIds } });
      removed += toRemoveIds.length;
      console.log(`[mcg][dedupe] Kept ${keep._id} for mcgItemId=${mcgId}; removed ${toRemoveIds.length}`);
    }
  }

  // 2) Create unique sparse index on mcgItemId
  try {
    await Product.collection.createIndex({ mcgItemId: 1 }, { unique: true, sparse: true });
    console.log('[mcg][index] Unique sparse index on mcgItemId ensured.');
  } catch (e) {
    console.error('[mcg][index] Failed to create unique index on mcgItemId:', e?.message || e);
    process.exitCode = 1;
  }

  // 3) Report summary
  const totalWithKey = await Product.countDocuments({ mcgItemId: { $exists: true, $ne: null, $ne: '' } });
  console.log(JSON.stringify({ ok: true, removed, totalWithKey }, null, 2));

  // Done
  try { await (await import('mongoose')).default.disconnect(); } catch {}
}

main().catch((e) => {
  console.error('[mcg][dedupe] Fatal:', e?.message || e);
  process.exit(1);
});
