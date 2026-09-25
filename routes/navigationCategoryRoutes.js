import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import NavigationCategory from '../models/NavigationCategory.js';
import Category from '../models/Category.js';
import { deepseekTranslate, isDeepseekConfigured } from '../services/translate/deepseek.js';

const router = express.Router();

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

function sanitizeSlug(input) {
  if (!input) return '';
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function normalizeRoutePath(value) {
  if (!value || typeof value !== 'string') return '';
  let path = value.trim();
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/{2,}/g, '/');
  return path;
}

async function ensureUniqueSlug(desired, excludeId) {
  let base = sanitizeSlug(desired) || 'nav';
  let candidate = base;
  let counter = 1;
  // Loop until a free slug is found
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const exists = await NavigationCategory.findOne({
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      $or: [
        { slug: candidate },
        { 'slugGroups.slug': candidate }
      ]
    }).select('_id');
    if (!exists) return candidate;
    candidate = `${base}-${counter++}`;
  }
}

// Get all navigation categories
router.get('/', async (req, res) => {
  try {
  const reqLang = normalizeLang(req.query.lang);
  // Only auto-translate when explicitly requested to avoid slowing default responses
  const allowAuto = isDeepseekConfigured() && String(req.query.autoTranslate || 'false').toLowerCase() === 'true';
    const categories = await NavigationCategory.find()
      .populate('categories', '_id name slug path')
      .populate('slugGroups.categories', '_id name slug path')
      .sort('order');
    if (reqLang) {
      // Helper: schedule async work without delaying response
      const schedule = (fn) => { try { Promise.resolve().then(fn).catch(() => {}); } catch {} };
      // Localize names for populated Category refs without blocking
      const localize = (cat) => {
        try {
          const nm = (cat?.name_i18n && (cat.name_i18n[reqLang] || cat.name_i18n.get?.(reqLang))) || null;
          if (nm) { cat.name = nm; return; }
          // Use existing populated name for immediate response
          if (cat?.name) cat.name = cat.name;
          if (allowAuto && cat?._id && cat?.name) {
            schedule(async () => {
              try {
                const full = await Category.findById(cat._id);
                if (full?.name) {
                  const tr = await deepseekTranslate(full.name, 'auto', reqLang);
                  const map = new Map(full.name_i18n || []);
                  map.set(reqLang, tr);
                  full.name_i18n = map;
                  await full.save().catch(() => {});
                }
              } catch {}
            });
          }
        } catch {}
      };
      for (const nav of categories) {
        try {
          // Localize navigation item name
          const navName = (nav?.name_i18n && (nav.name_i18n[reqLang] || nav.name_i18n.get?.(reqLang))) || null;
          if (navName) nav.name = navName;
          else {
            // Immediate fallback: keep original name, schedule translation persistence
            if (nav?.name) nav.name = nav.name;
            if (allowAuto && nav?.name) {
              schedule(async () => {
                try {
                  const tr = await deepseekTranslate(nav.name, 'auto', reqLang);
                  const map = new Map(nav.name_i18n || []);
                  map.set(reqLang, tr);
                  nav.name_i18n = map;
                  await nav.save().catch(() => {});
                } catch {}
              });
            }
          }

          // Localize subCategories inline names
          if (Array.isArray(nav.subCategories)) {
            for (const sc of nav.subCategories) {
              try {
                const scName = (sc?.name_i18n && (sc.name_i18n[reqLang] || sc.name_i18n.get?.(reqLang))) || null;
                if (scName) sc.name = scName;
                else {
                  if (sc?.name) sc.name = sc.name;
                  if (allowAuto && sc?.name) {
                    schedule(async () => {
                      try {
                        const tr = await deepseekTranslate(sc.name, 'auto', reqLang);
                        const map = new Map(sc.name_i18n || []);
                        map.set(reqLang, tr);
                        sc.name_i18n = map;
                        await nav.save().catch(() => {});
                      } catch {}
                    });
                  }
                }
              } catch {}
            }
          }

          // Localize group titles
          if (Array.isArray(nav.slugGroups)) {
            for (const g of nav.slugGroups) {
              try {
                const gTitle = (g?.title_i18n && (g.title_i18n[reqLang] || g.title_i18n.get?.(reqLang))) || null;
                if (gTitle) g.title = gTitle;
                else {
                  if (g?.title) g.title = g.title;
                  if (allowAuto && g?.title) {
                    schedule(async () => {
                      try {
                        const tr = await deepseekTranslate(g.title, 'auto', reqLang);
                        const map = new Map(g.title_i18n || []);
                        map.set(reqLang, tr);
                        g.title_i18n = map;
                        await nav.save().catch(() => {});
                      } catch {}
                    });
                  }
                }
              } catch {}
            }
          }

          if (Array.isArray(nav.categories)) {
            for (const c of nav.categories) localize(c);
          }
          if (Array.isArray(nav.slugGroups)) {
            for (const g of nav.slugGroups) {
              if (Array.isArray(g.categories)) {
                for (const c of g.categories) localize(c);
              }
            }
          }
        } catch {}
      }
    }
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create navigation category (admin only)
router.post('/', adminAuth, async (req, res) => {
  try {
    const body = req.body || {};
    // Normalize/ensure unique slug if client provided one
    if (body.slug) {
      body.slug = await ensureUniqueSlug(body.slug);
    }
    if ('route' in body) {
      const normalizedRoute = normalizeRoutePath(body.route);
      body.route = normalizedRoute || null;
    }
    // If slugGroups provided, sanitize and ensure unique for each
    if (Array.isArray(body.slugGroups) && body.slugGroups.length) {
      // First sanitize
      body.slugGroups = body.slugGroups.map((g) => ({
        ...g,
        slug: sanitizeSlug(g.slug || g.title || 'nav')
      }));
      // Deduplicate within payload
      const seen = new Set();
      body.slugGroups = body.slugGroups.map((g) => {
        let base = g.slug || 'nav';
        let candidate = base;
        let i = 1;
        while (seen.has(candidate)) candidate = `${base}-${i++}`;
        seen.add(candidate);
        return { ...g, slug: candidate };
      });
      // Ensure uniqueness across collection
      for (let i = 0; i < body.slugGroups.length; i++) {
        const g = body.slugGroups[i];
        body.slugGroups[i].slug = await ensureUniqueSlug(g.slug);
      }
    }
    // If client sent subCategories with slugs but not categories, map them here too
    if ((!body.categories || body.categories.length === 0) && Array.isArray(body.subCategories)) {
      const slugs = body.subCategories.map((s) => s && s.slug).filter(Boolean);
      if (slugs.length > 0) {
        const docs = await Category.find({ slug: { $in: slugs } }).select('_id slug');
        body.categories = docs.map(d => d._id);
      }
    }
    const category = new NavigationCategory(body);
    const savedCategory = await category.save();
    const populated = await savedCategory.populate([
      { path: 'categories', select: '_id name slug path' },
      { path: 'slugGroups.categories', select: '_id name slug path' }
    ]);
    res.status(201).json(populated);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ message: 'Category with this name or slug already exists' });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// Update navigation category (admin only)
router.put('/reorder', adminAuth, async (req, res) => {
  try {
    const { categories } = req.body;
    await Promise.all(
      categories.map(({ id, order }) => 
        NavigationCategory.findByIdAndUpdate(id, { order })
      )
    );
    res.json({ message: 'Categories reordered successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update navigation category (admin only)
router.put('/:id([0-9a-fA-F]{24})', adminAuth, async (req, res) => {
  try {
    const body = req.body || {};
    // Normalize/ensure unique slug if provided
    if (body.slug) {
      body.slug = await ensureUniqueSlug(body.slug, req.params.id);
    }
    if ('route' in body) {
      const normalizedRoute = normalizeRoutePath(body.route);
      body.route = normalizedRoute || null;
    }
    // Process slugGroups if provided
    if (Array.isArray(body.slugGroups)) {
      // Sanitize
      body.slugGroups = body.slugGroups.map((g) => ({
        ...g,
        slug: sanitizeSlug(g.slug || g.title || 'nav')
      }));
      // Deduplicate within payload
      const seen = new Set();
      body.slugGroups = body.slugGroups.map((g) => {
        let base = g.slug || 'nav';
        let candidate = base;
        let i = 1;
        while (seen.has(candidate)) candidate = `${base}-${i++}`;
        seen.add(candidate);
        return { ...g, slug: candidate };
      });
      // Ensure uniqueness across collection, excluding this doc id
      for (let i = 0; i < body.slugGroups.length; i++) {
        const g = body.slugGroups[i];
        body.slugGroups[i].slug = await ensureUniqueSlug(g.slug, req.params.id);
      }
    }
    // Map subCategories slugs to categories if categories not explicitly provided
    if ((!body.categories || body.categories.length === 0) && Array.isArray(body.subCategories)) {
      const slugs = body.subCategories.map((s) => s && s.slug).filter(Boolean);
      if (slugs.length > 0) {
        const docs = await Category.find({ slug: { $in: slugs } }).select('_id slug');
        body.categories = docs.map(d => d._id);
      } else {
        body.categories = [];
      }
    }
    const category = await NavigationCategory.findByIdAndUpdate(
      req.params.id,
      body,
      { new: true, runValidators: true }
    ).populate([
      { path: 'categories', select: '_id name slug path' },
      { path: 'slugGroups.categories', select: '_id name slug path' }
    ]);
    
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    
    res.json(category);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ message: 'Category with this name or slug already exists' });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// Delete navigation category (admin only)
router.delete('/:id([0-9a-fA-F]{24})', adminAuth, async (req, res) => {
  try {
    const category = await NavigationCategory.findByIdAndDelete(req.params.id);
    
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Groups API
// GET groups for a navigation item
router.get('/:id([0-9a-fA-F]{24})/groups', async (req, res) => {
  try {
    const reqLang = normalizeLang(req.query.lang);
    const allowAuto = isDeepseekConfigured();
    const doc = await NavigationCategory.findById(req.params.id)
      .populate('slugGroups.categories', '_id name slug path');
    if (!doc) return res.status(404).json({ message: 'Navigation item not found' });
    if (reqLang) {
      const localize = async (cat) => {
        try {
          const nm = (cat?.name_i18n && (cat.name_i18n[reqLang] || cat.name_i18n.get?.(reqLang))) || null;
          if (nm) { cat.name = nm; return; }
          if (allowAuto && cat?._id) {
            const full = await Category.findById(cat._id);
            if (full?.name) {
              try {
                const tr = await deepseekTranslate(full.name, 'auto', reqLang);
                const map = new Map(full.name_i18n || []);
                map.set(reqLang, tr);
                full.name_i18n = map;
                await full.save().catch(() => {});
                cat.name = tr;
              } catch {}
            }
          }
        } catch {}
      };
      // Localize group titles
      if (Array.isArray(doc.slugGroups)) {
        for (const g of doc.slugGroups) {
          try {
            const gTitle = (g?.title_i18n && (g.title_i18n[reqLang] || g.title_i18n.get?.(reqLang))) || null;
            if (gTitle) g.title = gTitle;
            else if (allowAuto && g?.title) {
              try {
                const tr = await deepseekTranslate(g.title, 'auto', reqLang);
                const map = new Map(g.title_i18n || []);
                map.set(reqLang, tr);
                g.title_i18n = map;
                await doc.save().catch(() => {});
                g.title = tr;
              } catch {}
            }
          } catch {}
        }
      }

      for (const g of (doc.slugGroups || [])) {
        if (Array.isArray(g.categories)) {
          for (const c of g.categories) await localize(c);
        }
      }
    }
    res.json(doc.slugGroups || []);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add group
router.post('/:id([0-9a-fA-F]{24})/groups', adminAuth, async (req, res) => {
  try {
    const { slug, title, categories = [], categorySlugs = [] } = req.body || {};
    const doc = await NavigationCategory.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Navigation item not found' });

    const sanitized = sanitizeSlug(slug || title || '');
    // Ensure global uniqueness via helper
    const unique = await ensureUniqueSlug(sanitized);

    let catIds = Array.isArray(categories) ? categories.slice() : [];
    if ((!catIds.length) && Array.isArray(categorySlugs) && categorySlugs.length) {
      const found = await Category.find({ slug: { $in: categorySlugs } }).select('_id');
      catIds = found.map(f => f._id);
    }

    doc.slugGroups = doc.slugGroups || [];
    doc.slugGroups.push({ slug: unique, title, categories: catIds });
    await doc.save();
    await doc.populate('slugGroups.categories', '_id name slug path');
    res.status(201).json(doc.slugGroups);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ message: 'Slug already exists' });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// Update group by slug
router.put('/:id([0-9a-fA-F]{24})/groups/:groupSlug', adminAuth, async (req, res) => {
  try {
    const { slug, title, categories = [], categorySlugs = [] } = req.body || {};
    const doc = await NavigationCategory.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Navigation item not found' });

    const grp = (doc.slugGroups || []).find(g => g.slug === req.params.groupSlug);
    if (!grp) return res.status(404).json({ message: 'Group not found' });

    if (slug && slug !== grp.slug) {
      grp.slug = await ensureUniqueSlug(slug, doc._id); // excludeId only avoids same doc slug collision
    }
    if (typeof title === 'string') grp.title = title;

    let catIds = Array.isArray(categories) ? categories.slice() : undefined;
    if (!catIds && Array.isArray(categorySlugs) && categorySlugs.length) {
      const found = await Category.find({ slug: { $in: categorySlugs } }).select('_id');
      catIds = found.map(f => f._id);
    }
    if (catIds) grp.categories = catIds;

    await doc.save();
    await doc.populate('slugGroups.categories', '_id name slug path');
    res.json(doc.slugGroups);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ message: 'Slug already exists' });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// Delete group
router.delete('/:id([0-9a-fA-F]{24})/groups/:groupSlug', adminAuth, async (req, res) => {
  try {
    const doc = await NavigationCategory.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Navigation item not found' });
    const before = (doc.slugGroups || []).length;
    doc.slugGroups = (doc.slugGroups || []).filter(g => g.slug !== req.params.groupSlug);
    if (doc.slugGroups.length === before) return res.status(404).json({ message: 'Group not found' });
    await doc.save();
    res.json({ message: 'Group deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Public: fetch by group slug (across all navigation items)
router.get('/group/by-slug/:groupSlug', async (req, res) => {
  try {
    const reqLang = normalizeLang(req.query.lang);
    const allowAuto = isDeepseekConfigured();
    const doc = await NavigationCategory.findOne({ 'slugGroups.slug': req.params.groupSlug, isActive: true })
      .populate('slugGroups.categories', '_id name slug path');
    if (!doc) return res.status(404).json({ message: 'Group not found' });
    const grp = (doc.slugGroups || []).find(g => g.slug === req.params.groupSlug);
    if (reqLang && grp) {
      // Localize group title
      try {
        const gTitle = (grp?.title_i18n && (grp.title_i18n[reqLang] || grp.title_i18n.get?.(reqLang))) || null;
        if (gTitle) grp.title = gTitle;
        else if (allowAuto && grp?.title) {
          try {
            const tr = await deepseekTranslate(grp.title, 'auto', reqLang);
            const map = new Map(grp.title_i18n || []);
            map.set(reqLang, tr);
            grp.title_i18n = map;
            await doc.save().catch(() => {});
            grp.title = tr;
          } catch {}
        }
      } catch {}

      if (Array.isArray(grp.categories)) {
      const localize = async (cat) => {
        try {
          const nm = (cat?.name_i18n && (cat.name_i18n[reqLang] || cat.name_i18n.get?.(reqLang))) || null;
          if (nm) { cat.name = nm; return; }
          if (allowAuto && cat?._id) {
            const full = await Category.findById(cat._id);
            if (full?.name) {
              try {
                const tr = await deepseekTranslate(full.name, 'auto', reqLang);
                const map = new Map(full.name_i18n || []);
                map.set(reqLang, tr);
                full.name_i18n = map;
                await full.save().catch(() => {});
                cat.name = tr;
              } catch {}
            }
          }
        } catch {}
      };
        for (const c of grp.categories) await localize(c);
      }
    }
    res.json({ navigationId: doc._id, group: grp });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Public: get a single navigation category by slug with its mapped categories
router.get('/:slug', async (req, res) => {
  try {
    const reqLang = normalizeLang(req.query.lang);
    const allowAuto = isDeepseekConfigured();
    const doc = await NavigationCategory.findOne({ slug: req.params.slug, isActive: true })
      .populate('categories', '_id name slug path')
      .populate('slugGroups.categories', '_id name slug path');
    if (!doc) return res.status(404).json({ message: 'Navigation item not found' });
    if (reqLang) {
      const localize = async (cat) => {
        try {
          const nm = (cat?.name_i18n && (cat.name_i18n[reqLang] || cat.name_i18n.get?.(reqLang))) || null;
          if (nm) { cat.name = nm; return; }
          if (allowAuto && cat?._id) {
            const full = await Category.findById(cat._id);
            if (full?.name) {
              try {
                const tr = await deepseekTranslate(full.name, 'auto', reqLang);
                const map = new Map(full.name_i18n || []);
                map.set(reqLang, tr);
                full.name_i18n = map;
                await full.save().catch(() => {});
                cat.name = tr;
              } catch {}
            }
          }
        } catch {}
      };
      if (Array.isArray(doc.categories)) {
        for (const c of doc.categories) await localize(c);
      }
      if (Array.isArray(doc.slugGroups)) {
        for (const g of doc.slugGroups) {
          if (Array.isArray(g.categories)) {
            for (const c of g.categories) await localize(c);
          }
        }
      }
    }
    res.json(doc);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Reorder route moved above and consolidated

export default router;