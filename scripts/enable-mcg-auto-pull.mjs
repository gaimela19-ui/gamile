#!/usr/bin/env node
// Enable and configure automatic MCG pull (and optional auto-create) in DB settings.
// Usage examples:
//   node project/server/scripts/enable-mcg-auto-pull.mjs
//   node project/server/scripts/enable-mcg-auto-pull.mjs --minutes 5 --auto-create true
// Env override:
//   MCG_PULL_MINUTES=10 node project/server/scripts/enable-mcg-auto-pull.mjs

import dbManager from '../services/dbManager.js';
import Settings from '../models/Settings.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { minutes: undefined, autoCreate: undefined };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--minutes' && args[i+1]) { out.minutes = Number(args[++i]); continue; }
    if (a === '--auto-create' && args[i+1]) {
      const v = String(args[++i]).toLowerCase();
      out.autoCreate = v === '1' || v === 'true' || v === 'yes';
      continue;
    }
  }
  const envMin = Number(process.env.MCG_PULL_MINUTES);
  if (!Number.isNaN(envMin) && envMin > 0) out.minutes = envMin;
  return out;
}

async function main() {
  const { minutes, autoCreate } = parseArgs();
  await dbManager.connectWithRetry();
  let s = await Settings.findOne();
  if (!s) s = new Settings();
  s.mcg = s.mcg || {};
  // Enable MCG and auto pull
  s.mcg.enabled = true;
  s.mcg.autoPullEnabled = true;
  if (Number.isFinite(minutes) && minutes > 0) s.mcg.pullEveryMinutes = minutes;
  if (typeof autoCreate === 'boolean') s.mcg.autoCreateItemsEnabled = autoCreate;
  try { s.markModified('mcg'); } catch {}
  await s.save();

  const out = {
    enabled: !!s.mcg.enabled,
    autoPullEnabled: !!s.mcg.autoPullEnabled,
    pullEveryMinutes: s.mcg.pullEveryMinutes ?? '(default=1)',
    autoCreateItemsEnabled: !!s.mcg.autoCreateItemsEnabled
  };
  console.log('[enable-mcg-auto-pull] Updated Settings.mcg:', JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('[enable-mcg-auto-pull] failed:', e?.message || e);
  process.exit(1);
});
