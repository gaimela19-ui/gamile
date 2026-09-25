import FlashSale from '../models/FlashSale.js';
import Product from '../models/Product.js';
import { getStoreCurrency } from '../services/storeCurrencyService.js';
import { autoNotifyFlashSale } from '../services/flashSaleNotify.js';
import ScheduledPush from '../models/ScheduledPush.js';
import { deepseekTranslate, isDeepseekConfigured } from '../services/translate/deepseek.js';

// Helper: compute flash price from percent with basic guards
function computePercentPrice(base, pct) {
  if (typeof base !== 'number' || !isFinite(base) || base <= 0) return 0;
  if (typeof pct !== 'number' || !isFinite(pct) || pct <= 0 || pct >= 100) return 0;
  const v = base * (1 - pct / 100);
  const r = Math.round(v * 100) / 100;
  if (r <= 0) return 0;
  if (r >= base) return Math.max(0, Math.round((base - 0.01) * 100) / 100);
  return r;
}

// Expand selected categories to concrete flash sale items using percentage pricing
async function expandCategoriesToItems(categoryIds = [], discountPercent) {
  if (!Array.isArray(categoryIds) || categoryIds.length === 0) return [];
  // Fetch minimal fields
  const products = await Product.find({
    $or: [
      { category: { $in: categoryIds } },
      { categories: { $in: categoryIds } }
    ]
  }).select('_id price').lean();
  const items = products.map((p, idx) => ({
    product: p._id,
    flashPrice: computePercentPrice(p.price || 0, discountPercent),
    quantityLimit: 0,
    order: idx
  })).filter(it => it.flashPrice > 0);
  return items;
}

// Expand selected brands to concrete flash sale items using percentage pricing
async function expandBrandsToItems(brandIds = [], discountPercent) {
  if (!Array.isArray(brandIds) || brandIds.length === 0) return [];
  const products = await Product.find({
    brand: { $in: brandIds }
  }).select('_id price').lean();
  const items = products.map((p, idx) => ({
    product: p._id,
    flashPrice: computePercentPrice(p.price || 0, discountPercent),
    quantityLimit: 0,
    order: idx
  })).filter(it => it.flashPrice > 0);
  return items;
}

// Build public response items for category-targeted sales, hydrating product fields directly
async function buildPublicItemsForCategories(categoryIds = [], discountPercent) {
  if (!Array.isArray(categoryIds) || categoryIds.length === 0) return [];
  const prods = await Product.find({
    $or: [
      { category: { $in: categoryIds } },
      { categories: { $in: categoryIds } }
    ]
  }).select('name images colors attributeImages price originalPrice').lean();
  return prods
    .map((p, idx) => ({
      product: p,
      flashPrice: computePercentPrice(p.price || 0, discountPercent),
      quantityLimit: 0,
      order: idx,
    }))
    .filter(it => it.flashPrice > 0);
}

// Build public response items for brand-targeted sales, hydrating product fields directly
async function buildPublicItemsForBrands(brandIds = [], discountPercent) {
  if (!Array.isArray(brandIds) || brandIds.length === 0) return [];
  const prods = await Product.find({
    brand: { $in: brandIds }
  }).select('name images colors attributeImages price originalPrice').lean();
  return prods
    .map((p, idx) => ({
      product: p,
      flashPrice: computePercentPrice(p.price || 0, discountPercent),
      quantityLimit: 0,
      order: idx,
    }))
    .filter(it => it.flashPrice > 0);
}

export const listAdmin = async (req, res) => {
  try {
    const sales = await FlashSale.find()
      .sort({ startDate: -1 })
      .populate({
        path: 'items.product',
        // Provide minimal fields needed by admin UI to render base price and thumbnail
        select: 'name images colors attributeImages price originalPrice'
      })
      .lean();
    try { const c = await getStoreCurrency(); res.set('X-Store-Currency', c); } catch {}
    res.json(sales);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load flash sales' });
  }
};

