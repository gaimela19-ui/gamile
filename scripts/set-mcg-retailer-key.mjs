#!/usr/bin/env node
import dbManager from '../services/dbManager.js';
import Settings from '../models/Settings.js';

const NEW_KEY = '5e91e088-8685-40c3-a095-49961947934e';

(async () => {
  try {
    await dbManager.connectWithRetry();
    let s = await Settings.findOne();
    if (!s) s = new Settings();
    s.mcg = s.mcg || {};
    s.mcg.retailerKey = NEW_KEY.trim();
    try { s.markModified('mcg'); } catch {}
    await s.save();
    console.log('[mcg][retailerKey] set to', s.mcg.retailerKey);
    process.exit(0);
  } catch (e) {
    console.error('Failed to set retailerKey:', e?.message || e);
    process.exit(1);
  }
})();
