// DeepSeek translation service (uses OpenAI-compatible chat completions API)
// Env: DEEPSEEK_API_KEY (required)

let API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
let MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
let DB_KEY = null;
let DB_ENABLED = null; // null = unknown/not set; false = explicitly disabled

// Lazy-load DB settings for DeepSeek
export async function loadDeepseekConfigFromDb() {
  try {
    const mod = await import('../../models/Settings.js');
    const Settings = mod.default || mod;
    const s = await Settings.findOne().select('translations').lean();
    const ds = s?.translations?.deepseek;
    if (ds) {
      if (typeof ds.enabled !== 'undefined') DB_ENABLED = !!ds.enabled;
      if (typeof ds.apiUrl === 'string' && ds.apiUrl.trim()) API_URL = ds.apiUrl.trim();
      if (typeof ds.model === 'string' && ds.model.trim()) MODEL = ds.model.trim();
      if (typeof ds.apiKey === 'string' && ds.apiKey.trim()) DB_KEY = ds.apiKey.trim();
    }
  } catch (e) {
    // Ignore if Settings model not available early; fallback to env
  }
}

// Expose a quick check for router guards
export function isDeepseekConfigured() {
  if (DB_ENABLED === false) return false;
  return !!(DB_KEY || process.env.DEEPSEEK_API_KEY);
}

/**
 * Translate a single text using DeepSeek chat API.
 * @param {string} text Source text
 * @param {string} from Source language code (e.g., 'en')
 * @param {string} to Target language code (e.g., 'he')
 * @returns {Promise<string>} Translated text
 */
export async function deepseekTranslate(text, from, to, options = {}) {
  if (DB_ENABLED === false) throw new Error('DeepSeek disabled');
  const key = DB_KEY || process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY missing');
  const { contextKey = '' } = options || {};

  // Cache check (DB)
  const { getCachedTranslation, saveCachedTranslation } = await import('./translationCache.js');
  let cached = await getCachedTranslation(text, from, to, contextKey).catch(() => null);
  const DBG = process.env.LOG_TRANSLATION_DEBUG === '1';
  if (DBG && cached) {
    // eslint-disable-next-line no-console
    console.log(`[i18n] cache hit (ctx='${contextKey || '-'}') from='${from}' to='${to}' len=${String(text).length}`);
  }
  // Fallback to contextless cache to maximize reuse of existing entries
  if (!cached && contextKey) {
    cached = await getCachedTranslation(text, from, to, '').catch(() => null);
    if (DBG && cached) {
      // eslint-disable-next-line no-console
      console.log(`[i18n] cache fallback hit (no ctx) from='${from}' to='${to}' len=${String(text).length}`);
    }
  }
  if (cached) return cached;
  const prompt = `You are a professional translator. Translate the following text from ${from} to ${to}. Preserve placeholders like {{name}} and HTML tags if present. Only return the translated text without quotes.

Text:
${text}`;
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: 'You translate text precisely and preserve placeholders like {{name}} and HTML formatting.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
  };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`DeepSeek API error ${res.status}: ${txt.slice(0,200)}`);
  }
  if (DBG) {
    // eslint-disable-next-line no-console
    console.log(`[i18n] API call DeepSeek model='${MODEL}' from='${from}' to='${to}' ctx='${contextKey || '-'}' len=${String(text).length}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Empty translation result');
  // Persist in cache (best-effort)
  try {
    await saveCachedTranslation(text, content, from, to, contextKey, { provider: 'deepseek', model: MODEL });
  } catch {}
  return content;
}

/**
 * Batch translate an array of items.
 * @param {Array<{id:string,text:string}>} items
 * @param {string} from
 * @param {string} to
 */
export async function deepseekTranslateBatch(items, from, to, options = {}) {
  // For simplicity, translate sequentially to keep prompt quality high; could parallelize with Promise.allSettled if needed.
  const { contextKey } = options || {};
  // Pre-check cache for all items to reduce API calls
  const { getCachedTranslationBulk } = await import('./translationCache.js');
  const texts = items.map(i => i.text);
  let cacheHits = await getCachedTranslationBulk(texts, from, to, contextKey).catch(() => new Map());
  // Fallback to contextless cache for misses
  if (contextKey) {
    const missingTexts = texts.filter(t => !cacheHits.has(t));
    if (missingTexts.length) {
      const fallbackHits = await getCachedTranslationBulk(missingTexts, from, to, '').catch(() => new Map());
      for (const [k, v] of fallbackHits.entries()) {
        cacheHits.set(k, v);
      }
    }
  }
  const results = [];
  for (const it of items) {
    try {
      const hit = cacheHits.get(it.text);
      if (hit) {
        results.push({ id: it.id, text: hit });
        continue;
      }
      const translated = await deepseekTranslate(it.text, from, to, { contextKey });
      results.push({ id: it.id, text: translated });
    } catch (e) {
      results.push({ id: it.id, error: e?.message || 'translate_failed' });
    }
  }
  return results;
}
