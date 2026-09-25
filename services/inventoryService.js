import WarehouseMovement from '../models/WarehouseMovement.js';
import Warehouse from '../models/Warehouse.js';
import Inventory from '../models/Inventory.js';
import Product from '../models/Product.js';
import InventoryHistory from '../models/InventoryHistory.js';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../utils/ApiError.js';
import { realTimeEventService } from './realTimeEventService.js';
import Settings from '../models/Settings.js';
import { updateItemsQuantities, setItemsList, getItemsList } from './mcgService.js';

function computeInventoryStatus(quantity, lowStockThreshold = 5) {
  const qty = Number(quantity) || 0;
  const threshold = Number(lowStockThreshold);
  const safeThreshold = Number.isFinite(threshold) ? threshold : 5;
  if (qty <= 0) return 'out_of_stock';
  if (qty <= safeThreshold) return 'low_stock';
  return 'in_stock';
}

class InventoryService {
  // Public: force recomputation of product and per-variant stock totals
  async recomputeProductStock(productId) {
    return this.#updateProductStock(productId);
  }

  // Reserve items for an order across warehouses. Checkout always records backorders as negative stock.
  // items: [{ product, quantity, variantId? , size?, color? }]
  async reserveItems(items, userId, session = null) {
    if (!Array.isArray(items) || !items.length) return;
    const settings = await Settings.findOne().sort({ updatedAt: -1 }).lean();
    const invCfg = settings?.inventory || {};
    const allowNegative = true;
    const mcgCfg = settings?.mcg || {};
    const hasExplicitPushFlag = Object.prototype.hasOwnProperty.call(mcgCfg, 'pushStockBackEnabled');
    const envPushFlag = String(process.env.MCG_PUSH_STOCK_BACK || '').toLowerCase();
    const envPushEnabled = envPushFlag === '1' || envPushFlag === 'true';
    const pushToMcg = hasExplicitPushFlag
      ? !!mcgCfg.pushStockBackEnabled
      : (!!mcgCfg.enabled || envPushEnabled);
    try {
      const flavor = String(mcgCfg?.apiFlavor || '').toLowerCase() || 'legacy';
      console.log('[inventory][reserve] items=%d allowNegative=%s mcg.pushBack=%s flavor=%s', items.length, allowNegative, pushToMcg, flavor);
    } catch {}
  const mcgBatch = [];
  // For Uplîcali absolute updates we support either item_code (barcode) or item_id (mcgItemId)
  // Key format: 'code:<value>' or 'id:<value>' -> qty
  const mcgAbsMap = new Map();
    const affectedProducts = new Set();
    for (const it of items) {
      const { product, quantity } = it;
      if (!product || !quantity || quantity <= 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid reservation item');
      }
      const usingVariant = !!it.variantId;
      // Normalize non-variant size/color to 'Default' when not provided to match default inventory rows
      const normalized = usingVariant
        ? { product, variantId: it.variantId }
        : { product, size: (it.size && String(it.size).trim()) ? it.size : 'Default', color: (it.color && String(it.color).trim()) ? it.color : 'Default' };
      const baseFilter = normalized;

      // Load inventories sorted by quantity desc
      const invQuery = Inventory.find({ ...baseFilter }).sort({ quantity: -1 });
      const invs = session ? await invQuery.session(session) : await invQuery;
      const totalAvail = invs.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
      if (!allowNegative && totalAvail < quantity) {
        // Use human-friendly product name (and note if it's a variant) instead of raw id
        let displayName = 'product';
        try {
          const pdoc = await Product.findById(product).select('name').lean();
          if (pdoc?.name) displayName = pdoc.name;
        } catch {}
        const variantHint = usingVariant ? ' (variant)' : '';
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `Insufficient stock for ${displayName}${variantHint}. Available: ${totalAvail}, requested: ${quantity}`
        );
      }

      // Decrement across inventories greedily
      let remain = quantity;
      for (const inv of invs) {
        if (remain <= 0) break;
        const take = Math.min(remain, allowNegative ? remain : inv.quantity);
        inv.quantity -= take;
        remain -= take;
        if (session) await inv.save({ session }); else await inv.save();
      }
      // If still remaining and negatives allowed, create or use a synthetic negative bucket on the first inventory row
      if (remain > 0 && allowNegative) {
        if (invs.length) {
          const inv = invs[0];
          inv.quantity -= remain; // go negative
          if (session) await inv.save({ session }); else await inv.save();
        } else {
          // No inventory rows yet: create a default row in Main Warehouse and record negative stock
          try {
            let warehouses = await Warehouse.find({});
            if (!warehouses || warehouses.length === 0) {
              const main = await Warehouse.findOneAndUpdate(
                { name: 'Main Warehouse' },
                { $setOnInsert: { name: 'Main Warehouse' } },
                { new: true, upsert: true }
              );
              warehouses = main ? [main] : [];
            }
            if (warehouses && warehouses.length) {
              const mainWh = warehouses.find(w => String(w?.name || '').toLowerCase() === 'main warehouse') || warehouses[0];
              const inv = new Inventory({
                product,
                variantId: usingVariant ? it.variantId : undefined,
                size: usingVariant ? undefined : baseFilter.size,
                color: usingVariant ? undefined : baseFilter.color,
                quantity: 0,
                warehouse: mainWh._id,
                location: mainWh.name,
                lowStockThreshold: 5
              });
              if (session) await inv.save({ session }); else await inv.save();
              inv.quantity -= remain;
              if (session) await inv.save({ session }); else await inv.save();
            } else {
              throw new Error('No warehouses available');
            }
          } catch (fallbackErr) {
            // If we cannot create a row, preserve the targeted message for the admin UI
            throw new ApiError(StatusCodes.BAD_REQUEST, 'No inventory rows found to record negative stock. Create at least one inventory entry for this item to allow negative stock.');
          }
        }
        remain = 0;
      }

      // History record
      await this.#createHistoryRecord({
        product,
        type: 'decrease',
        quantity,
        reason: 'Order reservation',
        user: userId
      });
      affectedProducts.add(String(product));

      // Prepare MCG stock update when enabled
      if (pushToMcg) {
        try {
          // Fetch mapping to MCG ItemCode (prefer variant barcode, else product mcgBarcode)
          const prodDoc = await Product.findById(product).select('mcgBarcode mcgItemId variants').lean();
          let itemCode = '';
          if (it.variantId && Array.isArray(prodDoc?.variants)) {
            const vv = prodDoc.variants.find(v => String(v?._id) === String(it.variantId));
            if (vv && vv.barcode) itemCode = String(vv.barcode).trim();
          }
          if (!itemCode) itemCode = String(prodDoc?.mcgBarcode || '').trim();
          if (!itemCode) itemCode = String(it?.sku || '').trim();
          const itemIdFallback = String(prodDoc?.mcgItemId || '').trim();
          const preferItemId = String(settings?.mcg?.apiFlavor||'').toLowerCase()==='uplicali' && !!settings?.mcg?.preferItemId && !!itemIdFallback;
          // If configured to prefer item_id for Uplîcali and mcgItemId exists, clear itemCode to force item_id mapping
          if (preferItemId) itemCode = '';
          if (itemCode) {
            const settingsNow = settings; // already loaded above
            const flavor = String(settingsNow?.mcg?.apiFlavor || '').toLowerCase();
            if (flavor === 'uplicali') {
              // Compute absolute final quantity for this SKU across inventories after the decrement
              const filter = it.variantId
                ? { product, variantId: it.variantId }
                : { product, size: (it.size && String(it.size).trim()) ? it.size : 'Default', color: (it.color && String(it.color).trim()) ? it.color : 'Default' };
              const finalRowsQuery = Inventory.find(filter).select('quantity').lean();
              const finalRows = session ? await finalRowsQuery.session(session) : await finalRowsQuery;
              const totalQty = finalRows.reduce((s,x)=> s + (Number(x.quantity)||0), 0);
              // Many external systems expect non-negative inventory; clamp at 0 to be safe
              mcgAbsMap.set(`code:${itemCode}`, Math.max(0, totalQty));
            } else {
              // Legacy flavors: send deltas
              mcgBatch.push({ ItemCode: itemCode, Quantity: -Math.abs(Number(quantity) || 0) });
            }
          } else if (itemIdFallback) {
            // No barcode, fallback to MCG item id when using Uplîcali flavor (supports item_id)
            const settingsNow = settings;
            const flavor = String(settingsNow?.mcg?.apiFlavor || '').toLowerCase();
            if (flavor === 'uplicali') {
              const filter = it.variantId
                ? { product, variantId: it.variantId }
                : { product, size: (it.size && String(it.size).trim()) ? it.size : 'Default', color: (it.color && String(it.color).trim()) ? it.color : 'Default' };
              const finalRowsQuery = Inventory.find(filter).select('quantity').lean();
              const finalRows = session ? await finalRowsQuery.session(session) : await finalRowsQuery;
              const totalQty = finalRows.reduce((s,x)=> s + (Number(x.quantity)||0), 0);
              mcgAbsMap.set(`id:${itemIdFallback}`, Math.max(0, totalQty));
            } else {
              // Legacy may or may not accept ItemID in ItemCode field; attempt as best-effort
              mcgBatch.push({ ItemCode: itemIdFallback, Quantity: -Math.abs(Number(quantity) || 0) });
            }
          } else {
            try {
              console.warn('[mcg][push-back] missing mapping for product=%s variantId=%s. Set variant.barcode/product.mcgBarcode, pass item sku, or set mcgItemId for Uplîcali.', String(product), it.variantId ? String(it.variantId) : '');
            } catch {}
          }
        } catch {}
      }
    }

    // Recompute product and variant stocks
    for (const pid of affectedProducts) {
      await this.#updateProductStock(pid);
    }

    // Fire-and-forget push to MCG if enabled and we have updates
    if (pushToMcg) {
      const flavor = String(settings?.mcg?.apiFlavor || '').toLowerCase();
      const group = Number.isFinite(Number(settings?.mcg?.group)) ? Number(settings?.mcg?.group) : undefined;
      try {
        if (flavor === 'uplicali' && mcgAbsMap.size) {
          const itemsForSet = Array.from(mcgAbsMap.entries()).map(([key, qty]) => {
            const [kind, val] = String(key).split(':', 2);
            if (kind === 'code') return { item_code: val, item_inventory: qty };
            return { item_id: val, item_inventory: qty };
          });
          const sample = itemsForSet[0]?.item_code || itemsForSet[0]?.item_id || 'n/a';
          // Determine which key was used for the first item for clearer logs
          const first = itemsForSet[0] || {};
          const usedKey = first.item_code ? 'item_code' : (first.item_id ? 'item_id' : 'unknown');
          try { console.log('[mcg][push-back] flavor=uplicali items=%d sample=%s using=%s group=%s', itemsForSet.length, sample, usedKey, group ?? 'default'); } catch {}
          const res = await setItemsList(itemsForSet, group);
          try {
            // Log minimal response to detect API-level soft failures
            const summary = (res && typeof res === 'object') ? JSON.stringify(res).slice(0,180) : String(res);
            console.log('[mcg][push-back] set_items_list ok (count=%d) resp=%s', itemsForSet.length, summary);
          } catch {}
          // Optional post-verify (for small batches) controlled by env flag
          try {
            const verifyFlag = String(process.env.MCG_VERIFY_AFTER_SET || '').toLowerCase() === 'true';
            if (verifyFlag && itemsForSet.length <= 5) {
              const data = await getItemsList({ group });
              const arr = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []));
              const norm = (v) => (v === undefined || v === null) ? '' : String(v).trim();
              for (const it of itemsForSet) {
                const code = norm(it.item_code);
                const id = norm(it.item_id);
                const expected = Number(it.item_inventory);
                const found = arr.find(x => (code && norm(x?.item_code ?? x?.Barcode ?? x?.barcode) === code) || (id && norm(x?.item_id ?? x?.ItemID ?? x?.id) === id));
                const observed = Number(found?.item_inventory ?? found?.StockQuantity ?? found?.stock);
                console.log('[mcg][verify] %s=%s expected=%s observed=%s', code ? 'code' : 'id', code || id || 'n/a', expected, Number.isFinite(observed) ? observed : 'n/a');
              }
            }
          } catch (verr) {
            try { console.warn('[mcg][verify] skipped:', verr?.message || verr); } catch {}
          }
        } else if (mcgBatch.length) {
          try { console.log('[mcg][push-back] flavor=legacy deltas=%d sample=%s', mcgBatch.length, mcgBatch[0]?.ItemCode || 'n/a'); } catch {}
          await updateItemsQuantities(mcgBatch);
          try { console.log('[mcg][push-back] update_items_quantities ok (count=%d)', mcgBatch.length); } catch {}
        } else {
          try { console.log('[mcg][push-back] skipped: no mapped item codes on this reservation'); } catch {}
          // Fallback: push full absolute stock per affected product when line-level mapping is missing.
          for (const pid of affectedProducts) {
            try { await this.pushMcgForEntireProduct(pid, session); } catch {}
          }
        }
      } catch (e) {
        try { console.warn('[mcg][push-back] failed:', e?.message || e); } catch {}
      }
    } else {
      try { console.log('[mcg][push-back] disabled (set Settings.mcg.pushStockBackEnabled=true or MCG_PUSH_STOCK_BACK=true)'); } catch {}
    }
  }

  // Increase back stock for items (used on cancel or return depending on settings)
  async incrementItems(items, userId, reason = 'Manual increase', session = null) {
    if (!Array.isArray(items) || !items.length) return;
    const affectedProducts = new Set();
    // Track the specific SKUs we touched so we can push absolute quantities to MCG (Uplîcali)
    const touchedSkus = [];
    for (const it of items) {
      const { product, quantity } = it;
      if (!product || !quantity || quantity <= 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid increment item');
      }
      const usingVariant = !!it.variantId;
      const baseFilter = usingVariant
        ? { product, variantId: it.variantId }
        : { product, size: (it.size && String(it.size).trim()) ? it.size : 'Default', color: (it.color && String(it.color).trim()) ? it.color : 'Default' };
      const invQuery = Inventory.find({ ...baseFilter }).sort({ quantity: 1 }); // smallest first
      const invs = session ? await invQuery.session(session) : await invQuery;
      let remain = quantity;
      for (const inv of invs) {
        if (remain <= 0) break;
        const add = remain;
        inv.quantity += add;
        remain -= add;
        if (session) await inv.save({ session }); else await inv.save();
      }
      if (remain > 0) {
        // If no rows existed, we cannot create without size/color/warehouse context in this generic method.
        // Let caller use addInventory to create missing rows explicitly.
      }
      await this.#createHistoryRecord({ product, type: 'increase', quantity, reason, user: userId });
      affectedProducts.add(String(product));
      // Record SKU for MCG absolute push
      touchedSkus.push(usingVariant
        ? { product, variantId: it.variantId, ...(it?.sku ? { sku: String(it.sku).trim() } : {}) }
        : { product, size: baseFilter.size, color: baseFilter.color, ...(it?.sku ? { sku: String(it.sku).trim() } : {}) });
    }
    for (const pid of affectedProducts) await this.#updateProductStock(pid);
    // Push absolute quantities to MCG where enabled (Uplîcali)
    try { await this.#pushMcgForSkus(touchedSkus); } catch {}
  }
  // Move stock between warehouses
  async moveStockBetweenWarehouses({ product, size, color, variantId, quantity, fromWarehouse, toWarehouse, userId, reason }) {
    if (!product || !fromWarehouse || !toWarehouse || !userId || !quantity || quantity <= 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'All fields are required and quantity must be > 0');
    }
    if (!variantId && (!size || !color)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Either variantId or both size and color are required');
    }

    const baseQuery = variantId
      ? { product, variantId, warehouse: fromWarehouse }
      : { product, size, color, warehouse: fromWarehouse };
    // Find source inventory
    const sourceInv = await Inventory.findOne(baseQuery);
    if (!sourceInv || sourceInv.quantity < quantity) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Insufficient stock in source warehouse');
    }

    // Find or create destination inventory
    let destQuery = variantId
      ? { product, variantId, warehouse: toWarehouse }
      : { product, size, color, warehouse: toWarehouse };
    let destInv = await Inventory.findOne(destQuery);
    if (!destInv) {
      destInv = new Inventory({ product, size, color, variantId, warehouse: toWarehouse, quantity: 0 });
    }

    // Update quantities
    sourceInv.quantity -= quantity;
    destInv.quantity += quantity;
    await sourceInv.save();
    await destInv.save();

    // Log movement
    await WarehouseMovement.create({
      product,
      size,
      color,
      quantity,
      fromWarehouse,
      toWarehouse,
      user: userId,
      reason
    });

    // Optionally, update product total stock if needed
  await this.#updateProductStock(product);

    return { from: sourceInv, to: destInv };
  }
  async getAllInventory() {
    try {
      const settings = await Settings.findOne().select('inventory.lowStockThreshold').lean();
      const globalLowStockThresholdRaw = Number(settings?.inventory?.lowStockThreshold);
      const globalLowStockThreshold = Number.isFinite(globalLowStockThresholdRaw) && globalLowStockThresholdRaw >= 1
        ? Math.round(globalLowStockThresholdRaw)
        : null;
      const inventory = await Inventory.find()
        .populate({ path: 'product', select: 'name images isActive brand supplier mcgBarcode mcgItemId', populate: { path: 'brand', select: 'name' } })
        .populate({ path: 'attributesSnapshot.attribute', select: 'name' })
        .populate({ path: 'attributesSnapshot.value', select: 'value' })
        .sort({ 'product.name': 1, size: 1, color: 1 });
      // Hide rows for products that are soft-deactivated
      return inventory
        .filter(row => row?.product && row.product.isActive !== false)
        .map((row) => {
          const effectiveThreshold = globalLowStockThreshold ?? row.lowStockThreshold;
          row.lowStockThreshold = effectiveThreshold;
          row.status = computeInventoryStatus(row.quantity, effectiveThreshold);
          return row;
        });
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error fetching inventory');
    }
  }

  // Paginated/filtered inventory query for admin UI
  async queryInventory({ page = 1, limit = 50, search = '', status = '', location = '', sort = '' } = {}) {
    try {
      const settings = await Settings.findOne().select('inventory.lowStockThreshold').lean();
      const globalLowStockThresholdRaw = Number(settings?.inventory?.lowStockThreshold);
      const globalLowStockThreshold = Number.isFinite(globalLowStockThresholdRaw) && globalLowStockThresholdRaw >= 1
        ? Math.round(globalLowStockThresholdRaw)
        : null;
      const match = {};
      if (location) match.location = location;

      const sortMap = {
        'lastUpdated:desc': { lastUpdated: -1 },
        'lastUpdated:asc': { lastUpdated: 1 },
        'quantity:desc': { quantity: -1 },
        'quantity:asc': { quantity: 1 },
        'productName:asc': { 'product.name': 1 },
        'productName:desc': { 'product.name': -1 },
        'updatedAt:desc': { updatedAt: -1 },
        'updatedAt:asc': { updatedAt: 1 }
      };
      const sortKey = sort && sortMap[sort] ? sort : 'lastUpdated:desc';
      const sortStage = sortMap[sortKey];

      const regex = search ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;

      const pipeline = [
        { $match: match },
        {
          $addFields: {
            computedStatus: {
              $switch: {
                branches: [
                  { case: { $lte: ['$quantity', 0] }, then: 'out_of_stock' },
                  {
                    case: {
                      $lte: [
                        '$quantity',
                        globalLowStockThreshold != null
                          ? globalLowStockThreshold
                          : { $ifNull: ['$lowStockThreshold', 5] }
                      ]
                    },
                    then: 'low_stock'
                  }
                ],
                default: 'in_stock'
              }
            }
          }
        },
        // Join product to search by name and filter inactive products out
        { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'product' } },
        { $unwind: '$product' },
        { $match: { 'product.isActive': { $ne: false } } },
      ];

      if (status) {
        pipeline.push({ $match: { computedStatus: status } });
      }

      if (regex) {
        pipeline.push({
          $match: {
            $or: [
              { 'product.name': { $regex: regex } },
              { size: { $regex: regex } },
              { color: { $regex: regex } },
              { location: { $regex: regex } },
              // Quick text search on attributesSnapshot.textValue if present
              { 'attributesSnapshot.textValue': { $regex: regex } }
            ]
          }
        });
      }

      pipeline.push(
        { $sort: sortStage },
        {
          $facet: {
            items: [
              { $skip: (Math.max(1, page) - 1) * Math.max(1, limit) },
              { $limit: Math.max(1, limit) },
              // Keep product minimal to reduce payload
              { $project: {
                  _id: 1,
                  product: {
                    _id: '$product._id',
                    name: '$product.name',
                    images: '$product.images',
                    mcgBarcode: '$product.mcgBarcode',
                    mcgItemId: '$product.mcgItemId'
                  },
                  variantId: 1,
                  size: 1,
                  color: 1,
                  quantity: 1,
                  lowStockThreshold: globalLowStockThreshold != null ? globalLowStockThreshold : '$lowStockThreshold',
                  warehouse: 1,
                  location: 1,
                  status: '$computedStatus',
                  attributesSnapshot: 1,
                  lastUpdated: 1,
                  createdAt: 1,
                  updatedAt: 1
                }
              }
            ],
            total: [ { $count: 'count' } ]
          }
        }
      );

      const [result] = await Inventory.aggregate(pipeline).allowDiskUse(true);
      const items = Array.isArray(result?.items) ? result.items : [];
      const total = Array.isArray(result?.total) && result.total[0]?.count ? result.total[0].count : 0;
      const pageSize = Math.max(1, limit);
      const totalPages = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
      return { items, total, page: Math.max(1, page), pageSize, totalPages };
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error fetching inventory (paged)');
    }
  }

  async getProductInventory(productId) {
    try {
      const inventory = await Inventory.find({ product: productId })
        .populate({ path: 'product', select: 'name images brand supplier', populate: { path: 'brand', select: 'name' } })
        .populate({ path: 'attributesSnapshot.attribute', select: 'name' })
        .populate({ path: 'attributesSnapshot.value', select: 'value' })
        .sort('size color');
      return inventory;
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error fetching product inventory');
    }
  }

  async updateInventory(id, quantity, userId) {
    try {
      // Get the previous inventory to compare quantity
      const prevInventory = await Inventory.findById(id);
      if (!prevInventory) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Inventory record not found');
      }

      const status = computeInventoryStatus(quantity, prevInventory.lowStockThreshold);

      const inventory = await Inventory.findByIdAndUpdate(
        id,
        { quantity, status, lastUpdated: new Date() },
        { new: true, runValidators: true }
      ).populate('product', 'name');

      // Update product total stock
      await this.#updateProductStock(inventory.product._id);

      // Check for low stock alerts
      await this.#checkLowStockAlert(inventory);

      // Determine type for history: 'increase' or 'decrease'
      let type = 'increase';
      if (typeof prevInventory.quantity === 'number' && typeof quantity === 'number') {
        type = quantity > prevInventory.quantity ? 'increase' : 'decrease';
      }

      // Create history record
      const historyData = {
        product: inventory.product._id,
        type,
        quantity,
        reason: 'Manual update',
        user: userId
      };
      console.log('About to create InventoryHistory with:', historyData);
      await this.#createHistoryRecord(historyData);
      // Push absolute quantity for the affected SKU to MCG (Uplîcali)
      try {
        await this.#pushMcgForSkus([{
          product: inventory.product._id,
          variantId: inventory.variantId,
          size: inventory.size,
          color: inventory.color
        }]);
      } catch {}
      return inventory;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  async addInventory(data, userId) {
    try {
      // Validate required fields
      if (!data.product) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Product is required');
      }
      // Allow either variantId OR size+color combo
      const usingVariant = !!data.variantId;
      if (!usingVariant) {
        if (!data.size) throw new ApiError(StatusCodes.BAD_REQUEST, 'Size is required');
        if (!data.color) throw new ApiError(StatusCodes.BAD_REQUEST, 'Color is required');
      }
      // Validate identifiers shape early for better messages
      const isObjectId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
      if (!isObjectId(String(data.product))) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid product id');
      }
      if (usingVariant && !isObjectId(String(data.variantId))) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid variant id');
      }
      // Resolve warehouse: if not provided and there is no multi-warehouse setup, default to Main (create if needed)
      if (!data.warehouse) {
        try {
          let warehouses = await Warehouse.find({});
          if (!warehouses || warehouses.length === 0) {
            const created = await Warehouse.findOneAndUpdate(
              { name: 'Main Warehouse' },
              { $setOnInsert: { name: 'Main Warehouse' } },
              { new: true, upsert: true }
            );
            data.warehouse = created?._id;
          } else if (warehouses.length === 1) {
            data.warehouse = warehouses[0]._id;
          } else {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Warehouse is required when multiple warehouses exist');
          }
        } catch (e) {
          if (!(data.warehouse)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Warehouse is required');
          }
        }
      }
      if (!isObjectId(String(data.warehouse))) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid warehouse id');
      }
      if (data.quantity === undefined || data.quantity === null || data.quantity < 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Valid quantity is required');
      }

      // Check if inventory item already exists for this product/size/color combination
      const existingInventory = await Inventory.findOne(
        usingVariant
          ? { product: data.product, variantId: data.variantId, warehouse: data.warehouse }
          : { product: data.product, size: data.size, color: data.color, warehouse: data.warehouse }
      );

      if (existingInventory) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 
          usingVariant
            ? 'Inventory already exists for this product variant in this warehouse. Please update the existing inventory instead.'
            : `Inventory already exists for this product, size (${data.size}), and color (${data.color}) combination in this warehouse. Please update the existing inventory instead.`);
      }

      // If variant path, optionally attach attribute snapshot for quick reference
      let attributesSnapshot = undefined;
      if (usingVariant) {
        const prod = await Product.findById(data.product).select('variants');
        const v = prod?.variants?.id?.(data.variantId);
        if (v && Array.isArray(v.attributes)) attributesSnapshot = v.attributes;
      }

      const inventory = new Inventory({
        product: data.product,
        variantId: data.variantId,
        size: usingVariant ? undefined : data.size,
        color: usingVariant ? undefined : data.color,
        quantity: data.quantity,
        warehouse: data.warehouse,
        location: data.location,
        lowStockThreshold: data.lowStockThreshold ?? 5,
        attributesSnapshot
      });
      const savedInventory = await inventory.save();
      
      // Update product total stock
      await this.#updateProductStock(savedInventory.product);

      // Create history record
      await this.#createHistoryRecord({
        product: savedInventory.product,
        type: 'increase',
        quantity: savedInventory.quantity,
        reason: 'Initial stock',
        user: userId
      });
      // Push absolute quantity for the affected SKU to MCG (Uplîcali)
      try {
        await this.#pushMcgForSkus([{
          product: savedInventory.product,
          variantId: savedInventory.variantId,
          size: savedInventory.size,
          color: savedInventory.color
        }]);
      } catch {}
      return savedInventory;
    } catch (error) {
      // If it's already an ApiError, just re-throw it
      if (error instanceof ApiError) {
        throw error;
      }

      // Handle MongoDB validation errors
      if (error.name === 'ValidationError') {
        const errorMessages = Object.values(error.errors).map(err => err.message);
        throw new ApiError(StatusCodes.BAD_REQUEST, `Validation error: ${errorMessages.join(', ')}`);
      }

      // Handle MongoDB duplicate key errors
      if (error.code === 11000) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 
          'Inventory already exists for this product, size, and color combination. Please update the existing inventory instead.');
      }

      // Handle other errors
      console.error('Error adding inventory:', error);
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, error?.message || 'Internal server error while adding inventory');
    }
  }

  async getLowStockItems() {
    try {
      return await Inventory.find({ status: 'low_stock' })
        .populate('product', 'name images')
        .sort('quantity');
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error fetching low stock items');
    }
  }

  async bulkUpdateInventory(items, userId) {
    try {
      const skus = [];
      const updates = items.map(async (item) => {
        const previous = await Inventory.findById(item._id).select('lowStockThreshold');
        if (!previous) return;
        const status = computeInventoryStatus(item.quantity, previous.lowStockThreshold);
        const inventory = await Inventory.findByIdAndUpdate(
          item._id,
          { quantity: item.quantity, status, lastUpdated: new Date() },
          { new: true }
        ).populate('product', 'name');

        if (inventory) {
          await this.#updateProductStock(inventory.product);
          await this.#checkLowStockAlert(inventory);
          await this.#createHistoryRecord({
            product: inventory.product,
            type: 'update',
            quantity: item.quantity,
            reason: 'Bulk update',
            user: userId
          });
          skus.push({
            product: inventory.product._id,
            variantId: inventory.variantId,
            size: inventory.size,
            color: inventory.color
          });
        }
      });

      await Promise.all(updates);
      // Push absolute quantities for all touched SKUs to MCG (Uplîcali)
      try { await this.#pushMcgForSkus(skus); } catch {}
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error performing bulk update');
    }
  }

  async #checkLowStockAlert(inventory) {
    try {
      const lowStockThreshold = 10; // Default threshold
      const criticalStockThreshold = 5; // Critical threshold
      
      if (inventory.quantity <= 0) {
        // Out of stock alert
        realTimeEventService.emitInventoryAlert({
          message: `Out of stock: ${inventory.product.name} (${inventory.size}, ${inventory.color})`,
          severity: 'critical',
          productId: inventory.product._id.toString(),
          currentStock: inventory.quantity
        });
      } else if (inventory.quantity <= criticalStockThreshold) {
        // Critical low stock alert
        realTimeEventService.emitInventoryAlert({
          message: `Critical low stock: ${inventory.product.name} (${inventory.size}, ${inventory.color}) - Only ${inventory.quantity} remaining`,
          severity: 'high',
          productId: inventory.product._id.toString(),
          currentStock: inventory.quantity
        });
      } else if (inventory.quantity <= lowStockThreshold) {
        // Low stock alert
        realTimeEventService.emitInventoryAlert({
          message: `Low stock alert: ${inventory.product.name} (${inventory.size}, ${inventory.color}) running low - ${inventory.quantity} remaining`,
          severity: 'medium',
          productId: inventory.product._id.toString(),
          currentStock: inventory.quantity
        });
      }
    } catch (error) {
      console.error('Error checking low stock alert:', error);
    }
  }

  async #updateProductStock(productId) {
    try {
      const inventoryItems = await Inventory.find({ product: productId });
      const totalStock = inventoryItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

      // Update variant stocks by summing inventory by variantId
      const perVariant = new Map();
      for (const item of inventoryItems) {
        if (item.variantId) {
          const key = String(item.variantId);
          perVariant.set(key, (perVariant.get(key) || 0) + (Number(item.quantity) || 0));
        }
      }
      // Read product variants lean to avoid creating a Mongoose document (and its validations)
      const productLean = await Product.findById(productId).select('variants').lean();
      if (productLean && Array.isArray(productLean.variants) && productLean.variants.length) {
        // Prepare bulk updates to set each variant's stock explicitly (missing entries -> 0)
        const bulkOps = [];
        let sumVariants = 0;
        for (const v of productLean.variants) {
          const vid = String(v._id);
          const qty = perVariant.get(vid) || 0;
          sumVariants += (Number(qty) || 0);
          bulkOps.push({
            updateOne: {
              filter: { _id: productId, 'variants._id': v._id },
              update: { $set: { 'variants.$.stock': qty } },
              upsert: false
            }
          });
        }
        if (bulkOps.length) {
          try { await Product.bulkWrite(bulkOps, { ordered: false }); } catch (e) { /* tolerate partial failures */ }
        }
        // Update product total stock as sum of variant stocks
        await Product.updateOne({ _id: productId }, { $set: { stock: sumVariants } }, { runValidators: false });
      } else {
        // No variants array: use total inventory sum directly
        await Product.updateOne({ _id: productId }, { $set: { stock: totalStock } }, { runValidators: false });
      }
      try {
        realTimeEventService.emitInventoryChanged({ productId: String(productId), action: 'updated' });
      } catch {}
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error updating product stock');
    }
  }

  async #createHistoryRecord(data) {
    try {
      console.log('Creating InventoryHistory record with data:', data);
      await new InventoryHistory(data).save();
    } catch (error) {
      console.error('Error in #createHistoryRecord:', error);
      console.error('Data that caused error:', data);
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error creating history record');
    }
  }

  // Internal: Push absolute quantities for a list of SKUs to MCG (supports Uplîcali; legacy skipped or best-effort)
  async #pushMcgForSkus(skus, session = null) {
    try {
      if (!Array.isArray(skus) || !skus.length) return;
      const settings = await Settings.findOne().sort({ updatedAt: -1 }).lean();
      const mcgCfg = settings?.mcg || {};
      const hasExplicitPushFlag = Object.prototype.hasOwnProperty.call(mcgCfg, 'pushStockBackEnabled');
      const envPushFlag = String(process.env.MCG_PUSH_STOCK_BACK || '').toLowerCase();
      const envPushEnabled = envPushFlag === '1' || envPushFlag === 'true';
      const pushToMcg = hasExplicitPushFlag
        ? !!mcgCfg.pushStockBackEnabled
        : (!!mcgCfg.enabled || envPushEnabled);
      if (!pushToMcg) return;
      const flavor = String(mcgCfg.apiFlavor || '').toLowerCase();

  const mcgAbsMap = new Map();
      const prodCache = new Map();

      for (const sku of skus) {
        const productId = sku.product;
        if (!productId) continue;
        let prodDoc = prodCache.get(String(productId));
        if (!prodDoc) {
          prodDoc = await Product.findById(productId).select('mcgBarcode mcgItemId variants').lean();
          prodCache.set(String(productId), prodDoc || {});
        }
        // Prefer variant barcode if variant specified
        let itemCode = '';
        if (sku.variantId && Array.isArray(prodDoc?.variants)) {
          const vv = prodDoc.variants.find(v => String(v?._id) === String(sku.variantId));
          if (vv && vv.barcode) itemCode = String(vv.barcode).trim();
        }
        if (!itemCode) itemCode = String(prodDoc?.mcgBarcode || '').trim();
        if (!itemCode) itemCode = String(sku?.sku || '').trim();
        const itemIdFallback = String(prodDoc?.mcgItemId || '').trim();
        const preferItemId = flavor === 'uplicali' && !!(settings?.mcg?.preferItemId) && !!itemIdFallback;
        if (preferItemId) itemCode = '';

        // Compute absolute final quantity for this SKU across inventories
        const filter = sku.variantId
          ? { product: productId, variantId: sku.variantId }
          : { product: productId, size: (sku.size && String(sku.size).trim()) ? sku.size : 'Default', color: (sku.color && String(sku.color).trim()) ? sku.color : 'Default' };
        const finalRowsQuery = Inventory.find(filter).select('quantity').lean();
        const finalRows = session ? await finalRowsQuery.session(session) : await finalRowsQuery;
        const totalQty = finalRows.reduce((s,x)=> s + (Number(x.quantity)||0), 0);
        const clamped = Math.max(0, totalQty);

        if (itemCode) {
          mcgAbsMap.set(`code:${itemCode}`, clamped);
        } else if (itemIdFallback && flavor === 'uplicali') {
          mcgAbsMap.set(`id:${itemIdFallback}`, clamped);
        }
      }

      if (!mcgAbsMap.size) return;
      const group = Number.isFinite(Number(mcgCfg?.group)) ? Number(mcgCfg.group) : undefined;
      const itemsForSet = Array.from(mcgAbsMap.entries()).map(([key, qty]) => {
        const [kind, val] = String(key).split(':', 2);
        return kind === 'code' ? { item_code: val, item_inventory: qty } : { item_id: val, item_inventory: qty };
      });
      const sample = itemsForSet[0]?.item_code || itemsForSet[0]?.item_id || 'n/a';
      try { console.log('[mcg][push-back] flavor=%s items=%d sample=%s', flavor || 'legacy', itemsForSet.length, sample); } catch {}
      const res = await setItemsList(itemsForSet, group);
      try {
        const summary = (res && typeof res === 'object') ? JSON.stringify(res).slice(0,180) : String(res);
        const first = itemsForSet[0] || {};
        const usedKey = first.item_code ? 'item_code' : (first.item_id ? 'item_id' : 'unknown');
        console.log('[mcg][push-back] set_items_list ok (count=%d) using=%s resp=%s', itemsForSet.length, usedKey, summary);
      } catch {}
    } catch (e) {
      try { console.warn('[mcg][push-back] batch absolute failed:', e?.message || e); } catch {}
    }
  }

  // Public: Push current absolute stock for all SKUs of a product to MCG (if enabled)
  async pushMcgForEntireProduct(productId, session = null) {
    try {
      if (!productId) return;
      // Collect all inventory rows for this product (variant or size/color based)
      const rowsQuery = Inventory.find({ product: productId }).select('variantId size color').lean();
      const rows = session ? await rowsQuery.session(session) : await rowsQuery;
      const skus = rows.map(r => ({
        product: productId,
        variantId: r.variantId,
        size: r.size,
        color: r.color
      }));
      // If no inventory rows exist, still push a default SKU so external system can be zeroed
      if (!skus.length) {
        skus.push({ product: productId, size: 'Default', color: 'Default' });
      }
      await this.#pushMcgForSkus(skus, session);
    } catch (e) {
      try { console.warn('[inventory][mcg] push whole product failed:', e?.message || e); } catch {}
    }
  }
}

export const inventoryService = new InventoryService();