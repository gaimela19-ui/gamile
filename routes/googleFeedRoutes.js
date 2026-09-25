import express from 'express';
import Product from '../models/Product.js';
import Settings from '../models/Settings.js';

const router = express.Router();

const DEFAULT_STOREFRONT_URL = 'https://mypetils.netlify.app';

function xmlEscape(input) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripHtml(input) {
  return String(input || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function ensureAbsoluteUrl(value, baseUrl) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const normalizedBase = String(baseUrl || '').replace(/\/$/, '');
  if (!normalizedBase) return raw;

  const cleaned = raw.replace(/^\/+/, '');
  if (/^api\/uploads\//i.test(cleaned)) return `${normalizedBase}/${cleaned}`;
  if (/^uploads\//i.test(cleaned)) return `${normalizedBase}/api/${cleaned}`;
  return `${normalizedBase}/${cleaned}`;
}

function remapImageLinkToStorefront(imageUrl, storefrontBase, apiBaseUrl) {
  const raw = String(imageUrl || '').trim();
  if (!raw) return '';

  const normalizedStorefront = String(storefrontBase || '').replace(/\/$/, '');
  const normalizedApiBase = String(apiBaseUrl || '').replace(/\/$/, '');
  if (!normalizedStorefront) return raw;

  // If URL is already on storefront, keep as-is.
  if (raw.startsWith(`${normalizedStorefront}/`)) return raw;

  // If it points to backend API base, map the path to storefront domain.
  if (normalizedApiBase && raw.startsWith(`${normalizedApiBase}/`)) {
    const suffix = raw.slice(normalizedApiBase.length);
    const normalizedSuffix = suffix.startsWith('/uploads/') ? `/api${suffix}` : suffix;
    return `${normalizedStorefront}${normalizedSuffix}`;
  }

  // For absolute URLs from other hosts, only remap known upload path patterns.
  try {
    const parsed = new URL(raw);
    if (parsed.pathname.startsWith('/api/uploads/')) {
      return `${normalizedStorefront}${parsed.pathname}${parsed.search || ''}`;
    }
    if (parsed.pathname.startsWith('/uploads/')) {
      return `${normalizedStorefront}/api${parsed.pathname}${parsed.search || ''}`;
    }
  } catch {
    // Ignore URL parsing failures and keep the original URL.
  }

  return raw;
}

function parseStorefrontBase() {
  return DEFAULT_STOREFRONT_URL;
}

router.get(['/google-feed.xml', '/api/google-feed.xml'], async (req, res) => {
  try {
    const [settings, products] = await Promise.all([
      Settings.findOne().lean(),
      Product.find({ isActive: true })
        .populate('category', 'name')
        .populate('brand', 'name label')
        .sort({ updatedAt: -1 })
        .lean()
    ]);

    const apiBaseUrl = String(settings?.apiBaseUrl || process.env.API_BASE_URL || '').replace(/\/$/, '');
    const storefrontBase = parseStorefrontBase();
    const currency = String(settings?.currency || 'USD').toUpperCase();
    const feedUrl = `${storefrontBase}/google-feed.xml`;
    const officialAddress = String(settings?.address || '').trim();

    const itemsXml = (products || []).map((product) => {
      const id = String(product?._id || '').trim();
      const title = String(product?.name || '').trim();
      const description = stripHtml(product?.description || '');
      const link = `${storefrontBase}/product/${encodeURIComponent(id)}`;
      const imageCandidate = Array.isArray(product?.images) ? product.images.find(Boolean) : '';
      const rawImageLink = ensureAbsoluteUrl(imageCandidate, storefrontBase);
      const imageLink = remapImageLinkToStorefront(rawImageLink, storefrontBase, apiBaseUrl);
      const availability = Number(product?.stock || 0) > 0 ? 'in stock' : 'out of stock';
      const priceValue = Number(product?.price || 0);
      const price = `${priceValue.toFixed(2)} ${currency}`;
      const brand = String(product?.brand?.name || product?.brand?.label || '').trim();

      const variantList = Array.isArray(product?.variants) ? product.variants : [];
      const firstVariant = variantList.find(Boolean) || null;
      const gtinCandidate = firstVariant?.barcode || product?.mcgBarcode || '';
      const mpnCandidate = firstVariant?.sku || product?.rivhitItemCode || '';
      const condition = 'new';

      const lines = [
        '    <item>',
        `      <g:id>${xmlEscape(id)}</g:id>`,
        `      <g:title>${xmlEscape(title)}</g:title>`,
        `      <g:description>${xmlEscape(description)}</g:description>`,
        `      <g:link>${xmlEscape(link)}</g:link>`,
        `      <g:image_link>${xmlEscape(imageLink)}</g:image_link>`,
        `      <g:availability>${xmlEscape(availability)}</g:availability>`,
        `      <g:price>${xmlEscape(price)}</g:price>`,
        `      <g:brand>${xmlEscape(brand)}</g:brand>`,
        gtinCandidate ? `      <g:gtin>${xmlEscape(gtinCandidate)}</g:gtin>` : '',
        mpnCandidate ? `      <g:mpn>${xmlEscape(mpnCandidate)}</g:mpn>` : '',
        `      <g:condition>${xmlEscape(condition)}</g:condition>`,
        '    </item>'
      ].filter(Boolean);

      return lines.join('\n');
    }).join('\n');

    const addressXml = officialAddress ? `\n    <store_address>${xmlEscape(officialAddress)}</store_address>` : '';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n  <channel>\n    <title>${xmlEscape(settings?.name || 'Product Feed')}</title>\n    <link>${xmlEscape(storefrontBase)}</link>\n    <description>${xmlEscape('Auto-updating product feed')}</description>\n    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n    <feed_url>${xmlEscape(feedUrl)}</feed_url>${addressXml}\n${itemsXml}\n  </channel>\n</rss>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).send(xml);
  } catch (error) {
    console.error('[google-feed] failed to generate feed', error?.message || error);
    return res.status(500).json({ message: 'Failed to generate google feed' });
  }
});

export default router;
