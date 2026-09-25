// Z-Credit Gateway (Token / Card processing) service
// This uses the commitFullTransaction endpoint for charging tokens or cards directly.
// All sensitive credentials pulled from env:
//   ZCREDIT_GATEWAY_URL (base, e.g. https://secure.zcredit.co.il or from docs)
//   ZCREDIT_TERMINAL_NUMBER
//   ZCREDIT_TERMINAL_PASSWORD
//   ZCREDIT_WC_KEY (web checkout key, sometimes reused for token scope depending on account setup)
//
// NOTE: Adjust field names once final spec confirmed; placeholders included.

const GW_BASE = process.env.ZCREDIT_GATEWAY_URL || 'https://secure.zcredit.co.il';

function getTerminalCreds() {
  const terminal = process.env.ZCREDIT_TERMINAL_NUMBER || '';
  const password = process.env.ZCREDIT_TERMINAL_PASSWORD || '';
  if (!terminal || !password) throw new Error('ZCredit terminal credentials missing (ZCREDIT_TERMINAL_NUMBER / ZCREDIT_TERMINAL_PASSWORD)');
  return { terminal, password };
}

function buildUrl(path) {
  return `${GW_BASE.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
}

async function postGateway(path, payload) {
  const url = buildUrl(path);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.HasError || data?.ReturnCode < 0) {
    const msg = data?.ReturnMessage || `HTTP ${res.status}`;
    const err = new Error(`ZCredit Gateway error: ${msg}`);
    err.response = data;
    throw err;
  }
  return data;
}

// Charge using an existing token (tokenization flow)
export async function commitTokenTransaction({ token, amount, currency = 'ILS', uniqueId, transactionType = 'regular' }) {
  if (!token) throw new Error('token required');
  if (typeof amount !== 'number' || amount <= 0) throw new Error('valid amount required');
  const { terminal, password } = getTerminalCreds();
  const payload = {
    TerminalNumber: terminal,
    TerminalPassword: password,
    UniqueId: uniqueId || `tok_${Date.now()}`,
    Token: token,
    Amount: amount,
    Currency: currency,
    PaymentType: transactionType, // regular | authorize | validate
    // Additional optional fields can be appended here (HolderId, Installments, etc.)
  };
  return postGateway('/CommitFullTransaction', payload);
}

// Charge raw card data (if PCI flow allowed) – placeholder; generally you should prefer hosted page or tokens.
export async function commitCardTransaction({ cardNumber, expMonth, expYear, cvv, holderId, amount, currency = 'ILS', uniqueId, transactionType = 'regular' }) {
  if (!cardNumber || !expMonth || !expYear || !cvv) throw new Error('cardNumber, expMonth, expYear, cvv required');
  if (typeof amount !== 'number' || amount <= 0) throw new Error('valid amount required');
  const { terminal, password } = getTerminalCreds();
  const payload = {
    TerminalNumber: terminal,
    TerminalPassword: password,
    UniqueId: uniqueId || `card_${Date.now()}`,
    CardNumber: cardNumber,
    ExpDate_MMYY: `${String(expMonth).padStart(2,'0')}/${String(expYear).slice(-2)}`,
    CVV: cvv,
    HolderId: holderId || '',
    Amount: amount,
    Currency: currency,
    PaymentType: transactionType
  };
  return postGateway('/CommitFullTransaction', payload);
}

// Capture (finalize) an authorized transaction – requires ReferenceNumber from original auth callback
export async function captureAuthorized({ referenceNumber, amount }) {
  if (!referenceNumber) throw new Error('referenceNumber required');
  const { terminal, password } = getTerminalCreds();
  const payload = {
    TerminalNumber: terminal,
    TerminalPassword: password,
    ReferenceNumber: referenceNumber,
    Amount: amount || undefined,
    Action: 'capture'
  };
  return postGateway('/CommitFullTransaction', payload);
}

// Refund an existing transaction
export async function refundTransaction({ referenceNumber, amount }) {
  if (!referenceNumber) throw new Error('referenceNumber required');
  const { terminal, password } = getTerminalCreds();
  const payload = {
    TerminalNumber: terminal,
    TerminalPassword: password,
    ReferenceNumber: referenceNumber,
    Amount: amount || undefined,
    Action: 'refund'
  };
  return postGateway('/CommitFullTransaction', payload);
}

export default {
  commitTokenTransaction,
  commitCardTransaction,
  captureAuthorized,
  refundTransaction
};
