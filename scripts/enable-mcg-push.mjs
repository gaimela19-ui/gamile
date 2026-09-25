#!/usr/bin/env node
/*
  Enable MCG stock push-back on order create.
  - Sets Settings.mcg.enabled = true (does not change clientId/secret/baseUrl)
  - Sets Settings.mcg.pushStockBackEnabled = true
  - Ensures Settings.inventory.reserveOnCheckout = true and autoDecrementOnOrder = true

  Requires:
  - project/.env with MONGODB_URI
*/

import mongoose from 'mongoose';
import Settings from '../models/Settings.js';
import { connectWithRetry } from '../services/dbManager.js';

(async () => {
  try {
    await connectWithRetry(5);
    let s = await Settings.findOne();
    if (!s) s = await Settings.create({});

    s.mcg = s.mcg || {};
    s.mcg.enabled = true;
    s.mcg.pushStockBackEnabled = true;
    try { s.markModified('mcg'); } catch {}

    s.inventory = s.inventory || {};
    s.inventory.reserveOnCheckout = true;
    s.inventory.autoDecrementOnOrder = true;
    try { s.markModified('inventory'); } catch {}

    await s.save();
    console.log('[enable-mcg-push] Updated Settings:', {
      mcgEnabled: s.mcg.enabled,
      pushStockBackEnabled: s.mcg.pushStockBackEnabled,
      reserveOnCheckout: s.inventory.reserveOnCheckout,
      autoDecrementOnOrder: s.inventory.autoDecrementOnOrder
    });
  } catch (e) {
    console.error('[enable-mcg-push] Failed:', e?.message || e);
    process.exitCode = 1;
  } finally {
    try { await mongoose.disconnect(); } catch {}
  }
})();
