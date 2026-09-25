import checkoutNodeJssdk from '@paypal/checkout-server-sdk';
import Settings from '../models/Settings.js';

async function getConfig() {
  // Prefer DB settings; fallback to env if not present
  const settings = await Settings.findOne().lean().exec();
  const cfg = settings?.payments?.paypal || {};
  const clientId = cfg.clientId || process.env.PAYPAL_CLIENT_ID;
  const clientSecret = cfg.secret || process.env.PAYPAL_SECRET;
  const mode = (cfg.mode || process.env.PAYPAL_MODE || 'sandbox').toLowerCase();
  return { clientId, clientSecret, mode };
}

async function environment() {
  const { clientId, clientSecret, mode } = await getConfig();
  if (!clientId || !clientSecret) {
    throw new Error('Missing PayPal credentials. Configure in Admin > Settings or set PAYPAL_CLIENT_ID and PAYPAL_SECRET.');
  }
  if (mode === 'live' || mode === 'production') {
    return new checkoutNodeJssdk.core.LiveEnvironment(clientId, clientSecret);
  }
  return new checkoutNodeJssdk.core.SandboxEnvironment(clientId, clientSecret);
}

export async function getPayPalClient() {
  return new checkoutNodeJssdk.core.PayPalHttpClient(await environment());
}

export const paypalSdk = checkoutNodeJssdk;
