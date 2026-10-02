import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  testConfiguredDeliveryEndpoint,
  validateDeliveryIntegrationConfiguration,
} from './deliveryIntegrationConfiguration.js';

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function validIntegration(baseUrl) {
  return {
    _id: '64b000000000000000000011',
    name: 'Config validation example',
    providerType: 'generic',
    isActive: true,
    apiUrl: baseUrl,
    credentials: {},
    statusMapping: [{ companyStatus: 'moving', internalStatus: 'IN_TRANSIT' }],
    apiConfiguration: {
      integration: {
        executionMode: 'generic',
        authentication: { type: 'bearer', credentials: { token: 'validation-token' } },
      },
    },
  };
}

test('validates base URL, endpoint, request/response mappings, auth, and statuses', async () => {
  await withServer((_request, response) => response.end('{}'), async baseUrl => {
    const result = validateDeliveryIntegrationConfiguration(validIntegration(baseUrl), [{
      name: 'createShipment',
      operation: 'create',
      method: 'POST',
      path: '/shipments',
      requiresRequestBody: true,
      requestBody: { reference: '{{order.sequence}}' },
      requiresResponseMapping: true,
      responseMapping: { trackingNumber: 'data.trackingNumber' },
    }]);
    assert.deepEqual(result, { valid: true, errors: [] });
  });
});

test('rejects activation when required endpoint, authentication, or mappings are missing', () => {
  const integration = validIntegration('');
  integration.apiConfiguration.integration.authentication = { type: 'apiKey', placement: 'header' };
  const result = validateDeliveryIntegrationConfiguration(integration, [{
    name: 'createShipment',
    method: 'TRACE',
    requiresRequestBody: true,
    requestBody: {},
    requiresResponseMapping: true,
    responseMapping: {},
    statusMapping: [{ companyStatus: 'DONE', internalStatus: 'EXECUTED_CODE' }],
  }]);

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /base URL/);
  assert.match(result.errors.join(' '), /unsupported HTTP method/);
  assert.match(result.errors.join(' '), /path or URL/);
  assert.match(result.errors.join(' '), /API key authentication/);
  assert.match(result.errors.join(' '), /request body\/template/);
  assert.match(result.errors.join(' '), /response mapping/);
  assert.match(result.errors.join(' '), /internal status/);
});

test('validates request templates against the approved variable and transform set', async () => {
  await withServer((_request, response) => response.end('{}'), async baseUrl => {
    const result = validateDeliveryIntegrationConfiguration(validIntegration(baseUrl), [{
      name: 'createShipment',
      method: 'POST',
      path: '/shipments',
      requiresRequestBody: true,
      requestBody: { value: '{{order.customerInfo.password}}' },
    }]);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /Unsupported template variable/);
  });
});

test('test endpoint defaults to sanitized dry-run and refuses unsafe execution', async () => {
  let hits = 0;
  await withServer(async (_request, response) => {
    hits += 1;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{}');
  }, async baseUrl => {
    const integration = validIntegration(baseUrl);
    const endpoint = {
      name: 'createShipment',
      method: 'POST',
      path: '/shipments',
      requestBody: { reference: '{{order.sequence}}' },
      safeForTesting: false,
    };
    const preview = await testConfiguredDeliveryEndpoint({
      integration,
      endpoint,
      sampleData: { orderNumber: 'TEST-1' },
    }, { allowPrivateNetwork: true, logModel: false });

    assert.equal(preview.success, true);
    assert.equal(preview.executed, false);
    assert.equal(preview.request.body.reference, 'TEST-1');
    assert.doesNotMatch(JSON.stringify(preview), /validation-token/);
    assert.equal(hits, 0);

    const refused = await testConfiguredDeliveryEndpoint({
      integration,
      endpoint,
      sampleData: { orderNumber: 'TEST-2' },
      execute: true,
    }, { allowPrivateNetwork: true, logModel: false });
    assert.equal(refused.success, false);
    assert.equal(refused.executed, false);
    assert.equal(hits, 0);
  });
});

test('test endpoint executes only when explicitly requested and marked safe', async () => {
  let hits = 0;
  await withServer(async (_request, response) => {
    hits += 1;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: { tracking: 'mock-track' }, accessToken: 'validation-token' }));
  }, async baseUrl => {
    const result = await testConfiguredDeliveryEndpoint({
      integration: validIntegration(baseUrl),
      endpoint: {
        name: 'safeTestEndpoint',
        method: 'GET',
        path: '/test',
        safeForTesting: true,
        responseMapping: { trackingNumber: 'data.tracking' },
      },
      sampleData: { orderNumber: 'TEST-3' },
      execute: true,
    }, { allowPrivateNetwork: true, logModel: false });

    assert.equal(hits, 1);
    assert.equal(result.success, true);
    assert.equal(result.executed, true);
    assert.equal(result.result.trackingNumber, 'mock-track');
    assert.equal('accessToken' in result.response, false);
    assert.doesNotMatch(JSON.stringify(result), /validation-token/);
  });
});

test('validates generic login-token authentication and protected body variables', async () => {
  await withServer((_request, response) => response.end('{}'), async baseUrl => {
    const integration = validIntegration(baseUrl);
    integration.apiConfiguration.integration.authentication = {
      type: 'oauth2',
      tokenUrl: `${baseUrl}/login`,
      tokenMethod: 'POST',
      tokenRequest: { phone: '{{auth.phone}}', password: '{{auth.password}}' },
      tokenResponsePath: 'data.token',
      credentials: { phone: 'sample-phone', password: 'sample-password' },
    };
    const result = validateDeliveryIntegrationConfiguration(integration, [{
      name: 'createOrder',
      method: 'POST',
      path: '/orders',
      requiresRequestBody: true,
      requestBody: {
        username: '{{auth.phone}}',
        password: '{{auth.password}}',
        reference_id: '{{order.sequence}}',
      },
    }]);

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });
});