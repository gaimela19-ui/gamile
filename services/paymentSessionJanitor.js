import PaymentSession from '../models/PaymentSession.js';

const DEFAULT_INTERVAL_MS = Number(process.env.PAYMENT_SESSION_JANITOR_INTERVAL_MS || 1000 * 60 * 30); // 30 minutes
const DEFAULT_RETENTION_MS = Number(process.env.PAYMENT_SESSION_RETENTION_MS || 1000 * 60 * 60 * 24 * 7); // 7 days
const MAX_DOCS = Number(process.env.PAYMENT_SESSION_MAX_DOCS || 5000);

let timer = null;
let running = false;

async function runCleanup(reason = 'scheduled') {
  if (running) return;
  running = true;
  try {
    const cutoff = new Date(Date.now() - DEFAULT_RETENTION_MS);
    const expiredRes = await PaymentSession.deleteMany({ createdAt: { $lt: cutoff } });

    let trimmed = 0;
    if (MAX_DOCS > 0) {
      const docCount = await PaymentSession.countDocuments();
      if (docCount > MAX_DOCS) {
        const toRemove = docCount - MAX_DOCS;
        const staleIds = await PaymentSession.find({}, { _id: 1 })
          .sort({ createdAt: 1 })
          .limit(toRemove)
          .lean();
        const ids = staleIds.map((doc) => doc._id);
        if (ids.length) {
          const overflowRes = await PaymentSession.deleteMany({ _id: { $in: ids } });
          trimmed = overflowRes.deletedCount || 0;
        }
      }
    }

    if ((expiredRes.deletedCount || 0) > 0 || trimmed > 0) {
      console.log(`[paymentSessionJanitor] cleanup(${reason}) removed ${expiredRes.deletedCount || 0} expired + ${trimmed} overflow sessions`);
    }
  } catch (err) {
    console.warn('[paymentSessionJanitor] cleanup failed', err?.message || err);
  } finally {
    running = false;
  }
}

export function startPaymentSessionJanitor() {
  if (timer || process.env.SKIP_DB === '1') return;
  const interval = Math.max(5 * 60 * 1000, DEFAULT_INTERVAL_MS);
  runCleanup('startup').catch((err) => console.warn('[paymentSessionJanitor] initial cleanup failed', err?.message || err));
  timer = setInterval(() => {
    runCleanup('interval').catch((err) => console.warn('[paymentSessionJanitor] scheduled cleanup failed', err?.message || err));
  }, interval);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

export async function cleanupPaymentSessions(reason = 'manual') {
  await runCleanup(reason);
}
