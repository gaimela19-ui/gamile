import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import DeliveryCompany from './DeliveryCompany.js';
import DeliveryIntegrationEndpoint from './DeliveryIntegrationEndpoint.js';
import DeliveryShipment from './DeliveryShipment.js';
import DeliveryIntegrationLog from './DeliveryIntegrationLog.js';
import { inferProviderType, withLegacyIntegrationDefaults } from '../scripts/migrations/2026-10-02-expand-delivery-integrations.mjs';
import { sanitizeDeliveryCompany, sanitizeDeliverySecrets } from '../utils/sanitizeDeliverySecrets.js';
import { mergePreservingDeliverySecrets } from '../utils/mergeDeliverySecrets.js';
import { mapStatus, sendToCompany } from '../services/deliveryIntegrationService.js';

test('legacy Olivery configuration remains valid and uses the compatibility adapter', () => {
  const company = new DeliveryCompany({
    name: 'Olivery legacy',
    apiUrl: 'https://olivery.example/api',
    apiFormat: 'jsonrpc',
    credentials: { login: 'merchant', password: 'secret', database: 'store' },
    apiConfiguration: {
      baseUrl: 'https://olivery.example/api',
      format: 'jsonrpc',
      params: { db: 'store' },
      credentialsInParams: true,
    },
    fieldMappings: [{ sourceField: 'orderNumber', targetField: 'reference' }],
    statusMapping: [{ companyStatus: 'done', internalStatus: 'delivered' }],
  });

  assert.equal(company.validateSync(), undefined);
  assert.equal(company.providerType, 'olivery');
  assert.equal(company.enabled, true);
  assert.equal(company.apiConfiguration.integration.adapter, 'legacy');
  assert.equal(company.apiConfiguration.baseUrl, 'https://olivery.example/api');
  assert.equal(company.apiConfiguration.format, 'jsonrpc');
  assert.equal(company.apiConfiguration.params.db, 'store');
  assert.equal(company.apiConfiguration.credentialsInParams, true);
  assert.equal(company.fieldMappings[0].targetField, 'reference');
  assert.equal(company.statusMapping[0].internalStatus, 'delivered');
});

test('generic integration config supports operation endpoints, auth, mappings, and webhooks', () => {
  const company = new DeliveryCompany({
    name: 'Generic carrier',
    apiConfiguration: {
      integration: {
        adapter: 'raseel',
        endpoints: {
          createOrder: {
            url: 'https://carrier.example/orders',
            method: 'PUT',
            requestMapping: { orderNumber: 'reference' },
            responseMapping: { trackingNumber: 'data.tracking' },
          },
        },
        authentication: {
          type: 'oauth2',
          tokenUrl: 'https://carrier.example/token',
          tokenResponsePath: 'access_token',
        },
        requestMapping: { orderNumber: 'reference' },
        responseMapping: { trackingNumber: 'tracking' },
        webhook: {
          enabled: true,
          signatureHeader: 'x-carrier-signature',
          eventIdPath: 'event.id',
          statusPath: 'event.status',
        },
      },
    },
  });

  assert.equal(company.validateSync(), undefined);
  assert.equal(company.apiConfiguration.integration.adapter, 'raseel');
  assert.equal(company.apiConfiguration.integration.endpoints.get('createOrder').method, 'PUT');
  assert.equal(company.apiConfiguration.integration.authentication.type, 'oauth2');
  assert.equal(company.apiConfiguration.integration.webhook.enabled, true);
  assert.equal(company.statusMapping.length, 0);
  assert.equal(company.providerType, 'legacy');
});

