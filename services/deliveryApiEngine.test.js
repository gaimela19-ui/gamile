import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { executeDeliveryEndpoint, makeOrderVariables, normalizeStatus, renderTemplate } from './deliveryApiEngine.js';

async function withHttpServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function readJsonRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : null); } catch (error) { reject(error); }
    });
  });
}

function integration(baseUrl, extras = {}) {
  return {
    _id: '64b000000000000000000001',
    name: 'Generic test integration',
    apiUrl: baseUrl,
    credentials: {},
    apiConfiguration: { authMethod: 'none' },
    statusMapping: [],
    ...extras,
  };
}

function order() {
  return {
    _id: '64b000000000000000000002',
    orderNumber: 'ORD-204',
    totalAmount: 41,
    shippingFee: 6,
    deliveryNotes: ' Ring bell ',
    customerInfo: { firstName: 'Mina', lastName: 'Haddad', mobile: '+1 (555) 010-2040' },
    shippingAddress: { street: '12 Cedar St', city: 'Northview', state: 'CA', zipCode: '90001', country: 'US' },
    items: [{ name: 'Coat', quantity: 2, price: 20.5 }],
  };
}

function quietOptions(extra = {}) {
  return { allowPrivateNetwork: true, logModel: false, ...extra };
}

test('GET builds path/query parameters and dynamic headers', async () => {
  let captured;
  await withHttpServer(async (request, response) => {
    captured = { method: request.method, url: new URL(request.url, 'http://local'), headers: request.headers };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: { status: 'PICKED_UP' } }));
  }, async baseUrl => {
    const result = await executeDeliveryEndpoint({
      integration: integration(baseUrl),
      endpoint: {
        name: 'getShipment',
        method: 'GET',
        path: '/shipments/{sequence}',
        pathParameters: { sequence: '{{order.sequence}}' },
        queryParameters: { area: '{{order.customer_area}}', include: 'events' },
        headers: { 'X-Order-Name': '{{order.customer_name}}' },
        responseMapping: { status: 'data.status' },
      },
      order: order(),
    }, quietOptions());

    assert.equal(captured.method, 'GET');
    assert.equal(captured.url.pathname, '/shipments/ORD-204');
    assert.equal(captured.url.searchParams.get('area'), 'Northview');
    assert.equal(captured.url.searchParams.get('include'), 'events');
    assert.equal(captured.headers['x-order-name'], 'Mina Haddad');
    assert.equal(result.status, 'PICKED_UP');
    assert.equal(result.success, true);
  });
});

test('POST renders nested JSON templates and maps response values', async () => {
  let capturedBody;
  let capturedContentType;
  let capturedEndpointKey;
  let capturedAuthorization;
  await withHttpServer(async (request, response) => {
    capturedBody = await readJsonRequest(request);
    capturedContentType = request.headers['content-type'];
    capturedEndpointKey = request.headers['x-endpoint-key'];
    capturedAuthorization = request.headers.authorization;
    response.writeHead(201, { 'Content-Type': 'application/json', 'x-request-id': 'req-208' });
    response.end(JSON.stringify({
      payload: {
        shipment: { id: 845, external: 'EXT-845', tracking: 'TRK-845', state: 'accepted' },
        fee: { shipping: '6.5', cod: 47.5 },
        label: 'https://labels.example/845.pdf',
      },
    }));
  }, async baseUrl => {
    const result = await executeDeliveryEndpoint({
      integration: integration(baseUrl, {
        statusMapping: [{ companyStatus: 'accepted', internalStatus: 'IN_TRANSIT' }],
        apiConfiguration: {
          integration: {
            authentication: { type: 'bearer', credentials: { token: 'integration-token' } },
          },
        },
      }),
      endpoint: {
        name: 'createShipment',
        method: 'POST',
        path: '/shipments',
        requestContentType: 'application/vnd.parcel+json',
        authentication: {
          type: 'apiKey',
          placement: 'header',
          name: 'x-endpoint-key',
          credentials: { apiKey: 'endpoint-key-secret' },
        },
        statusMapping: [{ companyStatus: 'accepted', internalStatus: 'DELIVERED' }],
        requestBody: {
          reference: '{{order.sequence}}',
          recipient: {
            name: '{{order.customer_name}}',
            address: '{{order.customer_address}}',
            phone: '{{order.customer_mobile|digits}}',
          },
          collect: '{{order.money_collection_cost|number}}',
          shipping: '{{order.shipping_cost|number}}',
          note: 'Note: {{order.note|trim}}',
          productNote: '{{order.product_note}}',
          parcels: [{ items: '{{order.items}}' }],
        },
        responseMapping: {
          shipmentId: 'payload.shipment.id',
          externalId: 'payload.shipment.external',
          trackingNumber: 'payload.shipment.tracking',
          status: 'payload.shipment.state',
          shippingCost: 'payload.fee.shipping',
          codAmount: 'payload.fee.cod',
          labelUrl: 'payload.label',
        },
      },
      order: order(),
    }, quietOptions());

    assert.equal(capturedBody.reference, 'ORD-204');
    assert.equal(capturedBody.recipient.phone, '15550102040');
    assert.equal(capturedBody.collect, 47);
    assert.equal(capturedBody.shipping, 6);
    assert.equal(capturedContentType, 'application/vnd.parcel+json');
    assert.equal(capturedEndpointKey, 'endpoint-key-secret');
    assert.equal(capturedAuthorization, undefined);
    assert.deepEqual(capturedBody.parcels[0].items, order().items);
    assert.equal(result.shipmentId, '845');
    assert.equal(result.externalId, 'EXT-845');
    assert.equal(result.trackingNumber, 'TRK-845');
    assert.equal(result.status, 'DELIVERED');
    assert.equal(result.shippingCost, 6.5);
    assert.equal(result.codAmount, 47.5);
    assert.equal(result.labelUrl, 'https://labels.example/845.pdf');
    assert.equal(result.rawResponse.payload.shipment.id, 845);
  });
});

