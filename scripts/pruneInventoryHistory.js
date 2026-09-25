import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import InventoryHistory from '../models/InventoryHistory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const uri = process.env.MONGODB_URI || args[0];
const dbName = process.env.MONGODB_DB || args[1] || undefined;
const retentionDaysArg = args.find(arg => arg.startsWith('--days='));
const retentionDays = retentionDaysArg
  ? Number(retentionDaysArg.split('=')[1])
  : Number(process.env.INVENTORY_HISTORY_RETENTION_DAYS || '90');
const dryRun = args.includes('--dry-run');
const batchSizeArg = args.find(arg => arg.startsWith('--batch='));
const batchSize = batchSizeArg ? Number(batchSizeArg.split('=')[1]) : 20000;

if (!uri) {
  console.error('Missing MongoDB URI. Provide MONGODB_URI in env or the first argument.');
  process.exit(1);
}
if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
  console.error('Invalid retention days. Use --days=<n> or set INVENTORY_HISTORY_RETENTION_DAYS to a positive number.');
  process.exit(1);
}

async function main() {
  console.log(`Connecting to MongoDB ${uri} ${dbName ? `(db: ${dbName})` : ''}`);
  await mongoose.connect(uri, { dbName });

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  console.log(`Retention window: ${retentionDays} days. Deleting history older than ${cutoff.toISOString()}`);

  const oldCount = await InventoryHistory.countDocuments({ timestamp: { $lt: cutoff } });
  console.log(`Found ${oldCount.toLocaleString()} inventory history documents older than cutoff.`);

  if (dryRun) {
    console.log('Dry run enabled. No documents will be deleted.');
    await mongoose.disconnect();
    return;
  }

  if (oldCount === 0) {
    console.log('No old documents to delete.');
    await mongoose.disconnect();
    return;
  }

  let deletedTotal = 0;
  while (true) {
    const docs = await InventoryHistory.find({ timestamp: { $lt: cutoff } })
      .sort({ timestamp: 1 })
      .limit(batchSize)
      .select('_id')
      .lean();

    if (!docs.length) break;

    const ids = docs.map(doc => doc._id);
    const result = await InventoryHistory.deleteMany({ _id: { $in: ids } });
    deletedTotal += result.deletedCount || 0;
    console.log(`Deleted batch: ${result.deletedCount || 0} documents; total deleted: ${deletedTotal.toLocaleString()}`);

    if (docs.length < batchSize) break;
  }

  console.log(`Cleanup complete. Total deleted: ${deletedTotal.toLocaleString()}`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error pruning inventory history:', err);
  process.exit(1);
});
