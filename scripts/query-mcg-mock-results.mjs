import path from 'path';
import { pathToFileURL } from 'url';

const root = path.resolve('project/server');
const url = (p) => pathToFileURL(path.join(root, p)).href;

const { default: mongoose } = await import(url('../server/node_modules/mongoose/index.js')).catch(() => ({ default: null }));
const db = (await import(url('services/dbManager.js'))).default;
const { default: Product } = await import(url('models/Product.js'));
const { default: Inventory } = await import(url('models/Inventory.js'));

try {
  await db.connectWithRetry();
  const products = await Product.find({ $or: [ { mcgItemId: 'TEST-1' }, { mcgItemId: 'TEST-2' }, { mcgBarcode: { $in: ['TEST-BC-1','TEST-BC-2'] } } ] }).select('name mcgItemId mcgBarcode stock').lean();
  console.log('[results] products:', products);
  const invs = await Inventory.find({}).sort({ updatedAt: -1 }).limit(5).select('product variantId quantity size color').lean();
  console.log('[results] recent inventory entries (top 5):', invs);
} catch (e) {
  console.error('err', e?.message || e);
} finally {
  try { await mongoose.disconnect(); } catch {}
}
