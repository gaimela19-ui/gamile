import express from 'express';
import { convertCurrency } from '../controllers/currencyController.js';
import { adminAuth } from '../middleware/auth.js';
import CurrencyRate from '../models/CurrencyRate.js';
import { SUPPORTED_CURRENCIES } from '../utils/currency.js';

const router = express.Router();

// Default seed data from static config
const SEED_RATES = Object.entries(SUPPORTED_CURRENCIES).map(([code, details]) => ({
  code,
  exchangeRate: details.exchangeRate,
  enabled: true
}));

// Ensure DB has a record for every supported currency
async function ensureSeeded() {
  for (const entry of SEED_RATES) {
    await CurrencyRate.findOneAndUpdate(
      { code: entry.code },
      { $setOnInsert: { exchangeRate: entry.exchangeRate, enabled: entry.enabled } },
      { upsert: true, new: false }
    );
  }
}

// GET /api/currency/rates — public: returns all enabled currencies with rates
router.get('/rates', async (req, res) => {
  try {
    await ensureSeeded();
    const rates = await CurrencyRate.find({ enabled: true }).select('code exchangeRate enabled updatedAt').lean();
    res.json(rates);
  } catch (err) {
    console.error('Error fetching currency rates:', err);
    res.status(500).json({ message: 'Failed to fetch currency rates' });
  }
});

// GET /api/currency/rates/all — admin: returns all currencies including disabled
router.get('/rates/all', adminAuth, async (req, res) => {
  try {
    await ensureSeeded();
    const rates = await CurrencyRate.find().select('code exchangeRate enabled updatedAt').lean();
    res.json(rates);
  } catch (err) {
    console.error('Error fetching all currency rates:', err);
    res.status(500).json({ message: 'Failed to fetch currency rates' });
  }
});

// PUT /api/currency/rates/:code — admin: update rate and/or enabled flag
router.put('/rates/:code', adminAuth, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    if (!SUPPORTED_CURRENCIES[code]) {
      return res.status(400).json({ message: 'Unsupported currency code' });
    }
    const { exchangeRate, enabled } = req.body;
    const update = {};
    if (typeof exchangeRate === 'number') {
      if (exchangeRate < 0) return res.status(400).json({ message: 'Exchange rate must be non-negative' });
      update.exchangeRate = exchangeRate;
    }
    if (typeof enabled === 'boolean') {
      update.enabled = enabled;
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: 'Nothing to update' });
    }
    const doc = await CurrencyRate.findOneAndUpdate(
      { code },
      { $set: update },
      { upsert: true, new: true }
    ).lean();
    res.json(doc);
  } catch (err) {
    console.error('Error updating currency rate:', err);
    res.status(500).json({ message: 'Failed to update currency rate' });
  }
});

// POST /api/currency/convert
router.post('/convert', convertCurrency);

export default router;
