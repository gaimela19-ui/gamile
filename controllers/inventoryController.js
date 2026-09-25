function computeInventoryStatus(quantity, lowStockThreshold = 5) {
  const qty = Number(quantity) || 0;
  const threshold = Number(lowStockThreshold);
  const safeThreshold = Number.isFinite(threshold) ? threshold : 5;
  if (qty <= 0) return 'out_of_stock';
  if (qty <= safeThreshold) return 'low_stock';
  return 'in_stock';
}

async function syncProductStockSideEffects(productId) {
  if (!productId) return;
  try { await inventoryService.recomputeProductStock(productId); } catch {}
  try { await inventoryService.pushMcgForEntireProduct(productId); } catch {}
  try { realTimeEventService.emitInventoryChanged({ productId: String(productId), action: 'updated' }); } catch {}
}

export const moveStockBetweenWarehouses = asyncHandler(async (req, res) => {
  const { product, size, color, variantId, quantity, fromWarehouse, toWarehouse, reason } = req.body;
  const userId = req.user?._id;
  if (!userId) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'User required' });
  }
  try {
    const result = await inventoryService.moveStockBetweenWarehouses({
      product,
      size,
      color,
      variantId,
      quantity,
      fromWarehouse,
      toWarehouse,
      userId,
      reason
    });
    res.status(StatusCodes.OK).json({ message: 'Stock moved successfully', result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});
// Update inventory by product, color, and size
import Inventory from '../models/Inventory.js';
export const updateInventoryByProductColorSize = asyncHandler(async (req, res) => {
  const { productId, color, size, variantId } = req.body;
  const { quantity } = req.body;
  if (!productId || typeof quantity !== 'number') {
    return res.status(StatusCodes.BAD_REQUEST).json({ message: 'productId and quantity are required' });
  }
  if (!variantId && (!color || !size)) {
    return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Provide either variantId or both color and size' });
  }
  const query = variantId ? { product: productId, variantId } : { product: productId, color, size };

  const existing = await Inventory.findOne(query).select('lowStockThreshold');
  if (!existing) {
    return res.status(StatusCodes.NOT_FOUND).json({ message: 'Inventory record not found' });
  }

  const status = computeInventoryStatus(quantity, existing.lowStockThreshold);
  const inventory = await Inventory.findOneAndUpdate(
    query,
    { $set: { quantity, status, lastUpdated: new Date() } },
    { new: true, runValidators: true }
  );
  await syncProductStockSideEffects(productId);
  res.status(StatusCodes.OK).json(inventory);
});
import asyncHandler from 'express-async-handler';
import { inventoryService } from '../services/inventoryService.js';
import { StatusCodes } from 'http-status-codes';
import mongoose from 'mongoose';
import Warehouse from '../models/Warehouse.js';
import Product from '../models/Product.js';
import { realTimeEventService } from '../services/realTimeEventService.js';

export const getInventory = asyncHandler(async (req, res) => {
  console.log('getInventory controller called');
  console.log('User:', req.user?._id, req.user?.role);

  // Optional pagination + filters
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const location = typeof req.query.location === 'string' ? req.query.location : '';
  const sort = typeof req.query.sort === 'string' ? req.query.sort : '';

  // If no pagination params supplied, keep backward compatibility by returning full list
  const usingPaging = req.query.page !== undefined || req.query.limit !== undefined || search || status || location || sort;
  if (!usingPaging) {
    const inventory = await inventoryService.getAllInventory();
    console.log('Inventory fetched, count:', inventory.length);
    return res.status(StatusCodes.OK).json(inventory);
  }

  const result = await inventoryService.queryInventory({ page, limit, search, status, location, sort });
  return res.status(StatusCodes.OK).json(result);
});

export const getProductInventory = asyncHandler(async (req, res) => {
  const inventory = await inventoryService.getProductInventory(req.params.productId);
  res.status(StatusCodes.OK).json(inventory);
});

// Get summarized stock per variant for a product
export const getVariantStockSummary = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const results = await Inventory.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId) } },
    { $group: { _id: { variantId: '$variantId' }, quantity: { $sum: '$quantity' } } },
    { $project: { _id: 0, variantId: '$_id.variantId', quantity: 1 } }
  ]).allowDiskUse(false);
  res.status(StatusCodes.OK).json(results);
});

