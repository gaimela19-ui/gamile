import express from 'express';
import { deepseekTranslate, deepseekTranslateBatch, isDeepseekConfigured } from '../services/translate/deepseek.js';

const router = express.Router();

// Guard: block if key missing
router.use((req, res, next) => {
  try {
    if (!isDeepseekConfigured()) {
      return res.status(503).json({ message: 'translation_unavailable' });
    }
  } catch {}
  next();
});

// POST /api/translate
// Body options:
// { text: string, from: 'en', to: 'he', contextKey?: string }
// { items: [{id,text}], from, to, contextKey?: string }
router.post('/', async (req, res) => {
  try {
    const { text, items, from = 'en', to = 'he', contextKey = '' } = req.body || {};
    if (Array.isArray(items) && items.length) {
      const normalized = items.map((it, i) => ({ id: it?.id || String(i), text: String(it?.text || '') }));
      const out = await deepseekTranslateBatch(normalized, String(from), String(to), { contextKey: String(contextKey || '') });
      return res.json({ items: out });
    }
    if (typeof text === 'string') {
      const translated = await deepseekTranslate(text, String(from), String(to), { contextKey: String(contextKey || '') });
      return res.json({ text: translated });
    }
    return res.status(400).json({ message: 'bad_request' });
  } catch (e) {
    console.error('[translate] error', e?.message || e);
    return res.status(500).json({ message: 'translate_failed' });
  }
});

export default router;
