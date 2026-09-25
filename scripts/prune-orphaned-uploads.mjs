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
const dryRun = process.argv.includes('--dry-run');
const olderThanDays = Number(
  process.env.UPLOADS_RETENTION_DAYS ||
  process.argv.find((arg) => arg.startsWith('--older-than-days='))?.split('=')[1] ||
  '90'
);
const uploadsRoot = path.resolve(__dirname, '../../uploads');
const trackedFiles = new Set();

function normalizeRelPath(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;
  if (/^data:/i.test(trimmed)) return null;
  if (trimmed.startsWith('/uploads/')) return trimmed.slice('/uploads/'.length);
  if (trimmed.startsWith('uploads/')) return trimmed.slice('uploads/'.length);
  return null;
}

async function collectReferencedPaths() {
  if (!uri) {
    console.warn('[uploads] Mongo URI not provided; falling back to filesystem-only pruning');
    return;
  }

  try {
    await mongoose.connect(uri, {
      dbName: process.env.MONGODB_DB || undefined,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });

    const models = [
      ['Settings', 'Settings'],
      ['Product', 'Product'],
      ['Brand', 'Brand'],
      ['Banner', 'Banner'],
      ['Background', 'Background'],
      ['FooterSettings', 'FooterSettings'],
      ['Hero', 'Hero'],
      ['Category', 'Category'],
      ['Announcement', 'Announcement'],
    ];

    for (const [fileName, modelName] of models) {
      try {
        const mod = await import(`../models/${fileName}.js`);
        const Model = mod.default || mod[modelName];
        if (!Model) continue;
        const docs = await Model.find({}).lean();
        for (const doc of docs) {
          const stack = [doc];
          while (stack.length) {
            const current = stack.pop();
            if (!current || typeof current !== 'object') continue;
            if (Array.isArray(current)) {
              for (const item of current) stack.push(item);
              continue;
            }
            for (const [key, value] of Object.entries(current)) {
              if (key === '_id' || key === '__v') continue;
              if (typeof value === 'string') {
                const rel = normalizeRelPath(value);
                if (rel) trackedFiles.add(rel.replace(/\\/g, '/'));
              } else if (value && typeof value === 'object') {
                stack.push(value);
              }
            }
          }
        }
      } catch (error) {
        console.warn(`[uploads] skipped ${fileName}`, error?.message || error);
      }
    }
  } catch (error) {
    console.warn('[uploads] Mongo connection unavailable; continuing with filesystem-only pruning', error?.message || error);
  } finally {
    try { await mongoose.disconnect(); } catch {}
  }
}

function walkDir(root, files = []) {
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, files);
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function toRelative(fullPath) {
  return path.relative(uploadsRoot, fullPath).replace(/\\/g, '/');
}

async function main() {
  await collectReferencedPaths();

  const allFiles = walkDir(uploadsRoot);
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const toDelete = [];

  for (const fullPath of allFiles) {
    const rel = toRelative(fullPath);
    if (rel === '.' || rel.startsWith('..')) continue;
    try {
      const stat = await fs.promises.stat(fullPath);
      const isOld = stat.mtime && stat.mtime < cutoff;
      const isUntracked = !trackedFiles.has(rel);
      if (isOld && isUntracked) toDelete.push({ fullPath, rel, size: stat.size || 0 });
    } catch (error) {
      console.warn('[uploads] stat failed', fullPath, error?.message || error);
    }
  }

  let deletedBytes = 0;
  for (const item of toDelete) {
    try {
      if (dryRun) {
        console.log(`[uploads][dry-run] would delete ${item.rel} (${item.size} bytes)`);
        continue;
      }
      await fs.promises.unlink(item.fullPath);
      deletedBytes += item.size;
    } catch (error) {
      console.warn('[uploads] failed to delete', item.fullPath, error?.message || error);
    }
  }

  console.log(JSON.stringify({
    uploadsRoot,
    trackedFiles: trackedFiles.size,
    filesScanned: allFiles.length,
    filesDeleted: dryRun ? 0 : toDelete.length,
    bytesDeleted: dryRun ? 0 : deletedBytes,
    olderThanDays,
    mode: dryRun ? 'dry-run' : 'delete',
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
