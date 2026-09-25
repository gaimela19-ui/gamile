// Minimal Expo Push Service client without extra dependencies
// Docs: https://docs.expo.dev/push-notifications/sending-notifications/

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function isExpoPushToken(token) {
  if (typeof token !== 'string') return false;
  return /^Expo(?:nent)?PushToken\[[^\]]+\]$/.test(token.trim());
}

function jsonSafe(obj) {
  try {
    return JSON.parse(JSON.stringify(obj, (_k, v) => {
      if (typeof v === 'bigint') return v.toString();
      if (v instanceof Map) return Object.fromEntries(v);
      if (v instanceof Set) return Array.from(v);
      return v;
    }));
  } catch {
    return {}; // fallback to empty
  }
}

async function postExpo(messages) {
  const fetchImpl = globalThis.fetch || (await import('node-fetch').then(m => m.default).catch(() => null));
  if (!fetchImpl) throw new Error('No fetch available. Node 18+ or node-fetch required.');

  const headers = { 'Content-Type': 'application/json' };
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetchImpl(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.errors?.[0]?.message || res.statusText || 'Expo push send failed';
    const code = json?.errors?.[0]?.code;
    throw new Error(`[expoPush] ${msg}${code ? ' code=' + code : ''}`);
  }
  return json;
}

// channelId is used by Android to select the notification channel configured in the app.
// iOS uses the `sound` payload field directly (e.g., 'cat.wav').
export async function sendExpoPush({ tokens, title, body, data, sound = 'cat.wav', priority = 'high', badge, badges, channelId, imageUrl }) {
  const valid = tokens.filter(isExpoPushToken);
  const invalid = tokens.filter(t => !isExpoPushToken(t));
  if (invalid.length) {
    console.warn('[expoPush] Skipping invalid tokens:', invalid.slice(0, 3), invalid.length > 3 ? `(+${invalid.length - 3} more)` : '');
  }
  if (!valid.length) return { ok: true, receipts: [], warnings: ['no_valid_tokens'] };

  const richImage = typeof imageUrl === 'string' && imageUrl.trim().length ? imageUrl.trim() : undefined;
  const messages = valid.map(token => {
    const perTokenBadge = badges && typeof badges.get === 'function' ? badges.get(token) : undefined;
    // Silent channel: omit sound field so platform uses no audible alert (Android channel config will also be silent)
    const finalSound = channelId === 'silent' ? undefined : sound;
    return {
      to: token,
      sound: finalSound,
      title,
      body,
      data: jsonSafe(data),
      priority,
      ...(channelId ? { channelId } : {}),
      ...(richImage ? { image: richImage, mutableContent: true, attachments: [{ id: 'rich-media', url: richImage }] } : {}),
      ...(typeof perTokenBadge === 'number' ? { badge: perTokenBadge } : (typeof badge === 'number' ? { badge } : {}))
    };
  });

  const chunks = chunkArray(messages, 99); // Expo recommends ~100 per request
  const receipts = [];
  for (const chunk of chunks) {
    try {
      const res = await postExpo(chunk);
      receipts.push(res);
    } catch (e) {
      receipts.push({ error: e?.message || String(e) });
    }
  }
  return { ok: true, receipts };
}
