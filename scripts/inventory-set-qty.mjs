#!/usr/bin/env node
/**
 * Set the total inventory quantity for a non-variant product to a target value.
 * - Decreases or increases across existing Inventory rows for the product.
 * - Creates a default row in "Main Warehouse" if no rows exist when increasing.
 *
 * Usage (PowerShell):
 *   node project/server/scripts/inventory-set-qty.mjs --product <productId> --target 7
 */

import dbManager from '../services/dbManager.js';
import Product from '../models/Product.js';
import Inventory from '../models/Inventory.js';
import Warehouse from '../models/Warehouse.js';

function parseArgs(argv){
  const out = { _: [] };
  for(let i=2;i<argv.length;i++){
    const a = argv[i];
    if(a==='--product' || a==='-p') out.product = argv[++i];
    else if(a==='--target' || a==='-t') out.target = Number(argv[++i]);
    else out._.push(a);
  }
  return out;
}

async function main(){
  const args = parseArgs(process.argv);
  const productId = args.product || args._[0];
  const target = Number(args.target);
  if(!productId || !Number.isFinite(target)){
    console.error('Usage: node project/server/scripts/inventory-set-qty.mjs --product <productId> --target <number>');
    process.exit(1);
  }

  await dbManager.connectWithRetry();
  const p = await Product.findById(productId).select('variants').lean();
  if(!p){ console.error('Product not found:', productId); process.exit(1); }
  const hasVariants = Array.isArray(p.variants) && p.variants.length>0;
  if(hasVariants){
    console.error('Product has variants. This helper only supports non-variant products.');
    process.exit(1);
  }

  const rows = await Inventory.find({ product: productId }).sort({ quantity: -1 });
  const current = rows.reduce((s, x)=> s + (Number(x.quantity)||0), 0);
  console.log('[inv-set-qty] current=%d target=%d rows=%d', current, target, rows.length);
  if(current === target){ console.log('[inv-set-qty] quantity already at target'); process.exit(0); }

  if(target < current){
    // Decrease: subtract greedily from largest rows first
    let remain = current - target;
    for(const r of rows){
      if(remain<=0) break;
      const take = Math.min(remain, Number(r.quantity)||0);
      r.quantity = (Number(r.quantity)||0) - take;
      await r.save();
      remain -= take;
    }
  } else {
    // Increase by delta on first row, or create a default row
    const delta = target - current;
    if(rows.length){
      rows[0].quantity = (Number(rows[0].quantity)||0) + delta;
      await rows[0].save();
    } else {
      let wh = await Warehouse.findOne({ name: 'Main Warehouse' });
      if(!wh){ wh = await Warehouse.findOneAndUpdate({ name: 'Main Warehouse' }, { $setOnInsert: { name: 'Main Warehouse' } }, { new: true, upsert: true }); }
      const inv = new Inventory({ product: productId, size: 'Default', color: 'Default', quantity: target, warehouse: wh?._id, location: wh?.name });
      await inv.save();
    }
  }

  const afterRows = await Inventory.find({ product: productId }).lean();
  const after = afterRows.reduce((s,x)=> s + (Number(x.quantity)||0), 0);
  console.log('[inv-set-qty] done. new total=%d', after);
  process.exit(0);
}

main().catch(e=>{ console.error('[inv-set-qty] failed:', e?.message||e); process.exit(1); });
