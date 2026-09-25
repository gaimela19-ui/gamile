#!/usr/bin/env node
import dbManager from '../services/dbManager.js';
import Settings from '../models/Settings.js';

const VENDOR_CODE = '638a0dff26ba453692769ac3fc8a597e';

(async () => {
  try {
    await dbManager.connectWithRetry();
    let s = await Settings.findOne();
    if (!s) s = new Settings();
    s.mcg = s.mcg || {};
    s.mcg.vendorCode = VENDOR_CODE.trim();
    try { s.markModified('mcg'); } catch {}
    await s.save();
    console.log('[mcg][vendorCode] set to', s.mcg.vendorCode);
    process.exit(0);
  } catch (e) {
    console.error('Failed to set vendorCode:', e?.message || e);
    process.exit(1);
  }
})();
