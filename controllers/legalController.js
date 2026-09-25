import crypto from 'crypto';
import asyncHandler from 'express-async-handler';
import LegalPageView from '../models/LegalPageView.js';
import { Parser as Json2csvParser } from 'json2csv';

// POST /api/legal/view { page: 'privacy' | 'terms' }
export const recordLegalView = asyncHandler(async (req, res) => {
  const { page } = req.body || {};
  if (!['privacy', 'terms'].includes(page)) {
    return res.status(400).json({ message: 'Invalid page' });
  }
  // Lightweight hashing of IP+UA (NOT reversible, not PII storage) for basic dedupe if needed later.
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  const ua = (req.headers['user-agent'] || '').slice(0, 300);
  const hash = crypto.createHash('sha256').update(ip + '|' + ua).digest('hex').slice(0, 32);
  await LegalPageView.create({ page, ipHash: hash, userAgent: ua });
  res.json({ ok: true });
});

// GET /api/legal/stats?page=privacy
export const getLegalStats = asyncHandler(async (req, res) => {
  const { page } = req.query;
  const match = page && ['privacy', 'terms'].includes(page) ? { page } : {};
  const total = await LegalPageView.countDocuments(match);
  const last24h = await LegalPageView.countDocuments({
    ...match,
    createdAt: { $gte: new Date(Date.now() - 24*60*60*1000) }
  });
  res.json({ total, last24h });
});

// GET /api/legal/views?limit=100&page=1&sort=-createdAt&pageType=privacy
export const getLegalViews = asyncHandler(async (req, res) => {
  const { limit = 100, page = 1, sort = '-createdAt', pageType } = req.query;
  const l = Math.min(parseInt(limit, 10) || 100, 1000);
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const match = pageType && ['privacy', 'terms'].includes(pageType) ? { page: pageType } : {};
  const sortObj = {};
  const fields = sort.toString().split(',');
  fields.forEach(f => {
    if (!f) return;
    const dir = f.startsWith('-') ? -1 : 1;
    const key = f.replace(/^[-+]/, '');
    if (['createdAt', 'page'].includes(key)) sortObj[key] = dir;
  });
  const [items, total] = await Promise.all([
    LegalPageView.find(match)
      .sort(sortObj)
      .skip((p - 1) * l)
      .limit(l)
      .lean(),
    LegalPageView.countDocuments(match)
  ]);
  res.json({ items, pagination: { total, page: p, pages: Math.ceil(total / l), limit: l } });
});

// GET /api/legal/export?format=csv&pageType=privacy&from=ISO&to=ISO
export const exportLegalViews = asyncHandler(async (req, res) => {
  const { format = 'csv', pageType, from, to } = req.query;
  const match = {};
  if (pageType && ['privacy', 'terms'].includes(pageType)) match.page = pageType;
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from);
    if (to) match.createdAt.$lte = new Date(to);
  }
  const cursor = LegalPageView.find(match).sort({ createdAt: -1 }).lean();
  const docs = await cursor.exec();
  if (format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="legal-views.json"');
    return res.json(docs);
  }
  // CSV default
  const fields = ['page', 'createdAt', 'ipHash', 'userAgent'];
  const parser = new Json2csvParser({ fields });
  const csv = parser.parse(docs.map(d => ({ ...d, createdAt: new Date(d.createdAt).toISOString() })));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="legal-views.csv"');
  return res.send(csv);
});
