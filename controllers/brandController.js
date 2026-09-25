import asyncHandler from 'express-async-handler';
import Brand from '../models/Brand.js';
import { deepseekTranslate } from '../services/translate/deepseek.js';

function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export const listBrands = asyncHandler(async (req, res) => {
  const reqLang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
  // Only auto-translate when explicitly requested to keep default loads fast
  const allowAuto = (process.env.ALLOW_RUNTIME_PRODUCT_TRANSLATE === 'true') && String(req.query.autoTranslate || 'false').toLowerCase() === 'true';
  const brands = await Brand.find().sort({ order: 1, createdAt: 1 });
  if (reqLang) {
    for (const b of brands) {
      const nm = (b.name_i18n && typeof b.name_i18n.get === 'function') ? b.name_i18n.get(reqLang) : (b.name_i18n ? b.name_i18n[reqLang] : undefined);
      if (nm) b.name = nm; else if (allowAuto && b.name) {
        try { const tr = await deepseekTranslate(b.name, 'auto', reqLang); const map = new Map(b.name_i18n || []); map.set(reqLang, tr); b.name_i18n = map; b.name = tr; await b.save(); } catch {}
      }
      if (b.label) {
        const lbl = (b.label_i18n && typeof b.label_i18n.get === 'function') ? b.label_i18n.get(reqLang) : (b.label_i18n ? b.label_i18n[reqLang] : undefined);
        if (lbl) b.label = lbl; else if (allowAuto) {
          try { const trl = await deepseekTranslate(b.label, 'auto', reqLang); const mapl = new Map(b.label_i18n || []); mapl.set(reqLang, trl); b.label_i18n = mapl; b.label = trl; await b.save(); } catch {}
        }
      }
    }
  }
  res.json(brands);
});

export const listActiveBrands = asyncHandler(async (req, res) => {
  const reqLang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
  const allowAuto = (process.env.ALLOW_RUNTIME_PRODUCT_TRANSLATE === 'true') && String(req.query.autoTranslate || 'false').toLowerCase() === 'true';
  const brands = await Brand.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
  if (reqLang) {
    for (const b of brands) {
      const nm = (b.name_i18n && typeof b.name_i18n.get === 'function') ? b.name_i18n.get(reqLang) : (b.name_i18n ? b.name_i18n[reqLang] : undefined);
      if (nm) b.name = nm; else if (allowAuto && b.name) {
        try { const tr = await deepseekTranslate(b.name, 'auto', reqLang); const map = new Map(b.name_i18n || []); map.set(reqLang, tr); b.name_i18n = map; b.name = tr; await b.save(); } catch {}
      }
      if (b.label) {
        const lbl = (b.label_i18n && typeof b.label_i18n.get === 'function') ? b.label_i18n.get(reqLang) : (b.label_i18n ? b.label_i18n[reqLang] : undefined);
        if (lbl) b.label = lbl; else if (allowAuto) {
          try { const trl = await deepseekTranslate(b.label, 'auto', reqLang); const mapl = new Map(b.label_i18n || []); mapl.set(reqLang, trl); b.label_i18n = mapl; b.label = trl; await b.save(); } catch {}
        }
      }
    }
  }
  res.json(brands);
});

export const createBrand = asyncHandler(async (req, res) => {
  const { name, slug, label, labelImageUrl, imageUrl, linkUrl, isActive = true, order = 0 } = req.body || {};
  const normalizedSlug = slug ? String(slug).trim().toLowerCase() : (name ? slugify(name) : undefined);
  const brand = await Brand.create({ name, slug: normalizedSlug, label, labelImageUrl, imageUrl, linkUrl, isActive, order });
  res.status(201).json(brand);
});

export const updateBrand = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const brand = await Brand.findById(id);
  if (!brand) return res.status(404).json({ message: 'Brand not found' });
  const updatable = ['name', 'slug', 'label', 'labelImageUrl', 'imageUrl', 'linkUrl', 'isActive', 'order'];
  updatable.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) {
      const val = req.body[k];
      if (k === 'slug' && typeof val === 'string') brand[k] = val.trim().toLowerCase();
      else brand[k] = val;
    }
  });
  // If slug absent but name provided and brand has no slug yet, generate
  if (!('slug' in (req.body || {})) && typeof req.body?.name === 'string' && !brand.slug) {
    brand.slug = slugify(req.body.name);
  }
  await brand.save();
  res.json(brand);
});

export const deleteBrand = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const brand = await Brand.findById(id);
  if (!brand) return res.status(404).json({ message: 'Brand not found' });
  await brand.deleteOne();
  res.json({ success: true });
});

export const reorderBrands = asyncHandler(async (req, res) => {
  const { order } = req.body; // [{id, order}, ...]
  if (!Array.isArray(order)) return res.status(400).json({ message: 'Invalid order payload' });
  const ops = order.map((o) => ({ updateOne: { filter: { _id: o.id }, update: { $set: { order: o.order } } } }));
  if (ops.length) await Brand.bulkWrite(ops);
  const brands = await Brand.find().sort({ order: 1, createdAt: 1 });
  res.json(brands);
});

export const getBrandBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  if (!slug) return res.status(400).json({ message: 'Slug is required' });
  const reqLang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
  const allowAuto = (process.env.ALLOW_RUNTIME_PRODUCT_TRANSLATE === 'true') && String(req.query.autoTranslate || 'false').toLowerCase() === 'true';
  const brand = await Brand.findOne({ slug: String(slug).toLowerCase() });
  if (!brand) return res.status(404).json({ message: 'Brand not found' });
  const obj = brand.toObject();
  if (reqLang) {
    const nm = (brand.name_i18n && typeof brand.name_i18n.get === 'function') ? brand.name_i18n.get(reqLang) : (obj?.name_i18n ? obj.name_i18n[reqLang] : undefined);
    if (nm) obj.name = nm; else if (allowAuto && obj.name) {
      try { const tr = await deepseekTranslate(obj.name, 'auto', reqLang); const map = new Map(brand.name_i18n || []); map.set(reqLang, tr); brand.name_i18n = map; obj.name = tr; await brand.save(); } catch {}
    }
    if (obj.label) {
      const lbl = (brand.label_i18n && typeof brand.label_i18n.get === 'function') ? brand.label_i18n.get(reqLang) : (obj?.label_i18n ? obj.label_i18n[reqLang] : undefined);
      if (lbl) obj.label = lbl; else if (allowAuto) {
        try { const trl = await deepseekTranslate(obj.label, 'auto', reqLang); const mapl = new Map(brand.label_i18n || []); mapl.set(reqLang, trl); brand.label_i18n = mapl; obj.label = trl; await brand.save(); } catch {}
      }
    }
  }
  res.json(obj);
});
