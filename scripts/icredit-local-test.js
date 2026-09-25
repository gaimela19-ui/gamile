// Standalone iCredit test runner (no DB/server required)
// Usage (PowerShell):
//   $env:ICREDIT_TOKEN="<GroupPrivateToken>"; node project/server/scripts/icredit-local-test.js
// Optional envs:
//   $env:ICREDIT_FORCE_TEST="1"      # force using test host regardless of URL
//   $env:ICREDIT_TRANSPORT="json"    # json | soap | auto
//   $env:ICREDIT_API_URL="https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl"

import { requestICreditPaymentUrl, diagnoseICreditConnectivity } from '../services/icreditService.js';

function parseArgs(argv) {
  const out = { token: null, apiUrl: null, transport: null, forceTest: null, redirect: null, fail: null, ipn: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force-test' || a === '--forceTest') out.forceTest = true;
    else if (a === '--no-force-test') out.forceTest = false;
    else if (a === '--token' && argv[i+1]) { out.token = argv[++i]; }
    else if (a.startsWith('--token=')) { out.token = a.split('=')[1]; }
    else if (a === '--api-url' && argv[i+1]) { out.apiUrl = argv[++i]; }
    else if (a.startsWith('--api-url=')) { out.apiUrl = a.split('=')[1]; }
    else if (a === '--transport' && argv[i+1]) { out.transport = argv[++i]; }
    else if (a.startsWith('--transport=')) { out.transport = a.split('=')[1]; }
    else if (a === '--redirect' && argv[i+1]) { out.redirect = argv[++i]; }
    else if (a.startsWith('--redirect=')) { out.redirect = a.split('=')[1]; }
  else if (a === '--fail' && argv[i+1]) { out.fail = argv[++i]; }
  else if (a.startsWith('--fail=')) { out.fail = a.split('=')[1]; }
  else if (a === '--ipn' && argv[i+1]) { out.ipn = argv[++i]; }
  else if (a.startsWith('--ipn=')) { out.ipn = a.split('=')[1]; }
  }
  return out;
}

function getEnv(name, def = '') {
  const v = process.env[name];
  return typeof v === 'string' && v.length ? v : def;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = args.token || getEnv('ICREDIT_TOKEN');
  const apiUrl = args.apiUrl || getEnv('ICREDIT_API_URL', 'https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl');
  const forceTest = (args.forceTest === true) || (getEnv('ICREDIT_FORCE_TEST', '') === '1');

  console.log('--- iCredit connectivity diagnose ---');
  try {
    const diag = await diagnoseICreditConnectivity(apiUrl);
    console.log(JSON.stringify({ ok: true, diag }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, message: e?.message || String(e) }, null, 2));
  }

  if (!token) {
    console.log('\nNo ICREDIT_TOKEN provided. Set ICREDIT_TOKEN to attempt a real session creation.');
    process.exit(0);
  }

  const settings = {
    payments: {
      icredit: {
        enabled: true,
        apiUrl,
        groupPrivateToken: token,
        transport: (args.transport || getEnv('ICREDIT_TRANSPORT', 'auto')),
        redirectURL: args.redirect || getEnv('ICREDIT_REDIRECT_URL', 'https://example.com/success'),
        ipnURL: args.ipn || getEnv('ICREDIT_IPN_URL', ''),
        maxPayments: 1,
        createToken: false,
        hideItemList: false
      }
    }
  };

  // Minimal mock order for hosted payment session
  const order = {
    orderNumber: 'TEST-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    currency: 'ILS',
    items: [
      { name: 'Test Item', quantity: 1, price: 1.0, sku: 'SKU-TEST' }
    ],
    totalAmount: 1.0,
    shippingFee: 0,
    customerInfo: { email: 'buyer@example.com', mobile: '+10000000000', firstName: 'Test', lastName: 'User' },
    shippingAddress: { country: 'IL', city: 'Tel Aviv', street: 'Test 1' }
  };

  console.log('\n--- iCredit create-session attempt ---');
  if (forceTest) console.log('ICREDIT_FORCE_TEST=1 active: routing to test host');
  try {
    const { url } = await requestICreditPaymentUrl({ order, settings, overrides: {} });
    console.log(JSON.stringify({ ok: true, url }, null, 2));
  } catch (e) {
    const status = e?.status || 400;
    const msg = e?.message || String(e);
    console.log(JSON.stringify({ ok: false, status, message: msg }, null, 2));
  }
}

main().catch((e) => {
  console.error('Fatal error:', e?.message || e);
  process.exit(1);
});