export const updateInventory = asyncHandler(async (req, res) => {
  try {
    console.log('updateInventory called');
    console.log('params:', req.params);
    console.log('body:', req.body);
    console.log('user:', req.user?._id);
    const inventory = await inventoryService.updateInventory(
      req.params.id,
      req.body.quantity,
      req.user._id
    );
    res.status(StatusCodes.OK).json(inventory);
  } catch (err) {
    console.error('Error in updateInventory:', err);
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
});

export const addInventory = asyncHandler(async (req, res) => {
  console.log('addInventory controller called');
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  console.log('User:', req.user?._id, req.user?.role);
  
  const inventory = await inventoryService.addInventory(req.body, req.user._id);
  res.status(StatusCodes.CREATED).json(inventory);
});

// Update inventory by variantId and warehouse
export const updateInventoryByVariant = asyncHandler(async (req, res) => {
  let { productId, variantId, warehouseId, quantity } = req.body || {};
  try { console.log('[inventory][by-variant] body', JSON.stringify(req.body)); } catch {}
  const isObjectId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
  if (!productId || !variantId || typeof quantity !== 'number') {
    return res.status(StatusCodes.BAD_REQUEST).json({ message: 'productId, variantId, and quantity are required' });
  }
  // Default to Main Warehouse when not multi-warehouse and no warehouseId provided
  if (!warehouseId) {
    try {
      const warehouses = await Warehouse.find({});
      if (!warehouses || warehouses.length === 0) {
        const main = await Warehouse.findOneAndUpdate(
          { name: 'Main Warehouse' },
          { $setOnInsert: { name: 'Main Warehouse' } },
          { new: true, upsert: true }
        );
        warehouseId = String(main._id);
      } else if (warehouses.length === 1) {
        warehouseId = String(warehouses[0]._id);
      } else {
        // Multiple warehouses exist.
        // 1) Respect DEFAULT_WAREHOUSE_ID if valid and exists
        const isObjectId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
        const envId = process.env.DEFAULT_WAREHOUSE_ID;
        if (envId && isObjectId(envId)) {
          const exists = warehouses.find(w => String(w._id) === envId);
          if (exists) {
            warehouseId = envId;
          }
        }
        // 2) Otherwise try DEFAULT_WAREHOUSE_NAME
        if (!warehouseId) {
          const envName = process.env.DEFAULT_WAREHOUSE_NAME;
          if (envName) {
            const found = warehouses.find(w => String(w?.name || '').toLowerCase() === String(envName).toLowerCase());
            if (found) warehouseId = String(found._id);
          }
        }
        // 3) Otherwise try a conventional fallback "Main Warehouse"
        if (!warehouseId) {
          const main = warehouses.find(w => String(w?.name || '').toLowerCase() === 'main warehouse');
          if (main && main._id) warehouseId = String(main._id);
        }
        // 4) If still none, require explicit selection
        if (!warehouseId) {
          return res.status(StatusCodes.BAD_REQUEST).json({ message: 'warehouseId is required when multiple warehouses exist' });
        }
      }
    } catch (e) {
      console.error('[inventory][by-variant] warehouse resolution error', e);
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Unable to resolve warehouse. Please select a warehouse and try again.' });
    }
  }
  if (!isObjectId(productId) || !isObjectId(variantId) || !isObjectId(warehouseId)) {
    return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Invalid productId, variantId, or warehouseId' });
  }
  if (!Number.isFinite(quantity) || quantity < 0) {
    return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Quantity must be a non-negative number' });
  }

  // Strong validation: ensure product, variant, and warehouse exist to avoid opaque 500s later
  try {
    const [productDoc, warehouseDoc] = await Promise.all([
      Product.findById(productId).select('variants').lean(),
      Warehouse.findById(warehouseId).lean()
    ]);
    if (!productDoc) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Product not found' });
    }
    const variantBelongs = Array.isArray(productDoc.variants)
      ? productDoc.variants.some(v => String(v?._id) === String(variantId))
      : false;
    if (!variantBelongs) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Variant does not belong to the specified product' });
    }
    if (!warehouseDoc) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Warehouse not found' });
    }
  } catch (preErr) {
    console.error('[inventory][by-variant] pre-validation error', preErr);
    return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Invalid request data for variant inventory update' });
  }

  try {
    // Normalize to ObjectId strings (Mongoose will cast but we keep consistent logs)
    const filter = { product: productId, variantId, warehouse: warehouseId };
    let existingInventory = null;
    // Build $setOnInsert with attributesSnapshot when available to improve display in UI
    let setOnInsert = { product: productId, variantId, warehouse: warehouseId };
    try {
      // If this combination doesn't exist yet, attempt to derive attributesSnapshot from Product.variants
      existingInventory = await Inventory.findOne(filter).lean();
      if (!existingInventory) {
        const prod = await Product.findById(productId).select('variants.attributes').lean();
        const v = Array.isArray(prod?.variants)
          ? prod.variants.find(x => String(x?._id) === String(variantId))
          : null;
        if (v && Array.isArray(v.attributes) && v.attributes.length) {
          setOnInsert = {
            ...setOnInsert,
            attributesSnapshot: v.attributes.map((a) => ({
              attribute: a?.attribute,
              value: a?.value,
              textValue: a?.textValue,
              numberValue: a?.numberValue
            }))
          };
        }
      }
    } catch (snapErr) {
      // Non-fatal: proceed without snapshot
      try { console.warn('[inventory][by-variant] snapshot build failed:', snapErr?.message || snapErr); } catch {}
    }
    const status = computeInventoryStatus(quantity, existingInventory?.lowStockThreshold);
    // Use $setOnInsert to satisfy required fields when upserting a new row
    const update = {
      $set: { quantity, status, lastUpdated: new Date() },
      $setOnInsert: setOnInsert
    };
    const options = { new: true, runValidators: true, upsert: quantity > 0, setDefaultsOnInsert: true };
    // Upsert only when quantity > 0 to avoid creating empty rows; otherwise require existing record
    const inv = await Inventory.findOneAndUpdate(filter, update, options);
    if (!inv) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Inventory record not found for variant in this warehouse' });
    }
    await syncProductStockSideEffects(productId);
    return res.status(StatusCodes.OK).json(inv);
  } catch (err) {
    // Handle common cast/validation errors explicitly
    if (err?.name === 'CastError') {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Invalid identifier provided' });
    }
    if (err?.name === 'ValidationError') {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Validation error updating inventory' });
    }
    const isDup = (err?.code === 11000) || String(err?.message || '').includes('E11000');
    if (isDup) {
      // Attempt automatic reconciliation of duplicate rows for this combination by
      // deterministically keeping the most recently updated row and deleting extras.
      try {
        const pid = new mongoose.Types.ObjectId(productId);
        const vid = new mongoose.Types.ObjectId(variantId);
        const wid = new mongoose.Types.ObjectId(warehouseId);
        const filter = { product: pid, variantId: vid, warehouse: wid };
        // Fetch duplicates (if any)
        const dups = await Inventory.find(filter).sort({ updatedAt: -1, _id: -1 });
        if (Array.isArray(dups) && dups.length > 0) {
          const keep = dups[0];
          const extras = dups.slice(1).map(d => d._id).filter(Boolean);
          if (extras.length) {
            try {
              await Inventory.deleteMany({ _id: { $in: extras } });
              console.warn('[inventory][by-variant] removed duplicate rows:', extras.map(String));
            } catch (delErr) {
              console.error('[inventory][by-variant] failed deleting duplicate rows', delErr);
            }
          }
          // Ensure the surviving document reflects the requested quantity
          try {
            keep.quantity = quantity;
            await keep.save();
          } catch (saveErr) {
            console.error('[inventory][by-variant] failed saving survivor after dedupe', saveErr);
          }
          await syncProductStockSideEffects(productId);
          return res.status(StatusCodes.OK).json(keep);
        }
        // If we did not find rows (race condition), retry the original update once without upsert
        try {
          const status = computeInventoryStatus(quantity);
          const retry = await Inventory.findOneAndUpdate(
            filter,
            { $set: { quantity, status, lastUpdated: new Date() }, $setOnInsert: { product: pid, variantId: vid, warehouse: wid } },
            { new: true, runValidators: true, upsert: quantity > 0, setDefaultsOnInsert: true }
          );
          if (retry) {
            await syncProductStockSideEffects(productId);
            return res.status(StatusCodes.OK).json(retry);
          }
        } catch (retryErr) {
          console.error('[inventory][by-variant] retry after dedupe failed', retryErr);
        }
      } catch (reconcileErr) {
        console.error('[inventory][by-variant] duplicate reconcile failed', reconcileErr);
      }
      // If reconciliation failed for any reason, return 409 (conflict) with a clear message
      return res.status(StatusCodes.CONFLICT).json({ message: 'Duplicate inventory row exists for this product variant and warehouse. Please try again.' });
    }
    console.error('updateInventoryByVariant error', err);
    // Surface a more specific message if available to help diagnose in admin UI (without leaking stack traces)
    const msg = (err && (err.message || err.reason)) ? String(err.message || err.reason) : 'Failed to update variant inventory';
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: msg });
  }
});

export const getLowStockItems = asyncHandler(async (req, res) => {
  const items = await inventoryService.getLowStockItems();
  res.status(StatusCodes.OK).json(items);
});

export const bulkUpdateInventory = asyncHandler(async (req, res) => {
  await inventoryService.bulkUpdateInventory(req.body.items, req.user._id);
  res.status(StatusCodes.OK).json({ 
    success: true,
    message: 'Inventory updated successfully' 
  });
});