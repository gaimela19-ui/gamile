import crypto from 'crypto';
import Translation from '../../models/Translation.js';

function normalizeText(s = '') {
  return String(s)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeHash(sourceText, contextKey = '') {
  const norm = normalizeText(sourceText);
  return crypto.createHash('sha256').update(norm + '|' + contextKey).digest('hex');
}

export async function getCachedTranslation(sourceText, from, to, contextKey = '') {
  const hash = makeHash(sourceText, contextKey);
  const doc = await Translation.findOne({ from: from.toLowerCase(), to: to.toLowerCase(), hash }).lean();
  if (!doc) return null;
  // Update usage asynchronously (no await)
  Translation.updateOne({ _id: doc._id }, { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } }).catch(() => {});
  return doc.translatedText;
}

export async function getCachedTranslationBulk(sourceTexts, from, to, contextKey = '') {
  const map = new Map();
  const items = sourceTexts.map(t => ({ text: t, hash: makeHash(t, contextKey) }));
  const hashes = items.map(i => i.hash);
  const docs = await Translation.find({ from: from.toLowerCase(), to: to.toLowerCase(), hash: { $in: hashes } }).lean();
  const byHash = new Map(docs.map(d => [d.hash, d]));
  for (const it of items) {
    const d = byHash.get(it.hash);
    if (d) map.set(it.text, d.translatedText);
  }
  // Increment usage in background
  if (docs.length) {
    Translation.updateMany({ _id: { $in: docs.map(d => d._id) } }, { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return map;
}

export async function saveCachedTranslation(sourceText, translatedText, from, to, contextKey = '', meta = {}) {
  const hash = makeHash(sourceText, contextKey);
  const doc = {
    from: from.toLowerCase(),
    to: to.toLowerCase(),
    contextKey: contextKey || '',
    sourceText: sourceText,
    translatedText: translatedText,
    hash,
    provider: meta?.provider || 'deepseek',
    model: meta?.model || '',
    // usageCount is incremented via $inc to avoid double counting on insert
    usageCount: 0,
    lastUsedAt: new Date()
  };
  try {
    // Ensure important fields are updated if the doc already exists
    await Translation.updateOne(
      { from: doc.from, to: doc.to, hash: doc.hash },
      {
        $setOnInsert: doc,
        $set: {
          translatedText: translatedText,
          provider: doc.provider,
          model: doc.model,
          contextKey: doc.contextKey,
          sourceText: sourceText,
          lastUsedAt: new Date()
        },
        $inc: { usageCount: 1 }
      },
      { upsert: true }
    );
  } catch (e) {
    // ignore duplicates race conditions
  }
}
