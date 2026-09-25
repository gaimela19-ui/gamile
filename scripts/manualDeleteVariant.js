// Small script to exercise DELETE variant logic directly via Mongoose
// Usage: set MONGO_URI in env, then run via node. Not used in production.
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Inventory from '../models/Inventory.js';

const [,, productId, variantId] = process.argv;

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is required');
    process.exit(1);
  }
  if (!productId || !variantId) {
    console.error('Usage: node manualDeleteVariant.js <productId> <variantId>');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  const prod = await Product.findById(productId);
  if (!prod) throw new Error('Product not found');
  const v = (prod.variants || []).id(variantId);
  if (!v) throw new Error('Variant not found');
  const invCount = await Inventory.countDocuments({ product: productId, variantId });
  console.log('Inventory rows for variant:', invCount);
  if (invCount > 0) {
    console.log('Refusing to delete variant with inventory rows.');
    return;
  }
  if (typeof v.remove === 'function') v.remove(); else prod.variants = prod.variants.filter((vv)=> String(vv._id)!==String(variantId));
  await prod.save();
  const fresh = await Product.findById(productId).select('variants._id variants.sku');
  console.log('Remaining variants:', fresh?.variants?.map((x)=> String(x._id)));
}

main().then(()=>process.exit(0)).catch((e)=>{ console.error(e); process.exit(1); });
