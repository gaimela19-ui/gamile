#!/usr/bin/env node
import dbManager from '../services/dbManager.js';
import { getItemsList, getVersion } from '../services/mcgService.js';

(async () => {
  try {
    await dbManager.connectWithRetry();
    // Optional: try get_ver for Uplîcali
    try {
      const ver = await getVersion().catch(() => null);
      if (ver) console.log('[upli][get_ver]', JSON.stringify(ver));
    } catch {}

    const data = await getItemsList({ PageNumber: 1, PageSize: 1 });
    const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data?.items) ? data.items : []);
    console.log('[mcg][items] total:', data?.TotalCount ?? items.length ?? 0, 'first:', items[0] ? Object.keys(items[0]).slice(0, 6) : null);
    process.exit(0);
  } catch (e) {
    const msg = e?.message || String(e);
    const status = e?.status || e?.response?.status;
    const body = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : '';
    console.error('[mcg][smoke][fail]', status || '', msg, body);
    process.exit(1);
  }
})();
