const SENSITIVE_KEY = /(credential|password|secret|token|api[-_]?key|authorization|bearer|username|login|signature|database|headers|^db$)/i;
const SAFE_AUTH_TEMPLATE = /^\s*\{\{\s*auth\.(phone|username|password)\s*\}\}\s*$/;

function isSafeCredentialTemplate(value) {
  return typeof value === 'string' && SAFE_AUTH_TEMPLATE.test(value);
}

function toPlainObject(value) {
  if (value && typeof value.toObject === 'function') {
    return value.toObject({ flattenMaps: true, virtuals: true });
  }
  return value;
}

export function sanitizeDeliverySecrets(value) {
  const plainValue = toPlainObject(value);
  if (plainValue == null || typeof plainValue !== 'object') return plainValue;
  if (Array.isArray(plainValue)) return plainValue.map(sanitizeDeliverySecrets);
  if (plainValue._bsontype || Buffer.isBuffer(plainValue) || plainValue instanceof Date) return plainValue;

  return Object.fromEntries(
    Object.entries(plainValue)
      .filter(([key, child]) => !SENSITIVE_KEY.test(key) || isSafeCredentialTemplate(child))
      .map(([key, child]) => [key, sanitizeDeliverySecrets(child)])
  );
}

export function sanitizeDeliveryCompany(company) {
  const plainCompany = toPlainObject(company);
  const safe = sanitizeDeliverySecrets(plainCompany);
  const apiConfiguration = plainCompany?.apiConfiguration;
  const integrationAuthentication = apiConfiguration?.integration?.authentication;
  if (safe?.apiConfiguration && apiConfiguration?.headers) {
    safe.apiConfiguration.headerNames = Object.keys(apiConfiguration.headers);
  }
  if (safe?.apiConfiguration?.integration?.authentication && integrationAuthentication?.headers) {
    safe.apiConfiguration.integration.authentication.headerNames = Object.keys(integrationAuthentication.headers);
  }
  return safe;
}