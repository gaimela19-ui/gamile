#!/usr/bin/env node
import dbManager from '../services/dbManager.js';
import { getItemsList } from '../services/mcgService.js';

const target = String(process.argv[2] || '').trim();
if (!target) {
  console.error('Usage: node server/scripts/check-mcg-quantity.mjs <item_id_or_code>');
  process.exit(2);
}

const norm = (v) => (v === undefined || v === null ? '' : String(v).trim());

try {
  await dbManager.connectWithRetry();

  const data = await getItemsList({});
  const items = Array.isArray(data?.items)
    ? data.items
    : (Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []));

  const found = items.find((x) => {
    const id = norm(x?.item_id ?? x?.ItemID ?? x?.id ?? x?.itemId);
    const code = norm(x?.item_code ?? x?.ItemCode ?? x?.Barcode ?? x?.barcode);
    return id === target || code === target;
  });

  if (!found) {
    console.log('[mcg][check] not found', JSON.stringify({ target, total: items.length }));
    process.exit(1);
  }

  const itemId = norm(found?.item_id ?? found?.ItemID ?? found?.id ?? found?.itemId);
  const itemCode = norm(found?.item_code ?? found?.ItemCode ?? found?.Barcode ?? found?.barcode);
  const quantityRaw = found?.item_inventory ?? found?.StockQuantity ?? found?.stock;
  const quantityNum = Number(quantityRaw);

  console.log('[mcg][check]', JSON.stringify({
    target,
    foundBy: itemId === target ? 'item_id' : 'item_code',
    item_id: itemId,
    item_code: itemCode,
    quantityRaw,
    quantity: Number.isFinite(quantityNum) ? quantityNum : null
  }, null, 2));

  process.exit(0);
} catch (e) {
  console.error('[mcg][check][fail]', e?.message || e);
  process.exit(1);
}
