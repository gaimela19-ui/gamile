import Inventory from '../../models/Inventory.js';
import Product from '../../models/Product.js';
import Settings from '../../models/Settings.js';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../../utils/ApiError.js';

export class InventoryUpdate {
  async create(data) {
    // If creating a variant-based inventory row and no attributes snapshot provided,
    // derive a snapshot from the product's variant attributes for quick display later.
    let payload = { ...data };
    if (payload.lowStockThreshold === undefined || payload.lowStockThreshold === null || payload.lowStockThreshold === '') {
      try {
        const settings = await Settings.findOne().select('inventory.lowStockThreshold').lean();
        const configured = Number(settings?.inventory?.lowStockThreshold);
        payload.lowStockThreshold = Number.isFinite(configured) && configured >= 1 ? Math.round(configured) : 5;
      } catch {
        payload.lowStockThreshold = 5;
      }
    }
    try {
      if (data?.variantId && (!Array.isArray(data.attributesSnapshot) || data.attributesSnapshot.length === 0)) {
        const productId = typeof data.product === 'object' ? data.product?._id : data.product;
        if (productId) {
          const prod = await Product.findById(productId).select('variants.attributes');
          if (prod && Array.isArray(prod.variants)) {
            const v = prod.variants.find((vv) => String(vv?._id) === String(data.variantId));
            if (v && Array.isArray(v.attributes) && v.attributes.length) {
              payload.attributesSnapshot = v.attributes.map((a) => ({
                attribute: a?.attribute,
                value: a?.value,
                textValue: a?.textValue,
                numberValue: a?.numberValue
              }));
            }
          }
        }
      }
    } catch (e) {
      // Non-fatal: if snapshotting fails, continue with provided data
      console.warn('inventoryUpdate.create: failed to build attributesSnapshot', e?.message || e);
    }

    const inventory = new Inventory(payload);
    const savedInventory = await inventory.save();
    return savedInventory;
  }

  async updateQuantity(id, quantity) {
    const inventory = await Inventory.findByIdAndUpdate(
      id,
      { quantity },
      { new: true, runValidators: true }
    ).populate('product', 'name');

    if (!inventory) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Inventory record not found');
    }

    return inventory;
  }
}