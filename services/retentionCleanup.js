import SearchLog from '../models/SearchLog.js';
import PushLog from '../models/PushLog.js';
import PushOpen from '../models/PushOpen.js';
import WhatsAppAudit from '../models/WhatsAppAudit.js';
import Translation from '../models/Translation.js';

function parseDays(value, fallback) {
  const num = Number(value ?? fallback);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return num;
}

export function buildRetentionConfig(options = {}) {
  const env = options.env || process.env;
  const buildSpec = (days, model, field) => ({
    days,
    ms: days * 24 * 60 * 60 * 1000,
    model,
    field,
  });

  return {
    searchLog: buildSpec(parseDays(env.SEARCH_LOG_RETENTION_DAYS, 365), SearchLog, 'createdAt'),
    pushLog: buildSpec(parseDays(env.PUSH_LOG_RETENTION_DAYS, 180), PushLog, 'sentAt'),
    pushOpen: buildSpec(parseDays(env.PUSH_OPEN_RETENTION_DAYS, 180), PushOpen, 'openedAt'),
    whatsappAudit: buildSpec(parseDays(env.WHATSAPP_AUDIT_RETENTION_DAYS, 180), WhatsAppAudit, 'createdAt'),
    translation: buildSpec(parseDays(env.TRANSLATION_RETENTION_DAYS, 180), Translation, 'createdAt'),
  };
}

export async function pruneExpiredData(reason = 'manual', options = {}) {
  const config = buildRetentionConfig(options);
  const results = [];
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000 * config.searchLog.days);
  const cutoffByCollection = {};

  for (const [key, spec] of Object.entries(config)) {
    const days = spec.days;
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000 * days);
    cutoffByCollection[key] = cutoffDate;
  }

  for (const [key, spec] of Object.entries(config)) {
    try {
      const model = spec.model;
      const field = spec.field;
      const cutoffDate = cutoffByCollection[key];
      const filter = { [field]: { $lt: cutoffDate } };
      const res = await model.deleteMany(filter);
      const deleted = res?.deletedCount || 0;
      results.push({ key, deleted, cutoff: cutoffDate.toISOString() });
    } catch (error) {
      results.push({ key, deleted: 0, error: error?.message || String(error) });
    }
  }

  if (results.some((entry) => (entry.deleted || 0) > 0)) {
    console.log(`[retention] cleanup(${reason})`, results);
  }

  return results;
}

export function startRetentionCleanup(intervalMs = 1000 * 60 * 60) {
  const timer = setInterval(() => {
    pruneExpiredData('scheduled').catch((error) => {
      console.warn('[retention] cleanup failed', error?.message || error);
    });
  }, intervalMs);

  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}
