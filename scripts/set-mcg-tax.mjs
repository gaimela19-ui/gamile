#!/usr/bin/env node
import dbManager from '../services/dbManager.js';
import Settings from '../models/Settings.js';
import { normalizeTaxMultiplier, percentToMultiplier, DEFAULT_TAX_MULTIPLIER } from '../utils/mcgTax.js';

function parseArgs(argv) {
  const opts = { percent: 18 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--percent':
      case '--pct':
        if (i + 1 < argv.length) {
          const next = Number(argv[++i]);
          if (Number.isFinite(next)) opts.percent = next;
        }
        break;
      case '--multiplier':
      case '--mul':
        if (i + 1 < argv.length) {
          const next = Number(argv[++i]);
          if (Number.isFinite(next)) {
            opts.multiplier = next;
            delete opts.percent;
          }
        }
        break;
      default:
        break;
    }
  }
  return opts;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  try {
    const multiplier = args.multiplier !== undefined
      ? normalizeTaxMultiplier(args.multiplier, DEFAULT_TAX_MULTIPLIER)
      : percentToMultiplier(args.percent ?? 18, DEFAULT_TAX_MULTIPLIER);

    console.log('[mcg][tax] using multiplier', multiplier.toFixed(4), `(percent ~${((multiplier - 1) * 100).toFixed(2)}%)`);

    await dbManager.connectWithRetry();
    let s = await Settings.findOne();
    if (!s) s = new Settings();
    s.mcg = s.mcg || {};
    s.mcg.taxMultiplier = multiplier;
    try { s.markModified('mcg'); } catch {}
    await s.save();
    console.log('[mcg][tax] Settings.mcg.taxMultiplier updated successfully');
    process.exit(0);
  } catch (err) {
    console.error('[mcg][tax] failed to update tax multiplier:', err?.message || err);
    process.exit(1);
  }
})();