test('supports PUT, PATCH, and DELETE methods', async () => {
  const receivedMethods = [];
  await withHttpServer(async (request, response) => {
    receivedMethods.push(request.method);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{}');
  }, async baseUrl => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const result = await executeDeliveryEndpoint({
        integration: integration(baseUrl),
        endpoint: { name: method, method, path: '/resource', requestBody: { sequence: '{{order.sequence}}' } },
        order: order(),
      }, quietOptions());
      assert.equal(result.success, true);
    }
  });
  assert.deepEqual(receivedMethods, ['PUT', 'PATCH', 'DELETE']);
});

test('two distinct carrier configurations use the same generic engine without provider branches', async () => {
  const alphaRequests = [];
  const betaRequests = [];
  await withHttpServer(async (request, response) => {
    alphaRequests.push({
      method: request.method,
      authorization: request.headers.authorization,
      body: await readJsonRequest(request),
    });
    response.writeHead(201, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: { shipment: { id: 'A-1', trackingNumber: 'A-TRACK', status: 'PENDING' } } }));
  }, async alphaBaseUrl => {
    await withHttpServer(async (request, response) => {
      betaRequests.push({
        method: request.method,
        apiKey: request.headers['x-beta-key'],
        body: await readJsonRequest(request),
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ result: { parcel: { reference: 'B-1', tracking: 'B-TRACK', stage: 'DELIVERING' } } }));
    }, async betaBaseUrl => {
      const alpha = await executeDeliveryEndpoint({
        integration: integration(alphaBaseUrl, {
          name: 'Carrier Alpha',
          apiConfiguration: { integration: { authentication: { type: 'bearer', credentials: { token: 'alpha-token' } } } },
        }),
        endpoint: {
          name: 'createShipment',
          method: 'POST',
          path: '/shipments',
          requestBody: { order_ref: '{{order.sequence}}', recipient: { name: '{{order.customer_name}}' } },
          responseMapping: {
            shipmentId: 'data.shipment.id',
            trackingNumber: 'data.shipment.trackingNumber',
            status: 'data.shipment.status',
          },
          statusMapping: [{ companyStatus: 'PENDING', internalStatus: 'PENDING' }],
        },
        order: order(),
      }, quietOptions());

      const beta = await executeDeliveryEndpoint({
        integration: integration(betaBaseUrl, {
          name: 'Carrier Beta',
          apiConfiguration: { integration: { authentication: { type: 'apiKey', name: 'x-beta-key', credentials: { apiKey: 'beta-api-key' } } } },
        }),
        endpoint: {
          name: 'createParcel',
          operation: 'parcel.create',
          method: 'POST',
          path: '/parcels',
          requestBody: { package: { reference: '{{order.sequence}}', receiver: { mobile: '{{order.customer_mobile|digits}}' } } },
          responseMapping: {
            externalId: 'result.parcel.reference',
            trackingNumber: 'result.parcel.tracking',
            status: 'result.parcel.stage',
          },
          statusMapping: [{ companyStatus: 'DELIVERING', internalStatus: 'IN_TRANSIT' }],
        },
        order: order(),
      }, quietOptions());

      assert.equal(alpha.success, true);
      assert.equal(alphaRequests[0].method, 'POST');
      assert.equal(alphaRequests[0].authorization, 'Bearer alpha-token');
      assert.equal(alphaRequests[0].body.order_ref, 'ORD-204');
      assert.equal(alpha.trackingNumber, 'A-TRACK');
      assert.equal(alpha.status, 'PENDING');

      assert.equal(beta.success, true);
      assert.equal(betaRequests[0].method, 'POST');
      assert.equal(betaRequests[0].apiKey, 'beta-api-key');
      assert.deepEqual(betaRequests[0].body, { package: { reference: 'ORD-204', receiver: { mobile: '15550102040' } } });
      assert.equal(beta.trackingNumber, 'B-TRACK');
      assert.equal(beta.status, 'IN_TRANSIT');
    });
  });
});

