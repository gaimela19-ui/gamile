import mongoose from 'mongoose';
import Category from '../models/Category.js';

// Usage: node server/scripts/backfillCategoryHierarchy.js MONGODB_URI
async function main() {
  const uri = process.env.MONGODB_URI || process.argv[2];
  if (!uri) {
    console.error('Provide MongoDB URI via MONGODB_URI or as first argument');
    process.exit(1);
  }
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || undefined });
  const cats = await Category.find();
  const byId = new Map(cats.map(c => [String(c._id), c]));

  function computeFor(cat) {
    if (!cat.parent) {
      cat.ancestors = [];
      cat.depth = 0;
      cat.path = cat.slug;
      return;
    }
    const parent = byId.get(String(cat.parent));
    if (!parent) {
      // Orphaned parent reference: treat as root
      cat.parent = null;
      cat.ancestors = [];
      cat.depth = 0;
      cat.path = cat.slug;
      return;
    }
    cat.ancestors = [...(parent.ancestors || []), parent._id];
    cat.depth = (parent.depth || 0) + 1;
    cat.path = (parent.path || parent.slug) ? `${parent.path || parent.slug}/${cat.slug}` : cat.slug;
  }

  for (const c of cats) {
    computeFor(c);
  }
  for (const c of cats) {
    await c.save();
  }
  console.log(`Updated ${cats.length} categories.`);
  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
