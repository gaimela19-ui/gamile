#!/usr/bin/env node
import dbManager from '../services/dbManager.js';
import Product from '../models/Product.js';

const id = process.argv[2] || process.env.PRODUCT_ID;
if(!id){
  console.error('Usage: node project/server/scripts/print-product.mjs <productId>');
  process.exit(1);
}

(async()=>{
  await dbManager.connectWithRetry();
  const p = await Product.findById(id).lean();
  if(!p){ console.error('Product not found:', id); process.exit(1); }
  const minimal = {
    _id: String(p._id),
    name: p.name,
    mcgItemId: p.mcgItemId || '',
    mcgBarcode: p.mcgBarcode || '',
    variants: Array.isArray(p.variants)? p.variants.map(v=>({ _id: String(v._id), sku: v.sku||'', barcode: v.barcode||'', stock: v.stock||0 })) : []
  };
  console.log(JSON.stringify(minimal, null, 2));
  process.exit(0);
})().catch(e=>{ console.error(e?.message||e); process.exit(1); });