test('resolves nested configured endpoints and integration-level response mappings', async () => {
  let requestPath;
  await withHttpServer(async (request, response) => {
    requestPath = new URL(request.url, 'http://local').pathname;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ payload: { parcel: { tracking: 'NESTED-TRACK', state: 'PENDING' } } }));
  }, async baseUrl => {
    const result = await executeDeliveryEndpoint({
      integration: integration(baseUrl, {
        apiConfiguration: {
          integration: {
            endpoints: {
              getShipment: {
                operation: 'shipment.get',
                method: 'GET',
                path: '/shipments/{sequence}',
                pathParameters: { sequence: '{{order.sequence}}' },
                responseMapping: {},
              },
            },
            responseMapping: {
              trackingNumber: 'payload.parcel.tracking',
              status: 'payload.parcel.state',
            },
          },
        },
      }),
      endpointName: 'getShipment',
      order: order(),
    }, quietOptions());

    assert.equal(requestPath, '/shipments/ORD-204');
    assert.equal(result.success, true);
    assert.equal(result.trackingNumber, 'NESTED-TRACK');
    assert.equal(result.status, 'PENDING');
  });
});

test('supports API-key header and query, bearer, basic, and custom authentication', async () => {
  const observations = [];
  const logs = [];
  const LogModel = { create: async entry => logs.push(entry) };
  await withHttpServer(async (request, response) => {
    observations.push({
      url: new URL(request.url, 'http://local'),
      authorization: request.headers.authorization,
      apiKey: request.headers['x-carrier-key'],
      custom: request.headers['x-merchant'],
    });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{}');
  }, async baseUrl => {
    const authCases = [
      { type: 'apiKey', name: 'x-carrier-key', placement: 'header', credentials: { apiKey: 'key-header-secret' } },
      { type: 'apiKey', name: 'merchant-access', placement: 'query', credentials: { apiKey: 'key-query-secret' } },
      { type: 'bearer', credentials: { token: 'bearer-secret' } },
      { type: 'basic', credentials: { username: 'merchant-user', password: 'basic-secret' } },
      { type: 'custom', name: 'x-merchant', scheme: 'Token', credentials: { value: 'custom-secret' } },
    ];
    for (let index = 0; index < authCases.length; index += 1) {
      await executeDeliveryEndpoint({
        integration: integration(baseUrl, { apiConfiguration: { integration: { authentication: authCases[index] } } }),
        endpoint: { name: `auth-${index}`, method: 'GET', path: '/auth' },
        order: order(),
      }, quietOptions(index === 1 ? { logModel: LogModel } : {}));
    }
  });

  assert.equal(observations[0].apiKey, 'key-header-secret');
  assert.equal(observations[1].url.searchParams.get('merchant-access'), 'key-query-secret');
  assert.equal(observations[2].authorization, 'Bearer bearer-secret');
  assert.equal(Buffer.from(observations[3].authorization.slice('Basic '.length), 'base64').toString(), 'merchant-user:basic-secret');
  assert.equal(observations[4].custom, 'Token custom-secret');
  assert.equal(logs.length, 1);
  assert.doesNotMatch(JSON.stringify(logs), /key-query-secret/);
  assert.match(logs[0].requestMetadata.url, /merchant-access=\[REDACTED\]/);
});

test('logs and errors redact credentials and provider response secrets', async () => {
  const logs = [];
  const LogModel = { create: async entry => logs.push(entry) };
  await withHttpServer(async (_request, response) => {
    response.writeHead(401, { 'Content-Type': 'application/json', 'x-request-id': 'req-error-1' });
    response.end(JSON.stringify({ message: 'Rejected Bearer bearer-secret', access_token: 'bearer-secret' }));
  }, async baseUrl => {
    const result = await executeDeliveryEndpoint({
      integration: integration(baseUrl, {
        apiConfiguration: { integration: { authentication: { type: 'bearer', credentials: { token: 'bearer-secret' } } } },
      }),
      endpoint: { name: 'secretError', method: 'GET', path: '/failure' },
      order: order(),
    }, quietOptions({ logModel: LogModel }));

    assert.equal(result.success, false);
    assert.equal(result.error.httpStatus, 401);
    assert.equal(result.error.requestId, 'req-error-1');
    assert.doesNotMatch(result.error.message, /bearer-secret/);
    assert.equal('access_token' in result.error.providerResponse, false);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].requestId, 'req-error-1');
    assert.equal('headers' in logs[0].requestMetadata, false);
    assert.doesNotMatch(JSON.stringify(logs[0]), /bearer-secret/);
  });
});

