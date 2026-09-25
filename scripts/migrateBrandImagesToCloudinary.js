/*
  Migrate Brand.imageUrl values that point to local /uploads files to Cloudinary.
  - Dry run by default (no changes). Pass --apply to perform uploads and DB updates.
  - Reads Cloudinary config from CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET,
    falling back to VITE_* envs if needed.
*/
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cloudinary from 'cloudinary';
import Brand from '../models/Brand.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') }); // server/.env if present
dotenv.config({ path: path.resolve(__dirname, '../.env') }); // fallback
dotenv.config({ path: path.resolve(__dirname, '../../../.env') }); // project root .env

// Configure Cloudinary using explicit credentials (preferred).
const ensureCloudinaryConfig = () => {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY || process.env.VITE_CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET || process.env.VITE_CLOUDINARY_API_SECRET;

  if (cloud_name && api_key && api_secret) {
    cloudinary.v2.config({ cloud_name, api_key, api_secret, secure: true });
    return;
  }

  // Optional fallback: support CLOUDINARY_URL connection string if provided in 'cloudinary://key:secret@cloud' format
  const conn = process.env.CLOUDINARY_URL;
  if (conn && /^cloudinary:\/\//.test(conn)) {
    process.env.CLOUDINARY_URL = conn; // ensure env is set for SDK
    cloudinary.v2.config({ secure: true });
    return;
  }

  throw new Error('Cloudinary is not configured. Provide CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET or CLOUDINARY_URL.');
};

const connectMongo = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri);
};

const resolveLocalUploadPath = (urlOrPath) => {
  try {
    // Accept absolute URL or relative path; find '/uploads/' segment
    let rel = '';
    if (typeof urlOrPath !== 'string') return null;
    const s = urlOrPath.trim();
    const idx = s.indexOf('/uploads/');
    if (idx >= 0) {
      rel = s.substring(idx + '/uploads/'.length);
    } else if (s.startsWith('/uploads/')) {
      rel = s.substring('/uploads/'.length);
    } else if (s.startsWith('uploads/')) {
      rel = s.substring('uploads/'.length);
    } else {
      return null;
    }
    const uploadDir = path.resolve(__dirname, '../../uploads');
    return path.resolve(uploadDir, rel);
  } catch {
    return null;
  }
};

const main = async () => {
  const apply = process.argv.includes('--apply');
  console.log(`\nBrand images migration to Cloudinary (${apply ? 'APPLY' : 'DRY-RUN'})\n`);

  ensureCloudinaryConfig();
  await connectMongo();

  const brands = await Brand.find({ imageUrl: { $exists: true, $ne: null } }).sort({ createdAt: 1 });
  let candidates = [];
  for (const b of brands) {
    const p = resolveLocalUploadPath(b.imageUrl);
    if (p) candidates.push({ brand: b, localPath: p });
  }

  console.log(`Found ${brands.length} brands, ${candidates.length} with local /uploads images.`);
  if (!candidates.length) {
    await mongoose.disconnect();
    console.log('Nothing to migrate.');
    return;
  }

  let migrated = 0;
  for (const { brand, localPath } of candidates) {
    const exists = fs.existsSync(localPath);
    console.log(`\n- ${brand._id} ${brand.name || ''}`);
    console.log(`  imageUrl: ${brand.imageUrl}`);
    console.log(`  local: ${exists ? localPath : '(missing file)'}`);
    if (!exists) continue;

    if (!apply) {
      continue; // dry run only
    }

    try {
      const uploadResp = await cloudinary.v2.uploader.upload(localPath, {
        folder: 'brands',
        use_filename: true,
        unique_filename: false,
        overwrite: true,
        resource_type: 'image',
      });
      if (uploadResp?.secure_url) {
        brand.imageUrl = uploadResp.secure_url;
        await brand.save();
        migrated++;
        console.log(`  -> updated to ${brand.imageUrl}`);
      } else {
        console.warn('  Upload succeeded without secure_url? Skipping update.');
      }
    } catch (e) {
      console.error('  Upload failed:', e?.message || e);
    }
  }

  await mongoose.disconnect();
  console.log(`\nDone. Migrated ${migrated} of ${candidates.length} candidates.`);
};

main().catch(async (e) => {
  console.error('Migration failed:', e?.message || e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
