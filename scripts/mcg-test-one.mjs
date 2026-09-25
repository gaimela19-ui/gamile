#!/usr/bin/env node
/**
 * Push a single SKU's absolute quantity to MCG (Uplîcali) and optionally verify.
 *
 * Usage examples (PowerShell):
 *   node project/server/scripts/mcg-test-one.mjs --product <productId>
 *   node project/server/scripts/mcg-test-one.mjs --product <productId> --variant <variantId>
 *   node project/server/scripts/mcg-test-one.mjs --product <productId> --dry-run
 *
 * Notes:
 * - For Uplîcali flavor, prefers variant barcode (item_code) or product.mcgBarcode; falls back to product.mcgItemId as item_id.
 * - If product has variants, pass --variant to test a specific variant.
 */

import dbManager from '../services/dbManager.js';
import Settings from '../models/Settings.js';
import Product from '../models/Product.js';
import Inventory from '../models/Inventory.js';
import { setItemsList, getItemsList } from '../services/mcgService.js';

function parseArgs(argv){
  const out = { _: [] };
  for(let i=2;i<argv.length;i++){
    const a = argv[i];
    if(a==='--product' || a==='-p') out.product = argv[++i];
    else if(a==='--variant' || a==='-v') out.variant = argv[++i];
    else if(a==='--dry-run') out.dryRun = true;
    else if(a==='--verify') out.verify = true;
    else out._.push(a);
  }
  return out;
}

async function sumQty(filter) {
  const rows = await Inventory.find(filter).select('quantity').lean();
  return rows.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
}

function norm(v){ return (v===undefined||v===null)?'':String(v).trim(); }

(async()=>{
  const args = parseArgs(process.argv);
  const productId = args.product || args._[0];
  const variantId = args.variant;
  const dryRun = !!args.dryRun;
  const verify = !!args.verify || String(process.env.MCG_VERIFY_AFTER_SET||'').toLowerCase()==='true';

  if(!productId){
    console.error('Usage: node project/server/scripts/mcg-test-one.mjs --product <productId> [--variant <variantId>] [--dry-run] [--verify]');
    process.exit(1);
  }

  await dbManager.connectWithRetry();
  const settings = await Settings.findOne().lean();
  const mcg = settings?.mcg || {};
  const flavor = String(mcg.apiFlavor||'').toLowerCase();
  if(!mcg.enabled){ console.error('[mcg][test-one] MCG not enabled in settings'); process.exit(1); }
  if(flavor !== 'uplicali'){
    console.error('[mcg][test-one] Only Uplîcali flavor is supported by this test script');
    process.exit(1);
  }

  const p = await Product.findById(productId).select('mcgBarcode mcgItemId variants._id variants.barcode').lean();
  if(!p){ console.error('[mcg][test-one] Product not found:', productId); process.exit(1); }

  let mapping = null; // { kind: 'code'|'id', value: string }
  let qty = 0;

  if(variantId){
    const v = (Array.isArray(p.variants)? p.variants: []).find(x=> String(x?._id)===String(variantId));
    if(!v){ console.error('[mcg][test-one] Variant not found on product'); process.exit(1); }
    const barcode = norm(v?.barcode);
    if(barcode) mapping = { kind: 'code', value: barcode };
    else if(norm(p.mcgItemId)) mapping = { kind: 'id', value: norm(p.mcgItemId) };
    else { console.error('[mcg][test-one] No barcode on variant and no product.mcgItemId fallback'); process.exit(1); }
    qty = await sumQty({ product: productId, variantId });
  } else {
    // No variant specified
    const hasVariants = Array.isArray(p.variants) && p.variants.length>0;
    if(hasVariants){
      console.error('[mcg][test-one] Product has variants. Pass --variant <variantId> to test a specific SKU.');
      process.exit(1);
    }
    const barcode = norm(p.mcgBarcode);
    if(barcode) mapping = { kind: 'code', value: barcode };
    else if(norm(p.mcgItemId)) mapping = { kind: 'id', value: norm(p.mcgItemId) };
    else { console.error('[mcg][test-one] No mcgBarcode and no mcgItemId on product'); process.exit(1); }
    qty = await sumQty({ product: productId });
  }

  const clamped = Math.max(0, Number(qty)||0);
  const group = Number.isFinite(Number(mcg.group)) ? Number(mcg.group) : undefined;

  const item = mapping.kind==='code'
    ? { item_code: mapping.value, item_inventory: clamped }
    : { item_id: mapping.value, item_inventory: clamped };

  console.log('[mcg][test-one] flavor=%s group=%s mapping=%s=%s qty=%d', flavor, group ?? 'default', mapping.kind, mapping.value, clamped);

  if(dryRun){
    console.log('[mcg][test-one] DRY RUN payload:', JSON.stringify({ req:'set_items_list', items:[item], ...(group!==undefined?{group}: {}) }));
  } else {
    const res = await setItemsList([item], group);
    console.log('[mcg][test-one] set_items_list response:', JSON.stringify(res));
  }

  if(verify){
    try{
      const data = await getItemsList({ group });
      const arr = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.Items)? data.Items : (Array.isArray(data)? data : []));
      const codeMatch = (x)=> norm(x?.item_code ?? x?.Barcode ?? x?.barcode) === mapping.value;
      const idMatch = (x)=> norm(x?.item_id ?? x?.ItemID ?? x?.id) === mapping.value;
      const found = arr.find(x => mapping.kind==='code' ? codeMatch(x) : idMatch(x));
      const observed = Number(found?.item_inventory ?? found?.StockQuantity ?? found?.stock);
      console.log('[mcg][test-one][verify] %s=%s expected=%s observed=%s', mapping.kind, mapping.value, clamped, Number.isFinite(observed)? observed : 'n/a');
    } catch(e){
      console.warn('[mcg][test-one][verify] failed:', e?.message || e);
    }
  }

  process.exit(0);
})().catch(err=>{ console.error('[mcg][test-one] failed:', err?.message||err); process.exit(1); });