test('migration adds legacy defaults without replacing existing API settings', () => {
  const migrated = withLegacyIntegrationDefaults({
    baseUrl: 'https://olivery.example/api',
    format: 'jsonrpc',
    params: { db: 'store' },
    integration: undefined,
  }, inferProviderType({ apiUrl: 'https://olivery.example/api' }));

  assert.equal(migrated.baseUrl, 'https://olivery.example/api');
  assert.equal(migrated.format, 'jsonrpc');
  assert.deepEqual(migrated.params, { db: 'store' });
  assert.equal(migrated.integration.adapter, 'olivery');
    assert.equal(migrated.integration.engineEnabled, true);
    assert.equal(migrated.integration.sendEndpointName, 'createShipment');
  assert.equal(migrated.integration.environment, 'production');
  assert.deepEqual(migrated.integration.endpoints, {});
  assert.equal(migrated.integration.authentication.type, 'legacy');
  assert.equal(migrated.integration.webhook.enabled, false);
  assert.equal(inferProviderType({ apiUrl: 'https://carrier.example/api' }), 'legacy');
  assert.equal(inferProviderType({ name: 'Olivery Custom', apiUrl: 'https://carrier.example/api' }), 'olivery');

  const partial = withLegacyIntegrationDefaults({
    isTestMode: true,
    integration: {
      adapter: 'custom-adapter',
      authentication: { type: 'bearer' },
      webhook: { enabled: true, secret: 'existing-secret' },
    },
  }, 'custom-provider');
  assert.equal(partial.integration.adapter, 'custom-adapter');
    assert.equal(partial.integration.engineEnabled, false);
  assert.equal(partial.integration.environment, 'test');
  assert.equal(partial.integration.authentication.type, 'bearer');
  assert.equal(partial.integration.authentication.placement, 'header');
  assert.equal(partial.integration.webhook.enabled, true);
  assert.equal(partial.integration.webhook.secret, 'existing-secret');
  assert.equal(inferProviderType({ providerType: 'custom-provider', apiUrl: 'https://olivery.example/api' }), 'custom-provider');

  const oldDisabledDefault = withLegacyIntegrationDefaults({
    integration: { engineEnabled: false },
  }, 'olivery');
  assert.equal(oldDisabledDefault.integration.engineEnabled, false);
  assert.equal(oldDisabledDefault.integration.executionMode, 'generic');
});

test('endpoint, shipment, and integration log models reference existing records', () => {
  const id = new DeliveryCompany()._id;
  const endpoint = new DeliveryIntegrationEndpoint({
    integration: id,
    name: 'createShipment',
    operation: 'shipment.create',
    code: 'CREATE_SHIPMENT',
    path: '/shipments',
    method: 'post',
    requestContentType: 'application/vnd.test+json',
    authentication: { type: 'apiKey', placement: 'header', name: 'x-test-key' },
    retry: { attempts: 2 },
    statusMapping: [{ companyStatus: 'QUEUED', internalStatus: 'PENDING' }],
    safeForTesting: true,
  });
  const shipment = new DeliveryShipment({
    order: id,
    integration: id,
    externalShipmentId: 'external-1',
    trackingNumber: 'track-1',
    externalStatus: 'accepted',
    normalizedStatus: 'assigned',
    shippingCost: 4,
    codAmount: 20,
  });
  const log = new DeliveryIntegrationLog({
    integration: id,
    order: id,
    shipment: id,
    endpoint: endpoint._id,
    responseStatus: 201,
    requestId: 'request-1',
    responseId: 'response-1',
  });

  assert.equal(endpoint.validateSync(), undefined);
  assert.equal(endpoint.method, 'POST');
  assert.equal(endpoint.operation, 'shipment.create');
  assert.equal(endpoint.requestContentType, 'application/vnd.test+json');
  assert.equal(endpoint.authentication.type, 'apiKey');
  assert.equal(endpoint.safeForTesting, true);
  assert.equal(shipment.validateSync(), undefined);
  assert.equal(log.validateSync(), undefined);
});

test('delivery API serialization removes stored secrets from company and order data', () => {
  const company = new DeliveryCompany({
    name: 'Olivery',
    credentials: { login: 'merchant', password: 'secret', database: 'store' },
    apiConfiguration: {
      apiKey: 'api-key',
      headers: { Authorization: 'Bearer secret' },
      integration: {
        authentication: { credentials: { accessToken: 'access-token' } },
        webhook: { secret: 'webhook-secret' },
      },
    },
  });
  const safe = sanitizeDeliveryCompany(company);
  const safeOrder = sanitizeDeliverySecrets({ deliveryResponse: { password: 'echoed-secret', status: 'created' } });

  assert.equal(safe.name, 'Olivery');
  assert.equal('credentials' in safe, false);
  assert.equal('apiKey' in safe.apiConfiguration, false);
  assert.equal('headers' in safe.apiConfiguration, false);
  assert.equal('credentials' in safe.apiConfiguration.integration.authentication, false);
  assert.equal('secret' in safe.apiConfiguration.integration.webhook, false);
  assert.deepEqual(safeOrder, { deliveryResponse: { status: 'created' } });
});

