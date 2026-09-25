import mongoose from 'mongoose';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import { deepseekTranslate, deepseekTranslateBatch, isDeepseekConfigured } from '../services/translate/deepseek.js';

// Normalize language to primary subtag we store in i18n maps
function normalizeLang(lang) {
  if (!lang || typeof lang !== 'string') return '';
  let l = String(lang).trim().toLowerCase();
  const dash = l.indexOf('-');
  if (dash > 0) l = l.slice(0, dash);
  if (l === 'iw') l = 'he';
  if (!['ar','he','en'].includes(l)) return '';
  return l;
}

function normalizeRouteValue(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

// Helper: localize a category object in-place for a given language
function localizeCategoryInPlace(cat, lang) {
  const nm = cat?.name_i18n?.[lang] ?? cat?.name_i18n?.get?.(lang);
  const desc = cat?.description_i18n?.[lang] ?? cat?.description_i18n?.get?.(lang);
  if (nm) cat.name = nm;
  if (desc) cat.description = desc;
}

// Helper: resolve category either by Mongo ObjectId or slug/path token
async function findCategoryByIdentifier(identifier) {
  const token = typeof identifier === 'string' ? identifier.trim() : '';
  if (!token) return null;

  let category = null;
  if (mongoose.Types.ObjectId.isValid(token)) {
    category = await Category.findById(token);
  }

  if (!category) {
    const normalized = token.toLowerCase();
    // slug is lowercase; path is derived from slug segments so also lowercase
    category = await Category.findOne({ $or: [ { slug: normalized }, { path: normalized } ] });
  }
  return category;
}

// Helper: batch translate and persist missing category name/description for a target lang
async function translateAndPersistCategories(categories, lang, allowAuto) {
  if (!lang) return;
  // First, apply existing localized values without any external calls
  for (const c of categories) localizeCategoryInPlace(c, lang);
  if (!allowAuto) return; // don't auto-translate if disabled

  const t0 = Date.now();
  const NAME_CTX = 'Category.name';
  const DESC_CTX = 'Category.description';

  // Collect unique texts that are still missing
  const needNameMap = new Map(); // text -> array of category indices
  const needDescMap = new Map();
  categories.forEach((c, idx) => {
    const hasName = !!(c?.name_i18n?.[lang]);
    const hasDesc = !!(c?.description_i18n?.[lang]);
    if (!hasName && c?.name) {
      const key = String(c.name);
      const arr = needNameMap.get(key) || [];
      arr.push(idx);
      needNameMap.set(key, arr);
    }
    if (!hasDesc && c?.description) {
      const key = String(c.description);
      const arr = needDescMap.get(key) || [];
      arr.push(idx);
      needDescMap.set(key, arr);
    }
  });

  const ops = [];

  // Translate names
  if (needNameMap.size) {
    const items = Array.from(needNameMap.keys()).map(text => ({ id: text, text }));
    const results = await deepseekTranslateBatch(items, 'auto', lang, { contextKey: NAME_CTX });
    for (const r of results) {
      if (!r?.text) continue;
      const idxs = needNameMap.get(r.id) || [];
      for (const i of idxs) {
        categories[i].name = r.text; // reflect immediately in response
        // persist using dot-path for Map
        ops.push({
          updateOne: {
            filter: { _id: categories[i]._id },
            update: { $set: { [`name_i18n.${lang}`]: r.text } },
          }
        });
      }
    }
  }

  // Translate descriptions
  if (needDescMap.size) {
    const items = Array.from(needDescMap.keys()).map(text => ({ id: text, text }));
    const results = await deepseekTranslateBatch(items, 'auto', lang, { contextKey: DESC_CTX });
    for (const r of results) {
      if (!r?.text) continue;
      const idxs = needDescMap.get(r.id) || [];
      for (const i of idxs) {
        categories[i].description = r.text; // reflect immediately in response
        ops.push({
          updateOne: {
            filter: { _id: categories[i]._id },
            update: { $set: { [`description_i18n.${lang}`]: r.text } },
          }
        });
      }
    }
  }

  // Persist in one batch to avoid N queries
  if (ops.length) {
    try { await Category.bulkWrite(ops, { ordered: false }); } catch {}
  }

  if (process.env.LOG_TRANSLATION_TIMING === '1') {
    // Optional quick timing log
    // eslint-disable-next-line no-console
    console.log(`category i18n lang=${lang} translated=${ops.length} in ${Date.now()-t0}ms (cats=${categories.length})`);
  }
}

// Get all categories
export const getAllCategories = async (req, res) => {
  try {
  const reqLang = normalizeLang(req.query.lang);
  const allowAuto = isDeepseekConfigured() && String(req.query.autoTranslate || 'false').toLowerCase() === 'true';
    const withProducts = String(req.query.withProducts || 'false').toLowerCase() === 'true';
    // Optional: asTree=true to return nested structure, otherwise flat list
    const asTree = String(req.query.asTree || '').toLowerCase() === 'true';
    let categories = await Category.find().sort({ depth: 1, order: 1, name: 1 }).lean();

    if (withProducts && categories.length) {
      const categoryUsage = await Product.aggregate([
        { $match: { isActive: true } },
        {
          $project: {
            allCategoryIds: {
              $setUnion: [
                {
                  $cond: [
                    { $ifNull: ['$category', false] },
                    ['$category'],
                    []
                  ]
                },
                { $ifNull: ['$categories', []] }
              ]
            }
          }
        },
        { $unwind: '$allCategoryIds' },
        { $group: { _id: '$allCategoryIds' } }
      ]);

      const categoryById = new Map(categories.map((c) => [String(c._id), c]));
      const visibleIds = new Set();

      for (const row of categoryUsage) {
        const catId = String(row._id);
        visibleIds.add(catId);
        const cat = categoryById.get(catId);
        if (cat?.parent) visibleIds.add(String(cat.parent));
        if (Array.isArray(cat?.ancestors)) {
          for (const ancestorId of cat.ancestors) {
            visibleIds.add(String(ancestorId));
          }
        }
      }

      // Always include categories that have custom routes, regardless of product count
      for (const cat of categories) {
        const hasRoute = cat.route && String(cat.route).trim().length > 0;
        const hasMobileRoute = cat.mobileRoute && String(cat.mobileRoute).trim().length > 0;
        if (hasRoute || hasMobileRoute) {
          visibleIds.add(String(cat._id));
          if (cat.parent) visibleIds.add(String(cat.parent));
          if (Array.isArray(cat.ancestors)) {
            for (const ancestorId of cat.ancestors) {
              visibleIds.add(String(ancestorId));
            }
          }
        }
      }

      categories = categories.filter((cat) => visibleIds.has(String(cat._id)));
    }
    // Localize and, if enabled, auto-translate missing fields in batch
    if (reqLang) await translateAndPersistCategories(categories, reqLang, allowAuto);
    if (!asTree) return res.json(categories);

    // Build tree
    const byId = new Map(categories.map(c => [String(c._id), { ...c, children: [] }]));
    const roots = [];
    for (const cat of byId.values()) {
      if (cat.parent) {
        const p = byId.get(String(cat.parent));
        if (p) p.children.push(cat); else roots.push(cat);
      } else {
        roots.push(cat);
      }
    }
    // Sort children by order then name for stable UI
    const sortRec = (nodes) => {
      nodes.sort((a,b)=> (a.order||0)-(b.order||0) || a.name.localeCompare(b.name));
      nodes.forEach(n=> sortRec(n.children||[]));
    };
    sortRec(roots);
    res.json(roots);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get single category
export const getCategory = async (req, res) => {
  try {
  const reqLang = normalizeLang(req.query.lang);
  const allowAuto = isDeepseekConfigured() && String(req.query.autoTranslate || 'false').toLowerCase() === 'true';
    const category = await findCategoryByIdentifier(req.params.id);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    const obj = category.toObject();
    if (reqLang) {
      const nm = obj.name_i18n?.[reqLang] || category.name_i18n?.get?.(reqLang);
      const desc = obj.description_i18n?.[reqLang] || category.description_i18n?.get?.(reqLang);
      if (nm) obj.name = nm;
      if (desc) obj.description = desc;
      if ((!nm || !desc) && allowAuto) {
        const NAME_CTX = 'Category.name';
        const DESC_CTX = 'Category.description';
        let changed = false;
        if (!nm && category.name) {
          try {
            const tr = await deepseekTranslate(category.name, 'auto', reqLang, { contextKey: NAME_CTX });
            const path = `name_i18n.${reqLang}`;
            await Category.updateOne({ _id: category._id }, { $set: { [path]: tr } }).catch(() => {});
            obj.name = tr; changed = true;
          } catch {}
        }
        if (!desc && category.description) {
          try {
            const trd = await deepseekTranslate(category.description, 'auto', reqLang, { contextKey: DESC_CTX });
            const path = `description_i18n.${reqLang}`;
            await Category.updateOne({ _id: category._id }, { $set: { [path]: trd } }).catch(() => {});
            obj.description = trd; changed = true;
          } catch {}
        }
        if (changed && process.env.LOG_TRANSLATION_TIMING === '1') {
          // eslint-disable-next-line no-console
          console.log(`category ${category._id} translated on-demand for lang=${reqLang}`);
        }
      }
    }
    res.json(obj);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create category
export const createCategory = async (req, res) => {
  try {
    // Validate name
    if (!req.body.name || req.body.name.trim().length === 0) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    // Check for duplicate name under same parent
    const existingCategory = await Category.findOne({ 
      name: { $regex: new RegExp(`^${req.body.name.trim()}$`, 'i') },
      parent: req.body.parent || null
    });
    
    if (existingCategory) {
      return res.status(400).json({ message: 'Category with this name already exists' });
    }

    const payload = {
      ...req.body,
      name: req.body.name.trim(),
      route: normalizeRouteValue(req.body.route),
      mobileRoute: normalizeRouteValue(req.body.mobileRoute)
    };
    // Validate parent if provided
    if (payload.parent) {
      const parent = await Category.findById(payload.parent).select('_id');
      if (!parent) return res.status(400).json({ message: 'Parent category not found' });
    }

    const category = new Category(payload);
    
    const savedCategory = await category.save();
    res.status(201).json(savedCategory);
  } catch (error) {
    // Handle specific MongoDB errors
    if (error.code === 11000) {
      if (error.keyPattern.slug) {
        res.status(400).json({ message: 'Category with this slug already exists' });
      } else if (error.keyPattern.name) {
  res.status(400).json({ message: 'Category with this name already exists under the same parent' });
      } else {
        res.status(400).json({ message: 'Duplicate key error' });
      }
    } else {
      res.status(400).json({ message: error.message });
    }
  }
};

// Update category
export const updateCategory = async (req, res) => {
  try {
    // Validate name if provided
    if (req.body.name && req.body.name.trim().length === 0) {
      return res.status(400).json({ message: 'Category name cannot be empty' });
    }

    // Check for duplicate name (scoped by parent) if name is being changed
    if (req.body.name) {
      const existingCategory = await Category.findOne({
        _id: { $ne: req.params.id },
        name: { $regex: new RegExp(`^${req.body.name.trim()}$`, 'i') },
        parent: req.body.parent ?? (await Category.findById(req.params.id))?.parent ?? null
      });

      if (existingCategory) {
        return res.status(400).json({ message: 'Category with this name already exists' });
      }
    }

    // Validate parent if supplied
    const updatePayload = { ...req.body, name: req.body.name?.trim() };
    if (updatePayload.route !== undefined) {
      updatePayload.route = normalizeRouteValue(updatePayload.route);
    }
    if (updatePayload.mobileRoute !== undefined) {
      updatePayload.mobileRoute = normalizeRouteValue(updatePayload.mobileRoute);
    }
    if (updatePayload.parent !== undefined) {
      if (!updatePayload.parent) {
        updatePayload.parent = null; // allow making a root category
      } else {
        if (String(updatePayload.parent) === req.params.id) {
          return res.status(400).json({ message: 'Category cannot be its own parent' });
        }
        const parent = await Category.findById(updatePayload.parent);
        if (!parent) return res.status(400).json({ message: 'Parent category not found' });
        // Cycle check: parent cannot be a descendant
        const parentAncestors = (parent.ancestors || []).map(String);
        if (parentAncestors.includes(req.params.id)) {
          return res.status(400).json({ message: 'Invalid parent: would create a cycle' });
        }
      }
    }

    // Fetch doc first to recompute path/ancestors via save hook
    let category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found' });
    Object.assign(category, updatePayload);
    category = await category.save();

    // If slug or parent changed, update descendants' paths/ancestors
    const children = await Category.find({ ancestors: category._id }).lean();
    if (children.length) {
      const all = await Category.find({ _id: { $in: children.map(c=>c._id) } });
      // Re-save each to trigger pre-save recomputation using its current parent
      await Promise.all(all.map(async c => { c.markModified('slug'); return c.save(); }));
    }
    
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    
    res.json(category);
  } catch (error) {
    // Handle specific MongoDB errors
    if (error.code === 11000) {
      if (error.keyPattern.slug) {
        res.status(400).json({ message: 'Category with this slug already exists' });
      } else if (error.keyPattern.name) {
  res.status(400).json({ message: 'Category with this name already exists under the same parent' });
      } else {
        res.status(400).json({ message: 'Duplicate key error' });
      }
    } else {
      res.status(400).json({ message: error.message });
    }
  }
};

// Delete category
export const deleteCategory = async (req, res) => {
  try {
    const id = req.params.id;
    const hasChildren = await Category.exists({ parent: id });
    if (hasChildren) {
      return res.status(400).json({ message: 'Cannot delete a category that has subcategories' });
    }
    const inProducts = await Product.exists({ $or: [ { category: id }, { categories: id } ] });
    if (inProducts) {
      return res.status(400).json({ message: 'Cannot delete a category in use by products' });
    }
    const category = await Category.findByIdAndDelete(id);
    if (!category) return res.status(404).json({ message: 'Category not found' });
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Reorder categories
export const reorderCategories = async (req, res) => {
  try {
    const { categories } = req.body;
    await Promise.all(
      categories.map(({ id, order }) => 
        Category.findByIdAndUpdate(id, { order })
      )
    );
    res.json({ message: 'Categories reordered successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get subcategories of a parent id (or root when parent is null)
export const getSubcategories = async (req, res) => {
  try {
    const parentId = req.params.parentId === 'root' ? null : req.params.parentId;
    const filter = parentId ? { parent: parentId } : { parent: null };
    const reqLang = normalizeLang(req.query.lang);
    const allowAuto = isDeepseekConfigured();
    const list = await Category.find(filter).sort({ order: 1, name: 1 }).lean();
    if (reqLang) await translateAndPersistCategories(list, reqLang, allowAuto);
    res.json(list);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get the full category tree starting from root
export const getCategoryTree = async (req, res) => {
  try {
    const reqLang = normalizeLang(req.query.lang);
    const allowAuto = isDeepseekConfigured();
    const categories = await Category.find().sort({ depth: 1, order: 1, name: 1 }).lean();
    if (reqLang) await translateAndPersistCategories(categories, reqLang, allowAuto);
    const byId = new Map(categories.map(c => [String(c._id), { ...c, children: [] }]));
    const roots = [];
    for (const cat of byId.values()) {
      if (cat.parent) {
        const p = byId.get(String(cat.parent));
        if (p) p.children.push(cat); else roots.push(cat);
      } else {
        roots.push(cat);
      }
    }
    const sortRec = (nodes) => {
      nodes.sort((a,b)=> (a.order||0)-(b.order||0) || a.name.localeCompare(b.name));
      nodes.forEach(n=> sortRec(n.children||[]));
    };
    sortRec(roots);
    res.json(roots);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin: backfill translations for all categories into a target language
export const translateAllCategories = async (req, res) => {
  try {
    const to = typeof req.query.to === 'string' ? req.query.to.trim() : '';
    if (!to) return res.status(400).json({ message: 'Missing target language (?to=ar|he|... )' });
    if (!isDeepseekConfigured()) return res.status(400).json({ message: 'DeepSeek translation is not configured/enabled' });

    const categories = await Category.find();
    let translatedCount = 0;
    let skipped = 0;
    let failed = 0;

    for (const c of categories) {
      let changed = false;
      try {
        const nameHas = c.name_i18n?.get?.(to) || (c.name_i18n && c.name_i18n[to]);
        const descHas = c.description_i18n?.get?.(to) || (c.description_i18n && c.description_i18n[to]);
        if (!nameHas && typeof c.name === 'string' && c.name.trim()) {
          try {
            const tr = await deepseekTranslate(c.name, 'auto', to);
            if (c.name_i18n && typeof c.name_i18n.set === 'function') c.name_i18n.set(to, tr);
            else { const map = new Map(c.name_i18n || []); map.set(to, tr); c.name_i18n = map; }
            changed = true;
          } catch { /* ignore per-item error */ }
        }
        if (!descHas && typeof c.description === 'string' && c.description.trim()) {
          try {
            const trd = await deepseekTranslate(c.description, 'auto', to);
            if (c.description_i18n && typeof c.description_i18n.set === 'function') c.description_i18n.set(to, trd);
            else { const mapd = new Map(c.description_i18n || []); mapd.set(to, trd); c.description_i18n = mapd; }
            changed = true;
          } catch { /* ignore per-item error */ }
        }
        if (changed) { await c.save().catch(() => {}); translatedCount++; } else { skipped++; }
      } catch { failed++; }
    }

    return res.json({ message: 'Category translations complete', translated: translatedCount, skipped, failed, total: categories.length, lang: to });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};