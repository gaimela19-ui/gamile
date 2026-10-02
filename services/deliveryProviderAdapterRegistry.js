import {
  canOliveryFallbackToLegacy,
  executeOliveryCompatibilityAdapter,
  getOliveryExecutionMode,
  prepareOliveryLegacyCompany,
} from './deliveryProviderAdapters/oliveryCompatibilityAdapter.js';

const adapters = new Map([
  ['olivery', {
    execute: executeOliveryCompatibilityAdapter,
    getExecutionMode: getOliveryExecutionMode,
    prepareLegacyCompany: prepareOliveryLegacyCompany,
    canFallbackToLegacy: canOliveryFallbackToLegacy,
  }],
]);

export function getRegisteredDeliveryAdapter(integration) {
  const providerType = String(integration?.providerType || '').trim().toLowerCase();
  return adapters.get(providerType) || null;
}

export async function executeRegisteredDeliveryAdapter(args) {
  const adapter = getRegisteredDeliveryAdapter(args.company);
  return adapter ? adapter.execute(args) : null;
}