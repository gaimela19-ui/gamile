import DeliveryIntegrationEndpoint from '../../models/DeliveryIntegrationEndpoint.js';
import { executeDeliveryEndpoint } from '../deliveryApiEngine.js';

function parseJsonEnv(name, fallback) {
  try {
    return process.env[name] ? JSON.parse(process.env[name]) : fallback;
  } catch {
    return fallback;
  }
}

function objectValue(value) {
  if (value instanceof Map) return Object.fromEntries(value);
  if (value?.toObject) return value.toObject({ flattenMaps: true });
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function resolveLegacyConfiguration(company) {
  const apiConfiguration = company.apiConfiguration || {};
  const hubBaseUrl = process.env.DELIVERY_HUB_BASE_URL;
  const hubParams = parseJsonEnv('DELIVERY_HUB_PARAMS', {});
  const hubQuery = parseJsonEnv('DELIVERY_HUB_QUERY', {});
  const envDb = process.env.DELIVERY_HUB_DB || process.env.ODOO_DB || process.env.DELIVERY_DB;
  const database = company.credentials?.database || company.credentials?.db || company.customFields?.db;
  const globalParams = parseJsonEnv('DELIVERY_DEFAULT_PARAMS', parseJsonEnv('DELIVERY_HUB_PARAMS', {})) || {};
  const baseParams = hubBaseUrl
    ? {
        ...globalParams,
        ...hubParams,
        ...(envDb ? { db: envDb } : {}),
        companyCode: company.code || undefined,
        companyId: company._id ? String(company._id) : undefined,
        companyName: company.name || undefined,
      }
    : { ...globalParams, ...objectValue(apiConfiguration.params) };
  if (envDb && baseParams.db == null) baseParams.db = envDb;
  if (baseParams.db == null && database) baseParams.db = database;

  const globalQuery = parseJsonEnv('DELIVERY_DEFAULT_QUERY', parseJsonEnv('DELIVERY_HUB_QUERY', {})) || {};
  const queryParameters = {
    ...globalQuery,
    ...(hubBaseUrl ? hubQuery : objectValue(apiConfiguration.queryParams)),
  };
  const url = hubBaseUrl || company.apiUrl || apiConfiguration.baseUrl || '';
  const format = hubBaseUrl
    ? (process.env.DELIVERY_HUB_FORMAT || 'jsonrpc')
    : (company.apiFormat || apiConfiguration.format || 'rest');
  if (format !== 'jsonrpc' && (process.env.DELIVERY_REQUIRE_DB === 'true' || /olivery|odoo/i.test(url)) && queryParameters.db == null && baseParams.db != null) {
    queryParameters.db = baseParams.db;
  }
  if (envDb && queryParameters.db == null && baseParams.db == null) queryParameters.db = envDb;

  const hubHeaders = hubBaseUrl ? parseJsonEnv('DELIVERY_HUB_HEADERS', {}) : {};
  const headers = hubBaseUrl ? objectValue(hubHeaders) : objectValue(apiConfiguration.headers);
  const method = hubBaseUrl
    ? (process.env.DELIVERY_HUB_METHOD || 'create_order')
    : (apiConfiguration.method || 'create_order');
  const credentialsInParams = process.env.DELIVERY_INCLUDE_CREDS === 'true' || /olivery|odoo/i.test(url) || apiConfiguration.credentialsInParams === true;
  const username = apiConfiguration.username || company.credentials?.username || company.credentials?.login;
  const password = apiConfiguration.password || company.credentials?.password;

  return {
    apiConfiguration,
    baseParams,
    queryParameters,
    headers,
    url,
    format,
    method,
    credentialsInParams,
    username,
    password,
    omitMethod: hubBaseUrl
      ? process.env.DELIVERY_HUB_JSONRPC_OMIT_METHOD === 'true'
      : apiConfiguration.jsonrpcOmitMethod === true || apiConfiguration.omitJsonRpcMethod === true,
    timeoutMs: Number(apiConfiguration.timeoutMs) || Number(process.env.DELIVERY_HUB_TIMEOUT_MS) || 15000,
    authMethod: hubBaseUrl
      ? (process.env.DELIVERY_HUB_AUTH_METHOD || 'none')
      : (apiConfiguration.authMethod || 'none'),
    apiKeyHeader: process.env.DELIVERY_HUB_API_KEY_HEADER || company.credentials?.apiKeyHeader || apiConfiguration.apiKeyHeader || 'x-api-key',
    apiKey: hubBaseUrl
      ? (process.env.DELIVERY_HUB_API_KEY || process.env.DELIVERY_HUB_BEARER)
      : (apiConfiguration.apiKey || company.credentials?.apiKey),
    hubUsername: hubBaseUrl
      ? process.env.DELIVERY_HUB_USERNAME
      : (apiConfiguration.username || company.credentials?.username || company.credentials?.login),
    hubPassword: hubBaseUrl
      ? process.env.DELIVERY_HUB_PASSWORD
      : (apiConfiguration.password || company.credentials?.password),
  };
}

export function getOliveryExecutionMode(company) {
  const integration = company.apiConfiguration?.integration || {};
  const environmentMode = String(process.env.DELIVERY_OLIVERY_ENGINE_MODE || '').toLowerCase();
  if (environmentMode === 'legacy') return 'legacy';
  if (environmentMode === 'generic') return 'generic';
  if (integration.executionMode === 'legacy') return 'legacy';
  if (integration.executionMode === 'generic' || integration.engineEnabled === true) return 'generic';
  return 'generic';
}

export function prepareOliveryLegacyCompany(company) {
  const configuration = resolveLegacyConfiguration(company);
  const requireDb = process.env.DELIVERY_REQUIRE_DB === 'true' || /olivery|odoo/i.test(configuration.url);
  const requiredParams = new Set(Array.isArray(configuration.apiConfiguration.requiredParams)
    ? configuration.apiConfiguration.requiredParams
    : []);
  if (requireDb) requiredParams.add('db');
  if (configuration.credentialsInParams) {
    requiredParams.add('username');
    requiredParams.add('password');
  }

  return {
    ...company,
    apiUrl: configuration.url,
    apiConfiguration: {
      ...configuration.apiConfiguration,
      baseUrl: configuration.url,
      apiKey: configuration.apiKey,
      apiKeyHeader: configuration.apiKeyHeader,
      authMethod: configuration.authMethod,
      username: configuration.hubUsername,
      password: configuration.hubPassword,
      method: configuration.method,
      format: configuration.format,
      timeoutMs: configuration.timeoutMs,
      jsonrpcOmitMethod: configuration.omitMethod,
      credentialsInParams: configuration.credentialsInParams,
      requireDbInQuery: requireDb,
      legacyJsonRpcAutoDetect: /odoo/i.test(configuration.url),
      params: configuration.baseParams,
      queryParams: configuration.queryParameters,
      headers: configuration.headers,
      requiredParams: Array.from(requiredParams),
    },
  };
}

export function canOliveryFallbackToLegacy(company, result) {
  const integration = company.apiConfiguration?.integration || {};
  return result?.error?.requestDispatched === false && (
    integration.fallbackOnPreDispatchFailure === true ||
    process.env.DELIVERY_OLIVERY_FALLBACK_ON_PRE_DISPATCH_FAILURE === 'true'
  );
}

function mappedResponsePaths(format) {
  if (format === 'jsonrpc') {
    return {
      shipmentId: ['result.shipmentId', 'result.shipment_id', 'result.id'],
      externalId: ['result.externalId', 'result.external_id', 'result.id'],
      trackingNumber: ['result.trackingNumber', 'result.tracking_id', 'result.reference', 'result.reference_id', 'result.id'],
      status: ['result.deliveryStatus', 'result.status', 'result.current_status', 'result.state'],
      shippingCost: ['result.shippingCost', 'result.shipping_cost'],
      codAmount: ['result.codAmount', 'result.cod_amount'],
      labelUrl: ['result.labelUrl', 'result.label_url'],
    };
  }
  return {
    shipmentId: ['shipmentId', 'shipment_id', 'id'],
    externalId: ['externalId', 'external_id', 'id'],
    trackingNumber: ['trackingNumber', 'tracking_id', 'trackingId', 'reference', 'reference_id', 'order_id', 'id'],
    status: ['deliveryStatus', 'status', 'current_status', 'state'],
    shippingCost: ['shippingCost', 'shipping_cost'],
    codAmount: ['codAmount', 'cod_amount'],
    labelUrl: ['labelUrl', 'label_url'],
  };
}

function requestBody(configuration, payload) {
  if (configuration.format === 'jsonrpc') {
    const params = { ...configuration.baseParams, ...payload };
    if (configuration.credentialsInParams) {
      if (configuration.username) {
        params.username = configuration.username;
        params.login = configuration.username;
      }
      if (configuration.password) params.password = configuration.password;
    }
    return configuration.omitMethod
      ? { jsonrpc: '2.0', params }
      : { jsonrpc: '2.0', method: configuration.method, params, id: Date.now() };
  }
  return { ...configuration.baseParams, ...payload };
}

function engineAuthentication(configuration, existingIntegrationAuth) {
  if (existingIntegrationAuth?.type && existingIntegrationAuth.type !== 'legacy') return existingIntegrationAuth;
  if (configuration.authMethod === 'apiKey') {
    return {
      type: 'apiKey',
      placement: 'header',
      name: configuration.apiKeyHeader,
      credentials: { apiKey: configuration.apiKey },
    };
  }
  if (configuration.authMethod === 'bearer') {
    return { type: 'bearer', credentials: { token: configuration.apiKey } };
  }
  if (configuration.authMethod === 'basic') {
    return { type: 'basic', credentials: { username: configuration.hubUsername, password: configuration.hubPassword } };
  }
  return { type: 'none' };
}

export async function executeOliveryCompatibilityAdapter({ order, company, payload, extra = {}, options = {} }) {
  const configuration = resolveLegacyConfiguration(company);
  if (!configuration.url) {
    return {
      success: false,
      status: 'UNKNOWN',
      error: { httpStatus: null, message: 'Delivery company is missing API URL', endpoint: null, requestId: null, providerResponse: null },
    };
  }

  const endpointName = company.apiConfiguration?.integration?.sendEndpointName || 'createShipment';
  const storedEndpoint = options.endpoint || (company._id
    ? await DeliveryIntegrationEndpoint.findOne({ integration: company._id, name: endpointName }).lean()
    : null);
  const effectiveCompany = {
    ...company,
    apiUrl: configuration.url,
    apiConfiguration: {
      ...configuration.apiConfiguration,
      baseUrl: configuration.url,
      authMethod: 'none',
      headers: configuration.headers,
      timeoutMs: configuration.timeoutMs,
      integration: {
        ...(configuration.apiConfiguration.integration || {}),
        authentication: engineAuthentication(configuration, configuration.apiConfiguration.integration?.authentication),
      },
    },
  };
  const runRequest = async format => {
    const endpoint = {
      ...(storedEndpoint || {}),
      name: endpointName,
      method: 'POST',
      url: storedEndpoint?.url || configuration.url,
      path: storedEndpoint?.path || '',
      headers: { ...configuration.headers, ...objectValue(storedEndpoint?.headers) },
      queryParameters: { ...configuration.queryParameters, ...objectValue(storedEndpoint?.queryParameters) },
      timeoutMs: storedEndpoint?.timeoutMs || configuration.timeoutMs,
      retry: storedEndpoint?.retry || { attempts: 0 },
      responseMapping: storedEndpoint?.responseMapping && Object.keys(storedEndpoint.responseMapping).length
        ? storedEndpoint.responseMapping
        : mappedResponsePaths(format),
    };
    const body = requestBody({ ...configuration, format }, payload);
    return executeDeliveryEndpoint({ integration: effectiveCompany, endpoint, order, extra, requestBodyOverride: body }, options);
  };

  let result = await runRequest(configuration.format);
  if (configuration.format !== 'jsonrpc' && !result.success) {
    const data = result.error?.providerResponse;
    const looksJsonRpc = (data && typeof data === 'object' && (data.jsonrpc || data.error))
      || /jsonrpc/i.test(String(result.error?.message || ''))
      || /odoo/i.test(String(result.error?.message || ''))
      || /KeyError: 'db'/i.test(String(data?.error?.debug || ''));
    if (looksJsonRpc) result = await runRequest('jsonrpc');
  }

  if (!result.success && configuration.format === 'jsonrpc') {
    const providerError = result.error?.providerResponse?.error;
    if (providerError) {
      const message = providerError.message || providerError.data?.message || 'Provider rejected the request';
      result.error.message = `Provider error${providerError.code ? ` (${providerError.code})` : ''}: ${message}`;
    }
  }
  return {
    ...result,
    status: result.externalStatus || 'created',
  };
}