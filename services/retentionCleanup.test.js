import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRetentionConfig } from './retentionCleanup.js';

test('buildRetentionConfig uses defaults and env overrides', () => {
  const config = buildRetentionConfig({
    env: {
      SEARCH_LOG_RETENTION_DAYS: '45',
      PUSH_LOG_RETENTION_DAYS: '10',
      PUSH_OPEN_RETENTION_DAYS: '12',
      WHATSAPP_AUDIT_RETENTION_DAYS: '21',
      TRANSLATION_RETENTION_DAYS: '60',
    },
  });

  assert.equal(config.searchLog.days, 45);
  assert.equal(config.pushLog.days, 10);
  assert.equal(config.pushOpen.days, 12);
  assert.equal(config.whatsappAudit.days, 21);
  assert.equal(config.translation.days, 60);
  assert.equal(config.searchLog.ms, 45 * 24 * 60 * 60 * 1000);
});
