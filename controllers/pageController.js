import asyncHandler from 'express-async-handler';
import Page from '../models/Page.js';

// GET /api/pages?search=&status=&limit=20&page=1&sort=-updatedAt
export const listPages = asyncHandler(async (req, res) => {
  const { search, status, limit = 20, page = 1, sort = '-updatedAt' } = req.query;
  const l = Math.min(parseInt(limit, 10) || 20, 100);
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const q = {};
  if (status && ['draft', 'published'].includes(status)) q.status = status;
  if (search) {
    q.$text = { $search: search.toString() };
  }
  const sortObj = {};
  for (const f of String(sort).split(',')) {
    if (!f) continue;
    const dir = f.startsWith('-') ? -1 : 1;
    const key = f.replace(/^[-+]/, '');
    if (['createdAt', 'updatedAt', 'title', 'status', 'publishedAt'].includes(key)) sortObj[key] = dir;
  }
  const [items, total] = await Promise.all([
    Page.find(q).sort(sortObj).skip((p - 1) * l).limit(l).lean(),
    Page.countDocuments(q)
  ]);
  res.json({ items, pagination: { total, page: p, pages: Math.ceil(total / l), limit: l } });
});

// GET /api/pages/:id  OR /api/pages/slug/:slug (public read)
export const getPageById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const page = await Page.findById(id).lean();
  if (!page) return res.status(404).json({ message: 'Page not found' });
  res.json(page);
});

export const getPageBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const page = await Page.findOne({ slug, status: 'published' }).lean();
  if (!page) return res.status(404).json({ message: 'Page not found' });
  res.json(page);
});

// POST /api/pages
export const createPage = asyncHandler(async (req, res) => {
  const { title, slug, content = '', status = 'draft', metaTitle = '', metaDescription = '', settings = {} } = req.body || {};
  if (!title || !slug) return res.status(400).json({ message: 'Title and slug are required' });
  const exists = await Page.findOne({ slug });
  if (exists) return res.status(409).json({ message: 'Slug already exists' });
  const now = new Date();
  const page = await Page.create({
    title,
    slug: String(slug).toLowerCase(),
    content,
    status,
    metaTitle,
    metaDescription,
    publishedAt: status === 'published' ? now : undefined,
    updatedBy: req.user?._id,
    settings
  });
  res.status(201).json(page);
});

// PUT /api/pages/:id
export const updatePage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body || {};
  if (updates.slug) updates.slug = String(updates.slug).toLowerCase();
  if (typeof updates.status !== 'undefined' && !['draft', 'published'].includes(updates.status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  if (updates.slug) {
    const slugOwner = await Page.findOne({ slug: updates.slug, _id: { $ne: id } });
    if (slugOwner) return res.status(409).json({ message: 'Slug already exists' });
  }
  const prev = await Page.findById(id);
  if (!prev) return res.status(404).json({ message: 'Page not found' });
  if (updates.status && updates.status === 'published' && prev.status !== 'published') {
    updates.publishedAt = new Date();
  }
  updates.updatedBy = req.user?._id;
  const page = await Page.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
  res.json(page);
});

// DELETE /api/pages/:id
export const deletePage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const page = await Page.findById(id);
  if (!page) return res.status(404).json({ message: 'Page not found' });
  await page.deleteOne();
  res.json({ ok: true });
});
