import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const uri = process.env.MONGODB_URI || process.argv[2];
if (!uri) {
  console.error('Missing MongoDB URI. Provide MONGODB_URI or pass the URI as the first argument.');
  process.exit(1);
}

async function main() {
  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB || undefined,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 20000,
  });

  const { pruneExpiredData } = await import('../services/retentionCleanup.js');
  const results = await pruneExpiredData('manual-script');
  console.log(JSON.stringify(results, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
