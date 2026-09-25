// In-memory refresh token store (can be replaced by Redis or database collection later)
// Maps refresh token -> { userId, exp }
// NOTE: Survives only for process lifetime; for production deploy to persistent/central store.
const store = new Map();

export function saveRefreshToken(token, userId, ttlMs) {
  const exp = Date.now() + ttlMs;
  store.set(token, { userId, exp });
}

export function consumeRefreshToken(token) {
  const data = store.get(token);
  if (!data) return null;
  if (Date.now() > data.exp) {
    store.delete(token);
    return null;
  }
  return data; // one-time or multi-use? keep multi-use until expiry.
}

export function revokeToken(token) {
  store.delete(token);
}

export function revokeUserTokens(userId) {
  for (const [t, v] of store.entries()) {
    if (v.userId === userId) store.delete(t);
  }
}

export function cleanupExpired() {
  const now = Date.now();
  for (const [t, v] of store.entries()) {
    if (v.exp < now) store.delete(t);
  }
}

// Periodic cleanup
setInterval(cleanupExpired, 10 * 60 * 1000).unref();

export default {
  saveRefreshToken,
  consumeRefreshToken,
  revokeToken,
  revokeUserTokens
};
