#!/usr/bin/env node
import dbManager from '../services/dbManager.js';
import Settings from '../models/Settings.js';

const RAW = '305603169';

function normalize(s) {
  return String(s || '').trim();
}

(async () => {
  try {
    await dbManager.connectWithRetry();
    let s = await Settings.findOne();
    if (!s) s = new Settings();
    s.mcg = s.mcg || {};
    s.mcg.retailerClientId = normalize(RAW);
    try { s.markModified('mcg'); } catch {}
    await s.save();
    console.log('[mcg][retailerClientId] set to', s.mcg.retailerClientId);
    process.exit(0);
  } catch (e) {
    console.error('Failed to set retailerClientId:', e?.message || e);
    process.exit(1);
  }
})();
