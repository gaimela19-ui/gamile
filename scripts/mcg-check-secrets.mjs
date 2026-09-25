#!/usr/bin/env node
import dbManager from '../services/dbManager.js';
import Settings from '../models/Settings.js';

(async () => {
  try {
    await dbManager.connectWithRetry();
    const s = await Settings.findOne();
    const m = s?.mcg || {};
    const hasId = !!(m.clientId && m.clientId.trim());
    const hasSecret = !!(m.clientSecret && m.clientSecret.trim());
    console.log(JSON.stringify({ hasClientId: hasId, hasClientSecret: hasSecret, scope: m.scope || '', tokenUrl: m.tokenUrl || '' }, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('err', e?.message || e);
    process.exit(1);
  }
})();
