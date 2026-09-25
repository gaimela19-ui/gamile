import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cloudinary from '../services/cloudinaryClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const dryRun = process.argv.includes('--dry-run');
const uri = process.env.MONGODB_URI || process.argv[2];

function parseBool(value) {
  return value === '1' || value === 'true' || value === 'yes';
}

const includeCloudinary = parseBool(process.env.CLEANUP_CLOUDINARY || 'false');
const includeArchivedMcg = parseBool(process.env.CLEANUP_ARCHIVED_MCG || 'true');
const includeEmbeddedCompaction = parseBool(process.env.CLEANUP_EMBEDDED_FIELDS || 'true');
const maxEmbeddedBytes = Number(process.env.CLEANUP_EMBEDDED_MAX_BYTES || '120000');

async function getDbModels() {
  const [{ default: McgArchivedItem }, { default: Order }, { default: PaymentSession }, { default: Product }, { default: Settings }] = await Promise.all([
    import('../models/McgArchivedItem.js'),
    import('../models/Order.js'),
    import('../models/PaymentSession.js'),
    import('../models/Product.js'),
    import('../models/Settings.js'),
  ]);
  return { McgArchivedItem, Order, PaymentSession, Product, Settings };
}

async function pruneArchivedMcg({ McgArchivedItem, dryRun }) {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const docs = await McgArchivedItem.find({ archivedAt: { $lt: cutoff } }).lean();
  const ids = docs.map((d) => d._id);
  if (!ids.length) return { archivedMcg: { deleted: 0, candidates: 0 } };
  if (!dryRun) {
    await McgArchivedItem.deleteMany({ _id: { $in: ids } });
  }
  return { archivedMcg: { deleted: dryRun ? 0 : ids.length, candidates: ids.length } };
}

async function pruneOldSnapshots({ Order, PaymentSession, dryRun }) {
  const orderCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const sessionCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [orderResult, sessionResult] = await Promise.all([
    Order.deleteMany({ createdAt: { $lt: orderCutoff }, status: { $in: ['cancelled', 'delivered'] } }),
    PaymentSession.deleteMany({ createdAt: { $lt: sessionCutoff } }),
  ]);
  return {
    oldOrders: { deleted: dryRun ? 0 : (orderResult?.deletedCount || 0) },
    oldPaymentSessions: { deleted: dryRun ? 0 : (sessionResult?.deletedCount || 0) },
  };
}

async function compactEmbeddedFields({ Product, Settings, dryRun }) {
  const results = [];
  const productCandidates = await Product.find({}).select('_id paymentDetails shippingCalculation deliveryMappedData').lean();
  for (const doc of productCandidates) {
    // Products do not have these fields in the model; this is a no-op placeholder to keep the workflow consistent.
    results.push({ _id: doc._id, compacted: 0 });
  }

  const settingsDocs = await Settings.find({}).select('_id siteSettings').lean();
  for (const doc of settingsDocs) {
    if (!doc.siteSettings || typeof doc.siteSettings !== 'object') continue;
    let changed = false;
    const compact = (value) => {
      if (Array.isArray(value)) return value.filter(Boolean).slice(0, 10);
      if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
          if (typeof v === 'string' && v.length > maxEmbeddedBytes) {
            out[k] = `${v.slice(0, maxEmbeddedBytes)}…`;
            changed = true;
          } else if (Array.isArray(v) && v.length > 10) {
            out[k] = v.slice(0, 10);
            changed = true;
          } else if (v && typeof v === 'object') {
            out[k] = compact(v);
          } else {
            out[k] = v;
          }
        }
        return out;
      }
      return value;
    };

    const next = compact(doc.siteSettings);
    const serialized = JSON.stringify(next).length;
    if (serialized > maxEmbeddedBytes) {
      const simplified = { ...(next || {}) };
      delete simplified.siteSettings;
      results.push({ _id: doc._id, truncated: true, bytes: serialized });
      if (!dryRun) {
        await Settings.updateOne({ _id: doc._id }, { $set: { siteSettings: simplified } });
      }
    }
  }

  return { embeddedCompaction: results };
}

async function pruneCloudinaryAssets({ dryRun }) {
  if (!includeCloudinary) return { cloudinary: { deleted: 0, skipped: 'disabled' } };
  try {
    const resources = await new Promise((resolve, reject) => {
      cloudinary.api.resources({ type: 'upload', max_results: 500 }, (err, result) => err ? reject(err) : resolve(result.resources || []));
    });
    const toDelete = resources.filter((resource) => !resource.public_id?.includes('products') && !resource.public_id?.includes('announcements'));
    if (dryRun) {
      return { cloudinary: { deleted: 0, candidates: toDelete.length } };
    }
    for (const res of toDelete) {
      await new Promise((resolve, reject) => {
        cloudinary.uploader.destroy(res.public_id, (err) => err ? reject(err) : resolve());
      });
    }
    return { cloudinary: { deleted: toDelete.length, candidates: toDelete.length } };
  } catch (error) {
    return { cloudinary: { deleted: 0, error: error?.message || String(error) } };
  }
}

async function main() {
  const results = {};
  if (!uri) {
    console.warn('[cleanup-storage-analytics] Missing MONGODB_URI or URI argument; skipping DB-based cleanup.');
    results.db = { status: 'skipped', reason: 'missing-uri' };
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, socketTimeoutMS: 20000 });
    const { McgArchivedItem, Order, PaymentSession, Product, Settings } = await getDbModels();
    Object.assign(results, {
      ...(await pruneArchivedMcg({ McgArchivedItem, dryRun })),
      ...(await pruneOldSnapshots({ Order, PaymentSession, dryRun })),
      ...(await compactEmbeddedFields({ Product, Settings, dryRun })),
      ...(await pruneCloudinaryAssets({ dryRun })),
    });
  } catch (error) {
    results.db = { status: 'skipped', reason: error?.message || String(error) };
  } finally {
    try { await mongoose.disconnect(); } catch {}
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