test('status mapping accepts canonical internal values and reports unknown statuses', () => {
  const configured = { statusMapping: [{ companyStatus: 'moving-now', internalStatus: 'IN_TRANSIT' }] };
  assert.equal(normalizeStatus('moving-now', configured), 'IN_TRANSIT');
  assert.equal(normalizeStatus('PICKUP_REQUESTED', { statusMapping: [] }), 'PICKUP_REQUESTED');
  assert.equal(normalizeStatus('vendor-state-x', { statusMapping: [] }), 'UNKNOWN');
});

test('rejects unsupported template variables and private network URLs by default', async () => {
  assert.throws(() => renderTemplate('{{order.customerInfo.password}}', { order: {} }), /Unsupported template variable/);
  const result = await executeDeliveryEndpoint({
    integration: integration('http://127.0.0.1:8080'),
    endpoint: { name: 'private', method: 'GET', path: '/blocked' },
    order: order(),
  }, { logModel: false });
  assert.equal(result.success, false);
  assert.match(result.error.message, /not allowed|private or reserved/);
});

test('times out requests using endpoint timeout configuration', async () => {
  await withHttpServer((_request, response) => {
    setTimeout(() => {
      if (!response.destroyed) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{}');
      }
    }, 100).unref();
  }, async baseUrl => {
    const result = await executeDeliveryEndpoint({
      integration: integration(baseUrl),
      endpoint: { name: 'slow', method: 'GET', path: '/slow', timeoutMs: 20 },
      order: order(),
    }, quietOptions());
    assert.equal(result.success, false);
    assert.match(result.error.message, /timeout/i);
  });
});

test('retries safe requests but does not retry unsafe methods without opt-in', async () => {
  const hits = { GET: 0, POST: 0 };
  await withHttpServer(async (request, response) => {
    hits[request.method] += 1;
    if (hits[request.method] === 1) {
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end('{"message":"temporary"}');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{}');
  }, async baseUrl => {
    const safe = await executeDeliveryEndpoint({
      integration: integration(baseUrl),
      endpoint: { name: 'safe-get', method: 'GET', path: '/retry', retry: { attempts: 1, delayMs: 1, maxDelayMs: 5 } },
      order: order(),
    }, quietOptions());
    const unsafe = await executeDeliveryEndpoint({
      integration: integration(baseUrl),
      endpoint: { name: 'unsafe-post', method: 'POST', path: '/no-retry', requestBody: {}, retry: { attempts: 3, delayMs: 1 } },
      order: order(),
    }, quietOptions());

    assert.equal(safe.success, true);
    assert.equal(unsafe.success, false);
    assert.equal(hits.GET, 2);
    assert.equal(hits.POST, 1);
  });
});

test('optional request variables omit empty fields and array entries safely', () => {
  const sampleOrder = order();
  sampleOrder.deliveryNotes = '';
  const rendered = renderTemplate({
    recipient: { note: '{{order.note|optional}}' },
    notes: ['keep', '{{order.note|optional}}'],
  }, makeOrderVariables(sampleOrder));
  assert.deepEqual(rendered, { recipient: {}, notes: ['keep'] });
});

test('dry-run builds and sanitizes a request without calling the endpoint', async () => {
  let hits = 0;
  await withHttpServer(async (_request, response) => {
    hits += 1;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{}');
  }, async baseUrl => {
    const result = await executeDeliveryEndpoint({
      integration: integration(baseUrl, {
        apiConfiguration: {
          integration: { authentication: { type: 'bearer', credentials: { token: 'preview-token' } } },
        },
      }),
      endpoint: { name: 'previewOnly', method: 'POST', path: '/shipments', requestBody: { sequence: '{{order.sequence}}' } },
      order: order(),
    }, quietOptions({ dryRun: true }));

    assert.equal(hits, 0);
    assert.equal(result.success, true);
    assert.equal(result.executed, false);
    assert.equal(result.request.method, 'POST');
    assert.equal(result.request.body.sequence, 'ORD-204');
    assert.equal('headers' in result.request, false);
    assert.doesNotMatch(JSON.stringify(result), /preview-token/);
  });
});