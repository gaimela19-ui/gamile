const SENSITIVE_KEY = /(credential|password|secret|token|api[-_]?key|authorization|bearer|username|login|signature)/i;

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

export function mergePreservingDeliverySecrets(existing, incoming, insideCredentials = false) {
  if (!isPlainObject(incoming)) return incoming;
  const previous = existing?.toObject
    ? existing.toObject({ flattenMaps: true })
    : (isPlainObject(existing) ? existing : {});
  const merged = { ...previous };

  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const isSecret = insideCredentials || SENSITIVE_KEY.test(key) || key.toLowerCase() === 'headers';
    if (isSecret && (value === null || value === '' || value === '__REMOVE__')) continue;
    if (isPlainObject(value) && isPlainObject(previous[key])) {
      merged[key] = mergePreservingDeliverySecrets(previous[key], value, insideCredentials || key === 'credentials' || key.toLowerCase() === 'headers');
    } else {
      merged[key] = value;
    }
  }
  return merged;
}