export const create = async (req, res) => {
  try {
    const body = req.body || {};
    let payload = { ...body };
    // When targeting categories, materialize items at creation time (percent mode only)
    if (payload.targetType === 'categories') {
      if (payload.pricingMode !== 'percent') {
        return res.status(400).json({ message: 'Category-based flash sale requires percentage pricing mode' });
      }
      const pct = Number(payload.discountPercent);
      if (!(pct > 0 && pct < 100)) {
        return res.status(400).json({ message: 'Provide a valid discountPercent (0-100) for category-based flash sale' });
      }
      const items = await expandCategoriesToItems(payload.categoryIds || [], pct);
      payload.items = items;
    }
    // When targeting brands, materialize items at creation time (percent mode only)
    if (payload.targetType === 'brands') {
      if (payload.pricingMode !== 'percent') {
        return res.status(400).json({ message: 'Brand-based flash sale requires percentage pricing mode' });
      }
      const pct = Number(payload.discountPercent);
      if (!(pct > 0 && pct < 100)) {
        return res.status(400).json({ message: 'Provide a valid discountPercent (0-100) for brand-based flash sale' });
      }
      const items = await expandBrandsToItems(payload.brandIds || [], pct);
      payload.items = items;
    }
    const sale = await FlashSale.create(payload);
    // Auto push notify: if active now -> send immediately; if starts in future -> schedule at startDate
    try {
      const now = new Date();
      if (sale.active && new Date(sale.startDate) <= now && new Date(sale.endDate) > now) {
        await autoNotifyFlashSale(sale, req.user?._id);
      } else if (sale.active && new Date(sale.startDate) > now) {
        // Schedule push at startDate
        const title = String((sale.name || 'Flash Sale') + ' ⚡⚡').toUpperCase().slice(0,80);
        const body = sale.pricingMode === 'percent' && sale.discountPercent
          ? `İndirim başlıyor! %{${Number(sale.discountPercent).toFixed(0)}} fırsatlar seni bekliyor 🛒✨`
          : 'Büyük indirimler başlıyor! 🛒✨';
        await ScheduledPush.create({
          title,
          body,
          data: { type: 'flash-sale', saleId: String(sale._id), deepLink: `/flash-sale/${sale._id}` },
          audience: { type: 'all' },
          scheduleAt: new Date(sale.startDate),
          createdBy: req.user?._id
        });
      }
    } catch {}
    res.status(201).json(sale);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to create' });
  }
};

export const update = async (req, res) => {
  try {
    const body = req.body || {};
    let payload = { ...body };
    if (payload.targetType === 'categories') {
      if (payload.pricingMode !== 'percent') {
        return res.status(400).json({ message: 'Category-based flash sale requires percentage pricing mode' });
      }
      const pct = Number(payload.discountPercent);
      if (!(pct > 0 && pct < 100)) {
        return res.status(400).json({ message: 'Provide a valid discountPercent (0-100) for category-based flash sale' });
      }
      const items = await expandCategoriesToItems(payload.categoryIds || [], pct);
      payload.items = items;
    }
    if (payload.targetType === 'brands') {
      if (payload.pricingMode !== 'percent') {
        return res.status(400).json({ message: 'Brand-based flash sale requires percentage pricing mode' });
      }
      const pct = Number(payload.discountPercent);
      if (!(pct > 0 && pct < 100)) {
        return res.status(400).json({ message: 'Provide a valid discountPercent (0-100) for brand-based flash sale' });
      }
      const items = await expandBrandsToItems(payload.brandIds || [], pct);
      payload.items = items;
    }
    const updated = await FlashSale.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ message: 'Not found' });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to update' });
  }
};

export const remove = async (req, res) => {
  try {
    const doc = await FlashSale.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Failed to delete' });
  }
};

