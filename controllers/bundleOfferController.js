import BundleOffer from '../models/BundleOffer.js';
import mongoose from 'mongoose';
import { getStoreCurrency } from '../services/storeCurrencyService.js';

export const listAdmin = async (req, res) => {
  try {
    const bundles = await BundleOffer.find()
      .sort({ createdAt: -1 })
      .populate({ path: 'products.product', select: 'name images price originalPrice' })
      .lean();
    const currency = await getStoreCurrency();
    try { res.set('X-Store-Currency', currency); } catch {}
    res.json(bundles);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load bundle offers' });
  }
};

export const getById = async (req, res) => {
  try {
    const bundle = await BundleOffer.findById(req.params.id)
      .populate({ path: 'products.product', select: 'name images price originalPrice' })
      .lean();
  if (!bundle) return res.status(404).json({ message: 'Not found' });
  const currency = await getStoreCurrency();
  try { res.set('X-Store-Currency', currency); } catch {}
  res.json(bundle);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load bundle' });
  }
};

export const create = async (req, res) => {
  try {
    const doc = await BundleOffer.create(req.body || {});
    res.status(201).json(doc);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to create bundle' });
  }
};

export const update = async (req, res) => {
  try {
    const updated = await BundleOffer.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: 'Not found' });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to update bundle' });
  }
};

export const remove = async (req, res) => {
  try {
    const deleted = await BundleOffer.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Failed to delete bundle' });
  }
};

export const bulkRemove = async (req, res) => {
  try {
    const ids = (req.body?.ids || []).filter(Boolean);
    if (!ids.length) return res.status(400).json({ message: 'No ids provided' });
    await BundleOffer.deleteMany({ _id: { $in: ids } });
    res.json({ ok: true, deleted: ids.length });
  } catch (e) {
    res.status(500).json({ message: 'Failed to delete bundles' });
  }
};

export const toggleActive = async (req, res) => {
  try {
    const { active } = req.body || {};
    const updated = await BundleOffer.findByIdAndUpdate(req.params.id, { active: !!active }, { new: true });
    if (!updated) return res.status(404).json({ message: 'Not found' });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ message: 'Failed to update status' });
  }
};

export const publicList = async (req, res) => {
  try {
    const now = new Date();
    const q = { active: true };
    q.$and = [
      { $or: [ { startDate: null }, { startDate: { $lte: now } } ] },
      { $or: [ { endDate: null }, { endDate: { $gte: now } } ] }
    ];
    const bundles = await BundleOffer.find(q)
      .sort({ createdAt: -1 })
      .populate({ path: 'products.product', select: 'name images price originalPrice' })
      .lean();
    const currency = await getStoreCurrency();
    try { res.set('X-Store-Currency', currency); } catch {}
    res.json(bundles);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load bundles' });
  }
};

export const publicListByProduct = async (req, res) => {
  try {
    const now = new Date();
    const productId = req.params.id;
    // Validate and cast ObjectId to ensure proper matching in nested array queries
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: 'Invalid product id' });
    }
    const pid = new mongoose.Types.ObjectId(productId);
    const q = {
      active: true,
      $and: [
        { $or: [ { startDate: null }, { startDate: { $lte: now } } ] },
        { $or: [ { endDate: null }, { endDate: { $gte: now } } ] }
      ],
      'products.product': pid
    };
    const bundles = await BundleOffer.find(q)
      .sort({ createdAt: -1 })
      .populate({ path: 'products.product', select: 'name images price originalPrice' })
      .lean();
    const currency = await getStoreCurrency();
    try { res.set('X-Store-Currency', currency); } catch {}
    res.json(bundles);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load bundles' });
  }
};
