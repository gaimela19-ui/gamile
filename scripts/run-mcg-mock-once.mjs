import path from 'path';
import { pathToFileURL } from 'url';

const root = path.resolve('project/server');
const url = (p) => pathToFileURL(path.join(root, p)).href;

const { default: mongoose } = await import(url('../server/node_modules/mongoose/index.js')).catch(() => ({ default: null }));
const { default: Settings } = await import(url('models/Settings.js'));
const db = (await import(url('services/dbManager.js'))).default;
const { runMcgSyncOnce } = await import(url('services/mcgSyncScheduler.js'));

try {
  await db.connectWithRetry();
  let s = await Settings.findOne();
  if (!s) s = await Settings.create({});
  s.mcg = s.mcg || {};
  s.mcg.enabled = true;
  s.mcg.autoPullEnabled = true;
  s.mcg.pullEveryMinutes = 1;
  s.mcg.autoCreateItemsEnabled = true;
  s.mcg.autoPullAllPages = true;
  await s.save();
  console.log('[test] Settings.mcg enabled for test');
  await runMcgSyncOnce();
  console.log('[test] runMcgSyncOnce finished');
} catch (e) {
  console.error('err', e?.message || e);
} finally {
  try { await mongoose.disconnect(); } catch {}
}