export const publicActiveList = async (req, res) => {
  try {
  const reqLang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
  const allowAutoTranslate = isDeepseekConfigured() && String(req.query.autoTranslate || 'false').toLowerCase() === 'true';
  const metaOnly = String(req.query.metaOnly || 'false').toLowerCase() === 'true';
    const now = new Date();
    let sales = await FlashSale.find({ active: true, startDate: { $lte: now }, endDate: { $gte: now } })
      .sort({ startDate: 1 })
      .lean();

    // If only metadata is requested, do not populate heavy items list
    if (metaOnly) {
      const outMeta = await Promise.all(sales.map(async (s) => {
        let itemsCount = Array.isArray(s.items) ? s.items.length : 0;
        if (s.targetType === 'categories') {
          try {
            itemsCount = await Product.countDocuments({
              $or: [
                { category: { $in: s.categoryIds || [] } },
                { categories: { $in: s.categoryIds || [] } }
              ]
            });
          } catch {}
        } else if (s.targetType === 'brands') {
          try {
            itemsCount = await Product.countDocuments({
              brand: { $in: s.brandIds || [] }
            });
          } catch {}
        }
        return {
          _id: s._id,
          name: s.name,
          startDate: s.startDate,
          endDate: s.endDate,
          pricingMode: s.pricingMode || 'fixed',
          discountPercent: s.discountPercent,
          itemsCount,
        };
      }));
      try { const c = await getStoreCurrency(); res.set('X-Store-Currency', c); } catch {}
      return res.json(outMeta);
    }

    // Otherwise return the full (legacy) payload with items populated
    sales = await FlashSale.find({ active: true, startDate: { $lte: now }, endDate: { $gte: now } })
      .sort({ startDate: 1 })
      .populate({
        path: 'items.product',
        select: 'name images colors attributeImages price originalPrice',
      })
      .lean();

    // Localize embedded products (name) if lang provided; persist missing translations when DeepSeek configured
    const out = await Promise.all(sales.map(async (s) => {
      // If this sale targets categories/brands, compute items dynamically to ensure store reflects latest products/prices
      let baseItems = Array.isArray(s.items) ? s.items : [];
      if (s.targetType === 'categories') {
        const pct = Number(s.discountPercent);
        if (pct > 0 && pct < 100) {
          try {
            baseItems = await buildPublicItemsForCategories(s.categoryIds || [], pct);
          } catch {}
        } else {
          baseItems = [];
        }
      } else if (s.targetType === 'brands') {
        const pct = Number(s.discountPercent);
        if (pct > 0 && pct < 100) {
          try {
            baseItems = await buildPublicItemsForBrands(s.brandIds || [], pct);
          } catch {}
        } else {
          baseItems = [];
        }
      }

      const items = await Promise.all((baseItems || []).map(async (it) => {
        const p = it.product;
        if (p && reqLang) {
          try {
            const pDoc = await Product.findById(p._id).select('name description name_i18n description_i18n');
            if (pDoc) {
              const nm = (pDoc.name_i18n && (typeof pDoc.name_i18n.get === 'function' ? pDoc.name_i18n.get(reqLang) : pDoc.name_i18n[reqLang])) || null;
              if (nm) {
                p.name = nm;
              } else if (allowAutoTranslate && typeof pDoc.name === 'string' && pDoc.name.trim()) {
                try {
                  const tr = await deepseekTranslate(pDoc.name, 'auto', reqLang);
                  const map = new Map(pDoc.name_i18n || []);
                  map.set(reqLang, tr);
                  pDoc.name_i18n = map;
                  p.name = tr;
                  try { await pDoc.save(); } catch {}
                } catch {}
              }
            }
          } catch {}
        }
        return {
          product: p,
          flashPrice: it.flashPrice,
          quantityLimit: it.quantityLimit,
          order: it.order
        };
      }));

      return {
        _id: s._id,
        name: s.name,
        startDate: s.startDate,
        endDate: s.endDate,
        pricingMode: s.pricingMode || 'fixed',
        discountPercent: s.discountPercent,
        items
      };
    }));
    try { const c = await getStoreCurrency(); res.set('X-Store-Currency', c); } catch {}
    res.json(out);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load flash sales' });
  }
};

// Public: get a specific active flash sale by id (only returns if currently active)
export const publicGetById = async (req, res) => {
  try {
  const reqLang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
  const allowAutoTranslate = isDeepseekConfigured() && String(req.query.autoTranslate || 'false').toLowerCase() === 'true';
    const { id } = req.params;
    const now = new Date();
    const s = await FlashSale.findOne({ _id: id, active: true, startDate: { $lte: now }, endDate: { $gte: now } })
      .populate({
        path: 'items.product',
          select: 'name images colors attributeImages price originalPrice',
      })
      .lean();
    if (!s) return res.status(404).json({ message: 'Flash sale not found or not active' });
    // Compute base items (dynamic when targeting categories/brands)
    let baseItems = Array.isArray(s.items) ? s.items : [];
    if (s.targetType === 'categories') {
      const pct = Number(s.discountPercent);
      if (pct > 0 && pct < 100) {
        try {
          baseItems = await buildPublicItemsForCategories(s.categoryIds || [], pct);
        } catch {}
      } else {
        baseItems = [];
      }
    } else if (s.targetType === 'brands') {
      const pct = Number(s.discountPercent);
      if (pct > 0 && pct < 100) {
        try {
          baseItems = await buildPublicItemsForBrands(s.brandIds || [], pct);
        } catch {}
      } else {
        baseItems = [];
      }
    }

    const items = await Promise.all((baseItems || []).map(async (it) => {
      const p = it.product;
      if (p && reqLang) {
        try {
          const pDoc = await Product.findById(p._id).select('name description name_i18n description_i18n');
          if (pDoc) {
            const nm = (pDoc.name_i18n && (typeof pDoc.name_i18n.get === 'function' ? pDoc.name_i18n.get(reqLang) : pDoc.name_i18n[reqLang])) || null;
            if (nm) {
              p.name = nm;
            } else if (allowAutoTranslate && typeof pDoc.name === 'string' && pDoc.name.trim()) {
              try {
                const tr = await deepseekTranslate(pDoc.name, 'auto', reqLang);
                const map = new Map(pDoc.name_i18n || []);
                map.set(reqLang, tr);
                pDoc.name_i18n = map;
                p.name = tr;
                try { await pDoc.save(); } catch {}
              } catch {}
            }
          }
        } catch {}
      }
      return {
        product: p,
        flashPrice: it.flashPrice,
        quantityLimit: it.quantityLimit,
        order: it.order,
      };
    }));

    const out = {
      _id: s._id,
      name: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      pricingMode: s.pricingMode || 'fixed',
      discountPercent: s.discountPercent,
      items,
    };
    try { const c = await getStoreCurrency(); res.set('X-Store-Currency', c); } catch {}
    res.json(out);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load flash sale' });
  }
};

