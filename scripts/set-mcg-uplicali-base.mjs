#!/usr/bin/env node
import dbManager from '../services/dbManager.js';
import Settings from '../models/Settings.js';

(async () => {
  try {
    await dbManager.connectWithRetry();
    let s = await Settings.findOne();
    if (!s) s = new Settings();
    s.mcg = s.mcg || {};
    s.mcg.apiFlavor = 'uplicali';
    s.mcg.baseUrl = 'https://apis.uplicali.com/SuperMCG/MCG_API';
    try { s.markModified('mcg'); } catch {}
    await s.save();
    console.log('[mcg][update] apiFlavor=uplicali baseUrl=', s.mcg.baseUrl);
    process.exit(0);
  } catch (e) {
    console.error('Failed to update MCG base/flavor:', e?.message || e);
    process.exit(1);
  }
})();
