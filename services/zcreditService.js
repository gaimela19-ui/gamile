const BASE_URL = 'https://pci.zcredit.co.il/webcheckout/api/WebCheckout';

function getKey() {
  const key = process.env.ZCREDIT_WC_KEY || '';
  if (!key) throw new Error('ZCREDIT_WC_KEY not configured');
  return key;
}

async function postJson(path, body) {
  const url = `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.ReturnMessage || data?.message || `HTTP ${res.status}`;
    const err = new Error(`ZCredit API error: ${msg}`);
    err.response = data;
    throw err;
  }
  return data;
}

export async function createSession(requestPayload) {
  const Key = getKey();
  const payload = { Key, ...requestPayload };
  const data = await postJson('/CreateSession', payload);
  return data;
}

export async function getSessionStatus(sessionId) {
  const Key = getKey();
  const payload = { Key, SessionId: sessionId };
  const data = await postJson('/GetSessionStatus', payload);
  return data;
}

export async function resendNotification(sessionId) {
  const Key = getKey();
  const payload = { Key, SessionId: sessionId };
  const data = await postJson('/ResendNotification', payload);
  return data;
}

export default {
  createSession,
  getSessionStatus,
  resendNotification
};
