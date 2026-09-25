// Simple in-memory TTL cache (non-cluster safe). For production scale, replace with Redis.
// Key: string, Value: any + expiresAt (epoch ms)

const store = new Map();

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function cacheSet(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheWrap(key, ttlMs, fn) {
  const existing = cacheGet(key);
  if (existing !== undefined) return existing;
  const value = fn();
  cacheSet(key, value, ttlMs);
  return value;
}

export function cacheDelete(prefix) {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

export function cacheStats() {
  return { size: store.size };
}
