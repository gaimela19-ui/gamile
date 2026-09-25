#!/usr/bin/env node
import dbManager from '../services/dbManager.js';
import Settings from '../models/Settings.js';

function normalizeGuidLike(s) {
  if (!s) return '';
  return String(s).replace(/\s+/g, '').trim();
}

function normalizeScope(s) {
  if (!s) return '';
  let v = String(s).trim();
  // Remove accidental spaces inside GUID and around .default
  v = v.replace(/\s+/g, '');
  // Ensure ".default" suffix is correct
  v = v.replace(/\.default$/i, '.default');
  return v;
}

async function main() {
  // Provided by user (trimmed/normalized below)
  const provided = {
    apiFlavor: 'uplicali',
    baseUrl: 'https://apis.uplicali.com/SuperMCG/MCG_API',
    tokenUrl: 'https://login.uplicali.com/mcg',
    clientId: 'bb08b4ea-002a-4618-9696 -a9a1c7cba5c8',
    clientSecret: 'vLU8Q~ipfYAHt~ HDT-2pn6E14xhpnBIHVLD.9cPS',
    scope: 'api://bb08b4ea-002a -4618-9696-a9a1c7cba5c8/. default',
    accessKey: '638a0dff26ba453692769ac3fc8a59 7e',
    retailerKey: 'dbf94772-fc00-48a0-8f21-87f29c8e3861',
    retailerClientId: 'My Pet',
    // vendorCode is unknown from the provided data; leaving empty so user can fill later
    vendorCode: ''
  };

  // Normalize
  const norm = {
    enabled: true,
    apiFlavor: 'uplicali',
    baseUrl: provided.baseUrl.replace(/\/$/, ''),
    tokenUrl: provided.tokenUrl,
    clientId: normalizeGuidLike(provided.clientId),
    clientSecret: provided.clientSecret.replace(/\s+/g, ''),
    scope: normalizeScope(provided.scope),
    extraHeaderName: 'Ocp-Apim-Subscription-Key',
    extraHeaderValue: provided.accessKey.replace(/\s+/g, ''),
    vendorCode: provided.vendorCode,
    retailerKey: normalizeGuidLike(provided.retailerKey),
    retailerClientId: (provided.retailerClientId || '').trim(),
    apiVersion: 'v2.6'
  };

  // Connect DB
  await dbManager.connectWithRetry();
  let s = await Settings.findOne();
  if (!s) s = new Settings();
  s.mcg = s.mcg || {};
  // Apply only if provided (avoid accidentally blanking secrets)
  s.mcg.enabled = true;
  s.mcg.apiFlavor = norm.apiFlavor;
  s.mcg.baseUrl = norm.baseUrl;
  s.mcg.tokenUrl = norm.tokenUrl;
  if (norm.clientId) s.mcg.clientId = norm.clientId;
  if (norm.clientSecret) s.mcg.clientSecret = norm.clientSecret;
  if (norm.scope) s.mcg.scope = norm.scope;
  s.mcg.apiVersion = norm.apiVersion;
  s.mcg.extraHeaderName = norm.extraHeaderName;
  if (norm.extraHeaderValue) s.mcg.extraHeaderValue = norm.extraHeaderValue;
  if (norm.vendorCode) s.mcg.vendorCode = norm.vendorCode;
  if (norm.retailerKey) s.mcg.retailerKey = norm.retailerKey;
  if (norm.retailerClientId) s.mcg.retailerClientId = norm.retailerClientId;

  try { s.markModified('mcg'); } catch {}
  await s.save();

  // Show masked summary
  const out = {
    enabled: s.mcg.enabled,
    apiFlavor: s.mcg.apiFlavor,
    baseUrl: s.mcg.baseUrl,
    tokenUrl: s.mcg.tokenUrl,
    clientId: s.mcg.clientId ? '***' : '',
    clientSecret: s.mcg.clientSecret ? '***' : '',
    scope: s.mcg.scope || '',
    apiVersion: s.mcg.apiVersion,
    extraHeaderName: s.mcg.extraHeaderName || '',
    extraHeaderValue: s.mcg.extraHeaderValue ? '***' : '',
    vendorCode: s.mcg.vendorCode || '',
    retailerKey: s.mcg.retailerKey ? '***' : '',
    retailerClientId: s.mcg.retailerClientId || ''
  };
  console.log('[MCG config applied]', JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('Failed to apply MCG config:', e?.message || e);
  process.exit(1);
});
