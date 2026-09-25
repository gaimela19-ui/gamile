#!/usr/bin/env node
import dbManager from '../services/dbManager.js';
import Settings from '../models/Settings.js';

(async () => {
  try {
    await dbManager.connectWithRetry();
    let s = await Settings.findOne();
    if (!s) s = new Settings();
    s.mcg = s.mcg || {};
    s.mcg.tokenUrl = 'https://login.uplicali.com/mcg';
    // Clear malformed scope to avoid token endpoint 400s
    s.mcg.scope = '';
    s.mcg.enabled = true;
    try { s.markModified('mcg'); } catch {}
    await s.save();
    console.log('[mcg][tokenUrl] set to', s.mcg.tokenUrl, 'scope cleared');
    process.exit(0);
  } catch (e) {
    console.error('Failed to set tokenUrl/scope:', e?.message || e);
    process.exit(1);
  }
})();
