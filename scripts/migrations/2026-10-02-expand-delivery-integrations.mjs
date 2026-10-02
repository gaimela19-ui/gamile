import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import mongoose from 'mongoose';
import dbManager from '../../services/dbManager.js';

export function inferProviderType(company = {}) {
  if (company.providerType) return company.providerType;
  const integrationIdentity = [company.name, company.code, company.apiUrl, company.apiConfiguration?.baseUrl].filter(Boolean).join(' ');
  return /olivery|odoo/i.test(integrationIdentity) ? 'olivery' : 'legacy';
}

export function withLegacyIntegrationDefaults(apiConfiguration, providerType = 'legacy') {
  const existingConfiguration = apiConfiguration && typeof apiConfiguration === 'object' && !Array.isArray(apiConfiguration)
    ? apiConfiguration
    : {};
  const existingIntegration = existingConfiguration.integration && typeof existingConfiguration.integration === 'object'
    ? existingConfiguration.integration
    : {};
  const integration = {
    adapter: existingIntegration.adapter || (providerType === 'olivery' ? 'olivery' : 'legacy'),
    engineEnabled: existingIntegration.engineEnabled ?? providerType === 'olivery',
    executionMode: existingIntegration.executionMode || (providerType === 'olivery' ? 'generic' : 'auto'),
    fallbackOnPreDispatchFailure: existingIntegration.fallbackOnPreDispatchFailure ?? false,
    sendEndpointName: existingIntegration.sendEndpointName || 'createShipment',
    environment: existingIntegration.environment || (existingConfiguration.isTestMode === true ? 'test' : 'production'),
    endpoints: existingIntegration.endpoints ?? {},
    authentication: {
      type: 'legacy',
      placement: 'header',
      ...(existingIntegration.authentication || {}),
    },
    requestMapping: existingIntegration.requestMapping ?? {},
    responseMapping: existingIntegration.responseMapping ?? {},
    webhook: {
      enabled: false,
      signatureHeader: 'x-signature',
      signatureAlgorithm: 'sha256',
      ...(existingIntegration.webhook || {}),
    },
  };

  return {
    ...existingConfiguration,
    integration,
  };
}

async function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const DeliveryCompany = (await import(pathToFileURL(path.join(projectRoot, 'server/models/DeliveryCompany.js')).href)).default;
  const DeliveryIntegrationEndpoint = (await import(pathToFileURL(path.join(projectRoot, 'server/models/DeliveryIntegrationEndpoint.js')).href)).default;
  await dbManager.connectWithRetry();

  let modified = 0;
  let endpointsEnsured = 0;
  const cursor = DeliveryCompany.collection.find({});
  for await (const company of cursor) {
    const providerType = inferProviderType(company);
    const updatedConfiguration = withLegacyIntegrationDefaults(company.apiConfiguration, providerType);
    const set = {};
    if (!company.providerType) set.providerType = providerType;
    if (!company.apiConfiguration || typeof company.apiConfiguration !== 'object' || Array.isArray(company.apiConfiguration)) {
      set.apiConfiguration = updatedConfiguration;
    } else if (!company.apiConfiguration.integration || company.apiConfiguration.integration.engineEnabled == null ||
      !company.apiConfiguration.integration.executionMode ||
      !company.apiConfiguration.integration.sendEndpointName || !company.apiConfiguration.integration.environment) {
      set['apiConfiguration.integration'] = updatedConfiguration.integration;
    }
    if (Object.keys(set).length) {
      const result = await DeliveryCompany.collection.updateOne({ _id: company._id }, { $set: set });
      modified += result.modifiedCount;
    }

    if (providerType === 'olivery') {
      const apiConfiguration = company.apiConfiguration || {};
      const url = company.apiUrl || apiConfiguration.baseUrl || process.env.DELIVERY_HUB_BASE_URL || '';
      if (url) {
        const format = apiConfiguration.format || company.apiFormat || process.env.DELIVERY_HUB_FORMAT || 'rest';
        const responseMapping = format === 'jsonrpc'
          ? {
              shipmentId: ['result.shipmentId', 'result.shipment_id', 'result.id'],
              externalId: ['result.externalId', 'result.external_id', 'result.id'],
              trackingNumber: ['result.trackingNumber', 'result.tracking_id', 'result.reference', 'result.reference_id', 'result.id'],
              status: ['result.deliveryStatus', 'result.status', 'result.current_status', 'result.state'],
            }
          : {
              shipmentId: ['shipmentId', 'shipment_id', 'id'],
              externalId: ['externalId', 'external_id', 'id'],
              trackingNumber: ['trackingNumber', 'tracking_id', 'trackingId', 'reference', 'reference_id', 'order_id', 'id'],
              status: ['deliveryStatus', 'status', 'current_status', 'state'],
            };
        await DeliveryIntegrationEndpoint.updateOne({ integration: company._id, name: 'createShipment' }, {
          $setOnInsert: {
            integration: company._id,
            name: 'createShipment',
            method: 'POST',
            url,
            path: '',
            requestBody: {},
            timeoutMs: Number(apiConfiguration.timeoutMs) || 15000,
            retry: { attempts: 0 },
            responseMapping,
            isActive: true,
          },
        }, { upsert: true });
        endpointsEnsured += 1;
      }
    }
  }

  console.log(JSON.stringify({ ok: true, modified, endpointsEnsured }, null, 2));
  await mongoose.disconnect();
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(async (error) => {
    console.error('[delivery-integration-migration] Failed:', error?.message || error);
    try { await mongoose.disconnect(); } catch {}
    process.exitCode = 1;
  });
}