#!/usr/bin/env node
import dbManager from '../services/dbManager.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Inventory from '../models/Inventory.js';

function id(v){ return (v&&v.toString?v.toString():String(v)); }

(async()=>{
  try{
    await dbManager.connectWithRetry();
    const order = await Order.findOne({}).sort({ createdAt: -1, _id: -1 }).lean();
    if(!order){ console.log('[inspect] no orders'); process.exit(0); }
    console.log('[inspect] last order', order.orderNumber || order._id);
    const out = [];
    for(const it of (order.items||[])){
      const pid = it.product?._id || it.product;
      const p = await Product.findById(pid).select('name mcgBarcode mcgItemId variants').lean();
      const invFilter = it.variantId
        ? { product: pid, variantId: it.variantId }
        : { product: pid, size: (it.size && String(it.size).trim())?it.size:'Default', color: (it.color && String(it.color).trim())?it.color:'Default' };
      const rows = await Inventory.find(invFilter).select('warehouse size color variantId quantity').lean();
      let variantBarcode='';
      if (it.variantId && Array.isArray(p?.variants)) {
        const v = p.variants.find(vv => id(vv._id)===id(it.variantId));
        if(v && v.barcode) variantBarcode=String(v.barcode).trim();
      }
      out.push({
        productId: id(pid),
        name: p?.name||'',
        variantId: it.variantId? id(it.variantId):'',
        variantBarcode,
        mcgBarcode: p?.mcgBarcode||'',
        mcgItemId: p?.mcgItemId||'',
        inventoryRows: rows.map(r=>({ qty: r.quantity, size: r.size||'', color: r.color||'', variantId: r.variantId? id(r.variantId):'' }))
      });
    }
    console.log(JSON.stringify(out,null,2));
    process.exit(0);
  }catch(e){
    console.error('[inspect] failed:', e?.message||e);
    process.exit(1);
  }
})();
