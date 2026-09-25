// Diagnostic script to manually trigger one MCG sync run and display settings.
import mongoose from 'mongoose';
import dbManager from '../services/dbManager.js';
import Settings from '../models/Settings.js';
import { runMcgSyncOnce } from '../services/mcgSyncScheduler.js';

async function main() {
  try {
    await dbManager.connectWithRetry();
    const s = await Settings.findOne();
    console.log('[mcg][script] enabled=%s autoPullEnabled=%s pullEveryMinutes=%s', !!s?.mcg?.enabled, !!s?.mcg?.autoPullEnabled, s?.mcg?.pullEveryMinutes);
    if (!s?.mcg?.enabled) {
      console.log('[mcg][script] MCG not enabled. Enable via PUT /api/mcg/config { "enabled": true }');
      return;
    }
    if (!s?.mcg?.autoPullEnabled) {
      console.log('[mcg][script] autoPullEnabled is false. Enable via PUT /api/mcg/config { "autoPullEnabled": true }');
    }
    await runMcgSyncOnce();
    console.log('[mcg][script] Manual run complete. Expect next auto run in ~%d minute(s).', s?.mcg?.pullEveryMinutes || 1);
  } catch (e) {
    console.error('[mcg][script] failed:', e?.message || e);
  } finally {
    try { await mongoose.disconnect(); } catch {}
  }
}

main();