test('legacy editor updates preserve stored values when secrets are blank or marked for removal', () => {
  const merged = mergePreservingDeliverySecrets({
    credentials: { login: 'merchant', password: 'secret', database: 'store' },
    baseUrl: 'https://olivery.example/api',
    params: { db: 'store' },
    integration: { authentication: { credentials: { accessToken: 'access-token' } } },
  }, {
    credentials: { login: '__REMOVE__', password: '', database: '__REMOVE__' },
    baseUrl: 'https://olivery.example/new-api',
    params: {},
    integration: { authentication: { credentials: { accessToken: '' } } },
  });

  assert.deepEqual(merged.credentials, { login: 'merchant', password: 'secret', database: 'store' });
  assert.equal(merged.baseUrl, 'https://olivery.example/new-api');
  assert.deepEqual(merged.params, { db: 'store' });
  assert.equal(merged.integration.authentication.credentials.accessToken, 'access-token');
});

test('existing Olivery-compatible JSON-RPC dispatch still maps requests and responses', async () => {
  let receivedBody;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ result: { trackingNumber: 'track-legacy-1', status: 'accepted' } }));
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { port } = server.address();
    const company = new DeliveryCompany({
      name: 'Olivery dispatch test',
      providerType: 'olivery',
      apiUrl: `http://127.0.0.1:${port}/olivery/jsonrpc`,
      apiFormat: 'jsonrpc',
      credentials: { login: 'merchant', password: 'pass-value', database: 'store-db' },
      apiConfiguration: {
        baseUrl: `http://127.0.0.1:${port}/olivery/jsonrpc`,
        format: 'jsonrpc',
        method: 'create_order',
        params: { db: 'store-db' },
        requiredParams: ['db'],
        credentialsInParams: true,
          integration: { executionMode: 'legacy' },
      },
      fieldMappings: [
        { sourceField: 'orderNumber', targetField: 'reference', required: true },
        { sourceField: 'customerInfo.mobile', targetField: 'phone', transform: 'phone_digits' },
      ],
      statusMapping: [{ companyStatus: 'accepted', internalStatus: 'assigned' }],
    });
    const result = await sendToCompany({
      orderNumber: 'ORD-100',
      customerInfo: { mobile: '+1 (555) 010-1000' },
    }, company.toObject());

    assert.equal(receivedBody.method, 'create_order');
    assert.equal(receivedBody.params.db, 'store-db');
    assert.equal(receivedBody.params.username, 'merchant');
    assert.equal(receivedBody.params.password, 'pass-value');
    assert.equal(receivedBody.params.reference, 'ORD-100');
    assert.equal(receivedBody.params.phone, '15550101000');
    assert.equal(result.trackingNumber, 'track-legacy-1');
    assert.equal(mapStatus(company, result.providerStatus), 'assigned');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('opt-in Olivery adapter executes through the generic engine with the legacy JSON-RPC envelope', async () => {
  let receivedBody;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ result: { trackingNumber: 'track-engine-1', status: 'accepted' } }));
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/olivery/jsonrpc`;
    const company = new DeliveryCompany({
      name: 'Olivery engine test',
      providerType: 'olivery',
      apiUrl: url,
      apiFormat: 'jsonrpc',
      credentials: { login: 'merchant', password: 'pass-value', database: 'store-db' },
      apiConfiguration: {
        baseUrl: url,
        format: 'jsonrpc',
        method: 'create_order',
        params: { db: 'store-db' },
        credentialsInParams: true,
        integration: { adapter: 'olivery' },
      },
      fieldMappings: [{ sourceField: 'orderNumber', targetField: 'reference', required: true }],
    });
    const result = await sendToCompany({ orderNumber: 'ORD-ENGINE-1' }, company.toObject(), {
      engineOptions: {
        allowPrivateNetwork: true,
        logModel: false,
        endpoint: { name: 'createShipment', url, responseMapping: {} },
      },
    });

    assert.equal(receivedBody.jsonrpc, '2.0');
    assert.equal(receivedBody.method, 'create_order');
    assert.equal(receivedBody.params.db, 'store-db');
    assert.equal(receivedBody.params.username, 'merchant');
    assert.equal(receivedBody.params.password, 'pass-value');
    assert.equal(receivedBody.params.reference, 'ORD-ENGINE-1');
    assert.equal(result.trackingNumber, 'track-engine-1');
    assert.equal(result.providerStatus, 'accepted');
    assert.equal(mapStatus(company, result.providerStatus), 'assigned');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Olivery generic-engine failure before dispatch safely uses the configured legacy fallback', async () => {
  let hits = 0;
  let receivedBody;
  const server = createServer((request, response) => {
    hits += 1;
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ result: { trackingNumber: 'track-fallback-1', status: 'created' } }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/olivery/jsonrpc`;
    const company = new DeliveryCompany({
      name: 'Olivery safe fallback test',
      providerType: 'olivery',
      apiUrl: url,
      apiFormat: 'jsonrpc',
      credentials: { login: 'merchant', password: 'pass-value', database: 'store-db' },
      apiConfiguration: {
        baseUrl: url,
        format: 'jsonrpc',
        method: 'create_order',
        params: { db: 'store-db' },
        credentialsInParams: true,
        integration: {
          executionMode: 'generic',
          fallbackOnPreDispatchFailure: true,
          authentication: { type: 'oauth2' },
        },
      },
      fieldMappings: [{ sourceField: 'orderNumber', targetField: 'reference', required: true }],
    });

    const result = await sendToCompany({ orderNumber: 'ORD-FALLBACK-1' }, company.toObject(), {
      engineOptions: {
        allowPrivateNetwork: true,
        logModel: false,
        endpoint: { name: 'createShipment', url, responseMapping: {} },
      },
    });

    assert.equal(hits, 1);
    assert.equal(receivedBody.method, 'create_order');
    assert.equal(result.trackingNumber, 'track-fallback-1');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('DELIVERY_OLIVERY_ENGINE_MODE=legacy forces the existing implementation', async () => {
  let receivedBody;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ result: { trackingNumber: 'track-env-rollback', status: 'created' } }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const previousMode = process.env.DELIVERY_OLIVERY_ENGINE_MODE;
  try {
    process.env.DELIVERY_OLIVERY_ENGINE_MODE = 'legacy';
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/olivery/jsonrpc`;
    const company = new DeliveryCompany({
      name: 'Olivery environment rollback test',
      providerType: 'olivery',
      apiUrl: url,
      apiFormat: 'jsonrpc',
      credentials: { login: 'merchant', password: 'pass-value', database: 'store-db' },
      apiConfiguration: {
        baseUrl: url,
        format: 'jsonrpc',
        method: 'create_order',
        params: { db: 'store-db' },
        credentialsInParams: true,
        integration: { executionMode: 'generic' },
      },
      fieldMappings: [{ sourceField: 'orderNumber', targetField: 'reference', required: true }],
    });
    const result = await sendToCompany({ orderNumber: 'ORD-ENV-ROLLBACK' }, company.toObject());

    assert.equal(receivedBody.jsonrpc, '2.0');
    assert.equal(result.trackingNumber, 'track-env-rollback');
  } finally {
    if (previousMode === undefined) delete process.env.DELIVERY_OLIVERY_ENGINE_MODE;
    else process.env.DELIVERY_OLIVERY_ENGINE_MODE = previousMode;
    await new Promise(resolve => server.close(resolve));
  }
});

test('Olivery does not automatically fall back after an HTTP request was dispatched', async () => {
  let hits = 0;
  const server = createServer((_request, response) => {
    hits += 1;
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end('{"message":"temporary provider failure"}');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/olivery/jsonrpc`;
    const company = new DeliveryCompany({
      name: 'Olivery dispatched failure test',
      providerType: 'olivery',
      apiUrl: url,
      apiFormat: 'jsonrpc',
      credentials: { login: 'merchant', password: 'pass-value', database: 'store-db' },
      apiConfiguration: {
        baseUrl: url,
        format: 'jsonrpc',
        method: 'create_order',
        params: { db: 'store-db' },
        credentialsInParams: true,
        integration: {
          executionMode: 'generic',
          fallbackOnPreDispatchFailure: true,
        },
      },
      fieldMappings: [{ sourceField: 'orderNumber', targetField: 'reference', required: true }],
    });

    await assert.rejects(sendToCompany({ orderNumber: 'ORD-FAILED-1' }, company.toObject(), {
      engineOptions: {
        allowPrivateNetwork: true,
        logModel: false,
        endpoint: { name: 'createShipment', url, responseMapping: {} },
      },
    }), error => error.code === 'DELIVERY_API_REQUEST_FAILED');

    assert.equal(hits, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Olivery adapter preserves REST-to-JSON-RPC auto-detection', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({ method: request.method, body });
      if (requests.length === 1) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 1, message: 'jsonrpc endpoint required' } }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ result: { trackingNumber: 'track-fallback-rpc', status: 'created' } }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/olivery/jsonrpc`;
    const company = new DeliveryCompany({
      name: 'Olivery REST detection test',
      providerType: 'olivery',
      apiUrl: url,
      apiFormat: 'rest',
      credentials: { login: 'merchant', password: 'pass-value', database: 'store-db' },
      apiConfiguration: {
        baseUrl: url,
        format: 'rest',
        method: 'create_order',
        params: { db: 'store-db' },
        credentialsInParams: true,
        integration: { executionMode: 'generic' },
      },
      fieldMappings: [{ sourceField: 'orderNumber', targetField: 'reference', required: true }],
    });
    const result = await sendToCompany({ orderNumber: 'ORD-REST-DETECT' }, company.toObject(), {
      engineOptions: {
        allowPrivateNetwork: true,
        logModel: false,
        endpoint: { name: 'createShipment', url, responseMapping: {} },
      },
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].body.reference, 'ORD-REST-DETECT');
    assert.equal(requests[1].body.jsonrpc, '2.0');
    assert.equal(requests[1].body.method, 'create_order');
    assert.equal(result.trackingNumber, 'track-fallback-rpc');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Olivery adapter preserves provider error format without exposing secrets', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 23, message: 'bad pass-value' } }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/olivery/jsonrpc`;
    const company = new DeliveryCompany({
      name: 'Olivery provider error test',
      providerType: 'olivery',
      apiUrl: url,
      apiFormat: 'jsonrpc',
      credentials: { login: 'merchant', password: 'pass-value', database: 'store-db' },
      apiConfiguration: {
        baseUrl: url,
        format: 'jsonrpc',
        method: 'create_order',
        params: { db: 'store-db' },
        credentialsInParams: true,
        integration: { executionMode: 'generic' },
      },
      fieldMappings: [{ sourceField: 'orderNumber', targetField: 'reference', required: true }],
    });

    await assert.rejects(sendToCompany({ orderNumber: 'ORD-PROVIDER-ERROR' }, company.toObject(), {
      engineOptions: {
        allowPrivateNetwork: true,
        logModel: false,
        endpoint: { name: 'createShipment', url, responseMapping: {} },
      },
    }), error => {
      assert.equal(error.code, 'DELIVERY_API_REQUEST_FAILED');
      assert.equal(error.details.message, 'Provider error (23): bad [REDACTED]');
      assert.doesNotMatch(error.details.message, /pass-value/);
      return true;
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('baseUrl/provider aliases use existing apiUrl/providerType storage', () => {
  const company = new DeliveryCompany({ name: 'Alias Carrier', provider: 'carrier-x', baseUrl: 'https://carrier.example/api' });
  assert.equal(company.providerType, 'carrier-x');
  assert.equal(company.apiUrl, 'https://carrier.example/api');
  assert.equal(company.provider, 'carrier-x');
  assert.equal(company.baseUrl, 'https://carrier.example/api');
});