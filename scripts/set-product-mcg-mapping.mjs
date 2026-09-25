#!/usr/bin/env node
import dbManager from '../services/dbManager.js';
import Product from '../models/Product.js';
import { getItemsList } from '../services/mcgService.js';

function parseArgs(argv){
  const args = { _: [] };
  for(let i=2;i<argv.length;i++){
    const a = argv[i];
    if(a==='--barcode' || a==='-b'){ args.barcode = argv[++i]; }
    else if(a==='--item' || a==='-i'){ args.item = argv[++i]; }
    else { args._.push(a); }
  }
  return args;
}

(async()=>{
  try{
    const args = parseArgs(process.argv);
    const productId = args._[0];
    if(!productId){ console.error('Usage: node scripts/set-product-mcg-mapping.mjs <productId> [--barcode <code> | --item <mcgItemId>]'); process.exit(1); }
    if(!args.barcode && !args.item){ console.error('Pass either --barcode or --item'); process.exit(1); }

    await dbManager.connectWithRetry();

    const p = await Product.findById(productId);
    if(!p){ console.error('Product not found:', productId); process.exit(1); }

    let mcgItemId = args.item || '';
    let mcgBarcode = args.barcode || '';

    if (mcgBarcode && !mcgItemId) {
      // Try resolve mcgItemId from MCG items by barcode
      const data = await getItemsList({ Filter: mcgBarcode });
      const items = Array.isArray(data?.items || data?.data || data?.Items) ? (data?.items || data?.data || data?.Items) : (Array.isArray(data) ? data : []);
      const found = items.find(it => String(it?.Barcode ?? it?.barcode ?? it?.item_code ?? '').trim() === mcgBarcode);
      if(found){
        mcgItemId = String(found?.ItemID ?? found?.id ?? found?.itemId ?? found?.item_id ?? '').trim();
      }
    }

    if (mcgItemId) p.mcgItemId = mcgItemId;
    if (mcgBarcode) p.mcgBarcode = mcgBarcode;
    await p.save();

    console.log('[mcg][map] updated', { productId, mcgItemId: p.mcgItemId || '', mcgBarcode: p.mcgBarcode || '' });
    process.exit(0);
  }catch(e){
    console.error('[mcg][map] failed:', e?.message||e);
    process.exit(1);
  }
})();
