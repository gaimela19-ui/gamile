import asyncHandler from 'express-async-handler';
import Page from '../models/Page.js';

const policyConfig = {
  delivery: {
    slug: 'deliveries',
    title: 'Delivery policy',
    defaultPoints: [
      'يتم التوصيل عادة خلال ثلاثة أيام عمل.',
      'توصيل الطلبات يتم من خلال شركات توصيل مرخصة في البلاد.',
      'يتم الاتصال بك من خلال مندوب التوصيل قبل أن يصل إلى عنوانك.',
      'يتم دفع ثمن البضائع المطلوبة إلى موظف التوصيل في حال اخترت وسيلة الدفع عند الاستلام.',
      'الطلبات الكبيرة قد يترتب عليها رسوم توصيل إضافية، نقوم بالتواصل معك وإخبارك بأي رسوم إضافية قبل إرسال طلبك.'
    ]
  },
  exchange: { slug: 'returns', title: 'Exchange policy', defaultPoints: [] },
  cancellation: { slug: 'transaction-cancellation', title: 'Cancellation policy', defaultPoints: [] }
};

const getConfig = (key) => policyConfig[key] || null;
const getPoints = (page, config) => Array.isArray(page?.settings?.productPolicyPoints)
  ? page.settings.productPolicyPoints
  : (!page && config ? config.defaultPoints : []);

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const toPolicyResponse = (key, page) => {
  const config = getConfig(key);
  return {
    key,
    slug: config.slug,
    title: page?.title || config.title,
    points: getPoints(page, config),
    content: page?.content || '',
    configured: Array.isArray(page?.settings?.productPolicyPoints),
    published: page?.status === 'published'
  };
};

export const getProductPolicies = asyncHandler(async (_req, res) => {
  const configs = Object.entries(policyConfig);
  const pages = await Page.find({ slug: { $in: configs.map(([, config]) => config.slug) } }).lean();
  const bySlug = new Map(pages.map(page => [page.slug, page]));
  res.json(Object.fromEntries(configs.map(([key, config]) => [key, toPolicyResponse(key, bySlug.get(config.slug))])));
});

export const getProductPolicy = asyncHandler(async (req, res) => {
  const config = getConfig(req.params.key);
  if (!config) return res.status(404).json({ message: 'Product policy not found' });
  const page = await Page.findOne({ slug: config.slug, status: 'published' }).lean();
  res.json(toPolicyResponse(req.params.key, page));
});

export const updateProductPolicy = asyncHandler(async (req, res) => {
  const config = getConfig(req.params.key);
  if (!config) return res.status(404).json({ message: 'Product policy not found' });
  if (!Array.isArray(req.body?.points)) return res.status(400).json({ message: 'points[] is required' });

  const points = req.body.points
    .filter(point => typeof point === 'string')
    .map(point => point.trim())
    .filter(Boolean)
    .slice(0, 30);
  if (points.some(point => point.length > 1000)) {
    return res.status(400).json({ message: 'Policy points must be 1000 characters or fewer' });
  }

  const title = typeof req.body.title === 'string' && req.body.title.trim() ? req.body.title.trim() : config.title;
  const content = `<ul>${points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>`;
  let page = await Page.findOne({ slug: config.slug });
  if (!page) {
    page = new Page({
      title,
      slug: config.slug,
      status: 'published',
      publishedAt: new Date(),
      content,
      metaTitle: title,
      metaDescription: title,
      settings: { productPolicyPoints: points },
      updatedBy: req.user?._id
    });
  } else {
    page.title = title;
    page.content = content;
    page.status = 'published';
    page.publishedAt = page.publishedAt || new Date();
    page.metaTitle = title;
    page.metaDescription = title;
    page.set('settings.productPolicyPoints', points);
    page.updatedBy = req.user?._id;
  }
  await page.save();
  res.json(toPolicyResponse(req.params.key, page));
});