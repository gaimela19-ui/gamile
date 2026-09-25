#!/usr/bin/env node
// One-off execution of the MCG auto-pull logic (same as /api/mcg/auto-sync/run-now)
// Usage: MONGODB_URI=... node project/server/scripts/mcg-run-once.mjs
// Optionally set MCG_AUTO_PULL=true to force run even if autoPullEnabled=false in settings.

import dbManager from '../services/dbManager.js';
import { runMcgSyncOnce } from '../services/mcgSyncScheduler.js';
import Settings from '../models/Settings.js';

(async () => {
  try {
    await dbManager.connectWithRetry();
    const s = await Settings.findOne();
    if (!s?.mcg?.enabled) {
      console.error('[mcg][run-once] aborted: mcg.enabled is false. Enable via PUT /api/mcg/config { "enabled": true }');
      process.exit(2);
      return;
    }
    console.log('[mcg][run-once] starting single auto-pull run...');
    const start = Date.now();
    await runMcgSyncOnce();
    console.log('[mcg][run-once] completed in %dms', Date.now() - start);
    process.exit(0);
  } catch (e) {
    console.error('[mcg][run-once][error]', e?.message || e);
    process.exit(1);
  }
})();