// Public: paginated items for a specific active flash sale
export const publicGetActiveItems = async (req, res) => {
  try {
    const reqLang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
    const allowAutoTranslate = isDeepseekConfigured() && String(req.query.autoTranslate || 'false').toLowerCase() === 'true';
    const slim = String(req.query.slim || 'true').toLowerCase() === 'true';
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(String(req.query.pageSize || '12'), 10) || 12));
    const skip = (page - 1) * pageSize;

    const { id } = req.params;
    const now = new Date();
    const s = await FlashSale.findOne({ _id: id, active: true, startDate: { $lte: now }, endDate: { $gte: now } })
      .lean();
    if (!s) return res.status(404).json({ message: 'Flash sale not found or not active' });

    // Determine total count and fetch the current page of items
    let totalItems = 0;
    let pageItems = [];
    const selectFields = slim
      ? 'name images price originalPrice' // lean payload for storefront card
      : 'name images colors attributeImages price originalPrice name_i18n';

    if (s.targetType === 'categories') {
      // Dynamic from categories: page directly on products query
      const query = {
        $or: [
          { category: { $in: s.categoryIds || [] } },
          { categories: { $in: s.categoryIds || [] } }
        ]
      };
      totalItems = await Product.countDocuments(query);
      const prods = await Product.find(query)
        .select(selectFields + ' name_i18n')
        .skip(skip)
        .limit(pageSize)
        .lean();
      pageItems = prods.map((p, idx) => ({
        product: p,
        flashPrice: computePercentPrice(p.price || 0, Number(s.discountPercent)),
        quantityLimit: 0,
        order: skip + idx,
      })).filter(it => it.flashPrice > 0);
    } else if (s.targetType === 'brands') {
      // Dynamic from brands: page directly on products query
      const query = {
        brand: { $in: s.brandIds || [] }
      };
      totalItems = await Product.countDocuments(query);
      const prods = await Product.find(query)
        .select(selectFields + ' name_i18n')
        .skip(skip)
        .limit(pageSize)
        .lean();
      pageItems = prods.map((p, idx) => ({
        product: p,
        flashPrice: computePercentPrice(p.price || 0, Number(s.discountPercent)),
        quantityLimit: 0,
        order: skip + idx,
      })).filter(it => it.flashPrice > 0);
    } else {
      // Manual items array: slice then hydrate only the subset
      const baseItems = Array.isArray(s.items) ? s.items.slice().sort((a,b)=> (a.order||0)-(b.order||0)) : [];
      totalItems = baseItems.length;
      const slice = baseItems.slice(skip, skip + pageSize);
      const productIds = slice.map(it => it.product).filter(Boolean);
      const products = await Product.find({ _id: { $in: productIds } })
        .select(selectFields + ' name_i18n')
        .lean();
      const productById = new Map(products.map(p => [String(p._id), p]));
      pageItems = slice.map((it) => ({
        product: productById.get(String(it.product)) || null,
        flashPrice: it.flashPrice,
        quantityLimit: it.quantityLimit,
        order: it.order,
      })).filter(x => x.product);
    }

    // Localize names if possible
    if (reqLang) {
      for (const it of pageItems) {
        const p = it.product;
        if (p && p.name_i18n) {
          try {
            const nm = (typeof p.name_i18n.get === 'function' ? p.name_i18n.get(reqLang) : p.name_i18n[reqLang]) || null;
            if (nm) p.name = nm;
            else if (allowAutoTranslate && typeof p.name === 'string' && p.name.trim()) {
              try {
                const tr = await deepseekTranslate(p.name, 'auto', reqLang);
                // note: we don't persist here to keep endpoint fast
                p.name = tr;
              } catch {}
            }
          } catch {}
        }
        // Remove i18n data from payload if present to keep it slim
        if (p && p.name_i18n) delete p.name_i18n;
      }
    }

    try { const c = await getStoreCurrency(); res.set('X-Store-Currency', c); } catch {}
    return res.json({
      items: pageItems,
      totalItems,
      page,
      pageSize,
    });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load flash sale items' });
  }
};
