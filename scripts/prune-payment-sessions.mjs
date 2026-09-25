import { connectWithRetry } from '../services/dbManager.js';
import { cleanupPaymentSessions } from '../services/paymentSessionJanitor.js';

(async () => {
  try {
    await connectWithRetry();
    await cleanupPaymentSessions('manual-script');
    console.log('[prune-payment-sessions] cleanup completed');
    process.exit(0);
  } catch (err) {
    console.error('[prune-payment-sessions] cleanup failed:', err?.message || err);
    process.exit(1);
  }
})();
