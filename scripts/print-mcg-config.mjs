#!/usr/bin/env node
import dbManager from '../services/dbManager.js';
import Settings from '../models/Settings.js';

(async () => {
  try {
    await dbManager.connectWithRetry();
    const s = await Settings.findOne();
    const m = s?.mcg || {};
    const out = {
      enabled: !!m.enabled,
      apiFlavor: m.apiFlavor || '',
      baseUrl: m.baseUrl || '',
      tokenUrl: m.tokenUrl || '',
      scope: m.scope || '',
      vendorCode: m.vendorCode || '',
      retailerClientId: m.retailerClientId || '',
      retailerKeyMasked: m.retailerKey ? '***' : '',
      extraHeaderName: m.extraHeaderName || '',
      extraHeaderMasked: m.extraHeaderValue ? '***' : ''
    };
    console.log('[mcg][config]', JSON.stringify(out, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Failed to print MCG config:', e?.message || e);
    process.exit(1);
  }
})();
