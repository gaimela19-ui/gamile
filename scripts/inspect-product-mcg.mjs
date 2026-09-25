#!/usr/bin/env node
/*
  Inspect a product's MCG mapping and variant barcodes.
  Usage:
    node project/server/scripts/inspect-product-mcg.mjs <productId>
*/
import mongoose from 'mongoose';
import { connectWithRetry } from '../services/dbManager.js';
import Product from '../models/Product.js';
import Inventory from '../models/Inventory.js';

const productId = process.argv[2];
if (!productId || !/^[0-9a-fA-F]{24}$/.test(productId)) {
  console.error('Usage: node project/server/scripts/inspect-product-mcg.mjs <24-char productId>');
  process.exit(2);
}

(async () => {
  try {
    await connectWithRetry(3);
    const prod = await Product.findById(productId).lean();
    if (!prod) { console.error('Product not found:', productId); process.exit(1); }
    const variants = Array.isArray(prod.variants) ? prod.variants : [];
    const variantSumm = variants.map(v => ({ id: String(v._id), name: v.name || v.title || '', barcode: v.barcode || '' }));
    const invRows = await Inventory.find({ product: productId }).select('variantId size color quantity').lean();
    console.log('[inspect][product]', {
      _id: String(prod._id),
      name: prod.name,
      mcgItemId: prod.mcgItemId || null,
      mcgBarcode: prod.mcgBarcode || null,
      variants: variantSumm,
      inventoryRows: invRows,
      totalStock: (invRows||[]).reduce((s,x)=>s+(Number(x.quantity)||0),0)
    });
  } catch (e) {
    console.error('[inspect][error]', e?.message || e);
    process.exitCode = 1;
  } finally {
    try { await mongoose.disconnect(); } catch {}
  }
})();
