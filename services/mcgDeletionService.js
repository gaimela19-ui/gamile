import McgItemBlock from '../models/McgItemBlock.js';
import McgArchivedItem from '../models/McgArchivedItem.js';
import Settings from '../models/Settings.js';
import { deleteItems as deleteMcgItems, setItemsList as setMcgItemsList, getItemsList as fetchMcgItemsList, updateItem as updateMcgItem } from './mcgService.js';

const DEFAULT_ARCHIVE_ATTRIBUTE_FLAG = '1';
const DEFAULT_RESTORE_ATTRIBUTE_FLAG = '2';

const normalize = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const normalizeLower = (value) => normalize(value).toLowerCase();

async function resolveRemoteMcgItemId(barcode, options = {}) {
  const normalizedBarcode = normalize(barcode);
  if (!normalizedBarcode) return '';
  try {
    const payload = { PageNumber: 1, PageSize: 50 };
    if (options.groupOverride !== undefined) payload.group = options.groupOverride;
    const data = await fetchMcgItemsList({ ...payload, Filter: { Barcode: normalizedBarcode } });
    const list = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []));
    const match = list.find((entry) => normalizeLower(entry?.Barcode ?? entry?.barcode ?? entry?.item_code) === normalizeLower(normalizedBarcode));
    const fallback = list[0];
    const picked = match || fallback;
    if (!picked) return '';
    return normalize(picked?.ItemID ?? picked?.id ?? picked?.itemId ?? picked?.item_id);
  } catch (error) {
    try {
      console.warn('[mcg][resolve-item-id] lookup failed:', error?.message || error);
    } catch {}
    return '';
  }
}

export async function ensureIdentifiersHaveMcgIds(identifiers, options = {}) {
  if (!identifiers || (identifiers.mcgIds && identifiers.mcgIds.size)) {
    return identifiers;
  }
  const firstBarcode = identifiers && identifiers.barcodes ? Array.from(identifiers.barcodes)[0] : null;
  if (!firstBarcode) return identifiers;
  const remoteId = await resolveRemoteMcgItemId(firstBarcode, options);
  if (remoteId) {
    identifiers.mcgIds.add(remoteId);
    if (Array.isArray(identifiers.entries)) {
      identifiers.entries.push({ mcgItemId: remoteId, barcode: firstBarcode });
    }
  }
  return identifiers;
}

function coerceArray(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  return [input];
}

function normalizeIndicator(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (['success', 'ok', 'true', '1'].includes(normalized)) return true;
    if (['error', 'failed', 'fail', 'false', '0', 'ko'].includes(normalized)) return false;
  }
  return null;
}

function extractMcgResponseMessage(resp) {
  if (!resp || typeof resp !== 'object') return '';
  const keys = ['error', 'Error', 'message', 'Message', 'detail', 'Detail', 'reason', 'Reason', 'StatusMessage'];
  for (const key of keys) {
    const value = resp[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function normalizeMcgDeleteResponse(resp) {
  if (!resp || typeof resp !== 'object') {
    return { ok: true };
  }
  if (resp.ok === false) {
    return { ok: false, error: extractMcgResponseMessage(resp) || 'mcg_delete_failed' };
  }
  const verdicts = [
    normalizeIndicator(resp.success),
    normalizeIndicator(resp.Success),
    normalizeIndicator(resp.status),
    normalizeIndicator(resp.Status),
    normalizeIndicator(resp.result),
    normalizeIndicator(resp.Result),
    normalizeIndicator(resp.code),
    normalizeIndicator(resp.Code),
    normalizeIndicator(resp.state),
    normalizeIndicator(resp.State)
  ];
  if (verdicts.includes(false)) {
    return { ok: false, error: extractMcgResponseMessage(resp) || 'mcg_delete_failed' };
  }
  if (resp.error && typeof resp.error === 'string' && resp.error.trim()) {
    return { ok: false, error: resp.error.trim() };
  }
  return { ok: true };
}

export function collectMcgIdentifiers(productDoc, options = {}) {
  const {
    includeVariants = true,
    additionalIdentifiers = [],
    overrideMcgItemId,
    overrideBarcode
  } = options;
  const mcgIds = new Set();
  const barcodes = new Set();
  const entries = [];

  const trackEntry = (mcgItemId, barcode) => {
    const normalizedId = normalize(mcgItemId);
    const normalizedBarcode = normalize(barcode);
    if (!normalizedId && !normalizedBarcode) return;
    if (normalizedId) mcgIds.add(normalizedId);
    if (normalizedBarcode) barcodes.add(normalizedBarcode);
    entries.push({
      mcgItemId: normalizedId || undefined,
      barcode: normalizedBarcode || undefined
    });
  };

  if (productDoc) {
    trackEntry(productDoc.mcgItemId, productDoc.mcgBarcode);
    trackEntry(undefined, productDoc.barcode);
    if (includeVariants && Array.isArray(productDoc.variants)) {
      for (const variant of productDoc.variants) {
        trackEntry(variant?.mcgItemId, variant?.barcode);
      }
    }
  }

  if (overrideMcgItemId || overrideBarcode) {
    trackEntry(overrideMcgItemId, overrideBarcode);
  }

  for (const extra of coerceArray(additionalIdentifiers)) {
    if (!extra) continue;
    if (typeof extra === 'string') {
      trackEntry(undefined, extra);
      continue;
    }
    if (typeof extra === 'object') {
      const mcgId = extra?.mcgItemId ?? extra?.item_id ?? extra?.itemId ?? extra?.id;
      const barcode = extra?.mcgBarcode ?? extra?.barcode ?? extra?.item_code ?? extra?.itemCode ?? extra?.code;
      trackEntry(mcgId, barcode);
    }
  }

  return { mcgIds, barcodes, entries };
}

export async function persistMcgBlocklistEntries(productDoc, userId, reason = 'hard_delete', options = {}) {
  const { identifiers, includeVariants = true, additionalIdentifiers, overrideMcgItemId, overrideBarcode, noteOverride, groupOverride } = options;
  const collectedRaw = identifiers || collectMcgIdentifiers(productDoc, {
    includeVariants,
    additionalIdentifiers,
    overrideMcgItemId,
    overrideBarcode
  });
  const collected = await ensureIdentifiersHaveMcgIds(collectedRaw, { groupOverride });
  const { mcgIds, barcodes } = collected;
  if (!mcgIds.size && !barcodes.size) return;

  const defaultNote = reason === 'soft_delete'
    ? 'Auto-blocked because product was soft deleted'
    : reason === 'manual_delete'
      ? 'Manually blocked via MCG delete action'
      : 'Auto-blocked because product was hard deleted';
  const note = typeof noteOverride === 'string' && noteOverride.trim() ? noteOverride.trim() : defaultNote;

  const insertBase = {
    reason,
    lastProductId: productDoc?._id,
    lastProductName: productDoc?.name || '',
    notes: note,
    ...(userId ? { createdBy: userId } : {})
  };
  const updateBase = {
    reason,
    lastProductId: productDoc?._id,
    lastProductName: productDoc?.name || '',
    notes: note,
    ...(userId ? { updatedBy: userId } : {})
  };

  const ops = [];
  for (const mcgId of mcgIds) {
    ops.push(
      McgItemBlock.findOneAndUpdate(
        { mcgItemId: mcgId },
        {
          $set: { ...updateBase, mcgItemId: mcgId },
          $setOnInsert: { ...insertBase, mcgItemId: mcgId }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    );
  }
  for (const barcode of barcodes) {
    ops.push(
      McgItemBlock.findOneAndUpdate(
        { barcode },
        {
          $set: { ...updateBase, barcode },
          $setOnInsert: { ...insertBase, barcode }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    );
  }

  const results = await Promise.allSettled(ops);
  const rejected = results.filter((r) => r.status === 'rejected');
  if (rejected.length) {
    try {
      console.warn('[mcg][blocklist] upsert failures=%d (reason=%s) first=%s', rejected.length, reason, rejected[0]?.reason?.message || rejected[0]?.reason);
    } catch {}
  }
}

export async function persistMcgArchiveEntries(productDoc, userId, reason = 'manual_archive', options = {}) {
  const { identifiers, includeVariants = true, additionalIdentifiers, overrideMcgItemId, overrideBarcode, noteOverride, groupOverride } = options;
  const collectedRaw = identifiers || collectMcgIdentifiers(productDoc, {
    includeVariants,
    additionalIdentifiers,
    overrideMcgItemId,
    overrideBarcode
  });
  const collected = await ensureIdentifiersHaveMcgIds(collectedRaw, { groupOverride });
  const { mcgIds, barcodes } = collected;
  if (!mcgIds.size && !barcodes.size) return;

  const now = new Date();
  const defaultNote = 'Archived via admin delete';
  const note = typeof noteOverride === 'string' && noteOverride.trim() ? noteOverride.trim() : defaultNote;

  const base = {
    reason,
    notes: note,
    lastProductId: productDoc?._id,
    lastProductName: productDoc?.name || '',
    archivedAt: now,
    ...(userId ? { archivedBy: userId } : {})
  };

  const ops = [];
  for (const mcgId of mcgIds) {
    ops.push(
      McgArchivedItem.findOneAndUpdate(
        { mcgItemId: mcgId },
        {
          $set: { ...base, mcgItemId: mcgId },
          $setOnInsert: { ...base, mcgItemId: mcgId }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    );
  }
  for (const barcode of barcodes) {
    ops.push(
      McgArchivedItem.findOneAndUpdate(
        { barcode },
        {
          $set: { ...base, barcode },
          $setOnInsert: { ...base, barcode }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    );
  }

  const results = await Promise.allSettled(ops);
  const rejected = results.filter((r) => r.status === 'rejected');
  if (rejected.length) {
    try {
      console.warn('[mcg][archived] upsert failures=%d (reason=%s) first=%s', rejected.length, reason, rejected[0]?.reason?.message || rejected[0]?.reason);
    } catch {}
  }
}

export async function propagateMcgDeletion(productDoc, options = {}) {
  const {
    identifiers,
    includeVariants = true,
    additionalIdentifiers,
    overrideMcgItemId,
    overrideBarcode,
    settingsDoc,
    groupOverride,
    allowWhenDisabled = false
  } = options;

  const collectedRaw = identifiers || collectMcgIdentifiers(productDoc, {
    includeVariants,
    additionalIdentifiers,
    overrideMcgItemId,
    overrideBarcode
  });
  const collected = await ensureIdentifiersHaveMcgIds(collectedRaw, { groupOverride });
  const { mcgIds, barcodes, entries = [] } = collected;
  if (!mcgIds.size && !barcodes.size) {
    return { skipped: true, reason: 'no_identifiers' };
  }

  const payload = [];
  const seen = new Set();
  const appendPayload = (itemId, itemCode) => {
    const normalizedId = normalize(itemId);
    const normalizedCode = normalize(itemCode);
    if (normalizedId) {
      const key = `id:${normalizedId}`;
      if (seen.has(key)) return;
      seen.add(key);
      payload.push({ item_id: normalizedId });
      return;
    }
    if (normalizedCode) {
      const key = `code:${normalizedCode}`;
      if (seen.has(key)) return;
      seen.add(key);
      payload.push({ item_code: normalizedCode });
    }
  };

  if (entries.length) {
    for (const entry of entries) {
      appendPayload(entry?.mcgItemId, entry?.barcode);
    }
  }

  if (!payload.length) {
    for (const mcgId of mcgIds) appendPayload(mcgId);
    if (!mcgIds.size) {
      for (const barcode of barcodes) appendPayload(undefined, barcode);
    }
  }

  let resolvedGroup = Number.isFinite(Number(groupOverride)) ? Number(groupOverride) : undefined;
  let mcgConfig = settingsDoc?.mcg ?? settingsDoc ?? null;
  if (!mcgConfig) {
    const settings = await Settings.findOne().select('mcg').lean();
    mcgConfig = settings?.mcg || null;
  }
  let disabled = false;
  if (mcgConfig) {
    if (resolvedGroup === undefined) {
      const parsed = Number(mcgConfig.group);
      if (Number.isFinite(parsed)) resolvedGroup = parsed;
    }
    if (mcgConfig.enabled === false) disabled = true;
  }

  if (disabled && !allowWhenDisabled) {
    return { skipped: true, reason: 'mcg_disabled' };
  }

  const res = await deleteMcgItems(payload, resolvedGroup);
  const normalized = normalizeMcgDeleteResponse(res);
  try {
    console.log('[mcg][delete] propagated product=%s identifiers=%d', productDoc?._id || 'n/a', payload.length);
  } catch {}
  const base = (res && typeof res === 'object') ? res : {};
  return { ...base, ...normalized };
}

export async function markMcgItemsArchived(productDoc, options = {}) {
  const { archiveAttributeValue, zeroOutInventory } = options;
  return applyMcgAttributeUpdate(productDoc, {
    ...options,
    attributeValue: archiveAttributeValue ?? DEFAULT_ARCHIVE_ATTRIBUTE_FLAG,
    fallbackAttributeValue: DEFAULT_ARCHIVE_ATTRIBUTE_FLAG,
    zeroInventory: zeroOutInventory !== undefined ? !!zeroOutInventory : true,
    defaultAdsMessage: 'Archived product (removed from catalog)'
  });
}

export async function restoreMcgItemsFromArchive(productDoc, options = {}) {
  const { restoreAttributeValue } = options;
  return applyMcgAttributeUpdate(productDoc, {
    ...options,
    attributeValue: restoreAttributeValue ?? DEFAULT_RESTORE_ATTRIBUTE_FLAG,
    fallbackAttributeValue: DEFAULT_RESTORE_ATTRIBUTE_FLAG,
    zeroInventory: false,
    defaultAdsMessage: 'Product restored from archive'
  });
}

async function applyMcgAttributeUpdate(productDoc, config = {}) {
  const {
    identifiers,
    includeVariants = true,
    additionalIdentifiers,
    overrideMcgItemId,
    overrideBarcode,
    settingsDoc,
    groupOverride,
    allowWhenDisabled = false,
    attributes,
    extraAttributes,
    attributeValue,
    fallbackAttributeValue,
    itemAds,
    defaultAdsMessage = '',
    zeroInventory = false,
    sendUpdateItemRequest = false
  } = config;

  const collectedRaw = identifiers || collectMcgIdentifiers(productDoc, {
    includeVariants,
    additionalIdentifiers,
    overrideMcgItemId,
    overrideBarcode
  });
  const collected = await ensureIdentifiersHaveMcgIds(collectedRaw, { groupOverride });
  const entries = Array.isArray(collected?.entries) ? collected.entries : [];
  if (!entries.length) {
    return { skipped: true, reason: 'no_identifiers' };
  }

  const seen = new Set();
  const unique = [];
  for (const entry of entries) {
    const mcgId = normalize(entry?.mcgItemId);
    const barcode = normalize(entry?.barcode);
    if (!mcgId && !barcode) continue;
    const key = `${mcgId || ''}::${barcode || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ mcgId, barcode });
  }
  if (!unique.length) {
    return { skipped: true, reason: 'no_identifiers' };
  }

  let resolvedGroup = Number.isFinite(Number(groupOverride)) ? Number(groupOverride) : undefined;
  let mcgConfig = settingsDoc?.mcg ?? settingsDoc ?? null;
  if (!mcgConfig) {
    const settings = await Settings.findOne().select('mcg').lean();
    mcgConfig = settings?.mcg || null;
  }
  let disabled = false;
  if (mcgConfig) {
    if (mcgConfig.enabled === false) disabled = true;
    if (resolvedGroup === undefined) {
      const parsed = Number(mcgConfig.group);
      if (Number.isFinite(parsed)) resolvedGroup = parsed;
    }
  }
  if (disabled && !allowWhenDisabled) {
    return { skipped: true, reason: 'mcg_disabled' };
  }

  const attrSet = new Set();
  const ingestAttr = (value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((val) => ingestAttr(val));
      return;
    }
    if (typeof value === 'string') {
      value
        .split(/[,;|]/)
        .map((segment) => segment.trim().toLowerCase())
        .filter(Boolean)
        .forEach((segment) => attrSet.add(segment));
      return;
    }
    ingestAttr(String(value));
  };
  ingestAttr(attributes);
  ingestAttr(extraAttributes);
  const normalizedAttribute = String(attributeValue || fallbackAttributeValue || '').trim().toLowerCase();
  if (normalizedAttribute) attrSet.add(normalizedAttribute);
  if (!attrSet.size && fallbackAttributeValue) {
    attrSet.add(String(fallbackAttributeValue).trim().toLowerCase());
  }
  const attributePayload = Array.from(attrSet).join(',');

  const adsValue = typeof itemAds === 'string' && itemAds.trim()
    ? itemAds.trim()
    : (defaultAdsMessage || '');

  const payload = unique.map(({ mcgId, barcode }) => {
    const doc = {};
    if (zeroInventory) {
      doc.item_inventory = 0;
    }
    if (mcgId) {
      doc.item_id = mcgId;
    } else if (barcode) {
      doc.item_code = barcode;
    }
    if (attributePayload) doc.item_attribute = attributePayload;
    if (adsValue) doc.item_ads = adsValue;
    return doc;
  });

  if (!payload.length) {
    return { skipped: true, reason: 'no_identifiers' };
  }

  try {
    const mcgResponse = await setMcgItemsList(payload, resolvedGroup);
    let updateItemResponses = null;
    if (sendUpdateItemRequest) {
      try {
        updateItemResponses = await pushUpdateItemAttribute(unique, attributePayload, adsValue, resolvedGroup);
      } catch (updateErr) {
        try { console.warn('[mcg][update-item] attribute push failed:', updateErr?.message || updateErr); } catch {}
        updateItemResponses = { ok: false, error: updateErr?.message || 'mcg_update_item_failed' };
      }
    }
    try { console.log('[mcg][attr] updated=%d attrs=%s', payload.length, attributePayload); } catch {}
    return {
      attempted: true,
      ok: true,
      updatedCount: payload.length,
      attributes: attributePayload,
      itemAds: adsValue,
      identifiers: { total: unique.length },
      mcgResponse,
      updateItem: updateItemResponses
    };
  } catch (error) {
    try { console.warn('[mcg][attr] failed:', error?.message || error); } catch {}
    return {
      attempted: true,
      ok: false,
      error: error?.message || 'mcg_archive_failed'
    };
  }
}

async function pushUpdateItemAttribute(entries, attributeValue, adsValue, group) {
  if (!Array.isArray(entries) || !entries.length) return [];
  const jobs = entries.map(async ({ mcgId, barcode }) => {
    const payload = { item_attribute: attributeValue };
    if (adsValue) payload.item_ads = adsValue;
    if (mcgId) payload.item_id = mcgId;
    else if (barcode) payload.item_code = barcode;
    if (!payload.item_id && !payload.item_code) {
      return { ok: false, skipped: true, reason: 'no_identifier', mcgId, barcode };
    }
    try {
      const response = await updateMcgItem(payload, group);
      const ok = response?.ok !== false && !response?.skipped;
      return { ok, response, mcgId, barcode };
    } catch (error) {
      try { console.warn('[mcg][update-item] failed for %s/%s: %s', mcgId || '', barcode || '', error?.message || error); } catch {}
      return { ok: false, error: error?.message || 'mcg_update_item_failed', mcgId, barcode };
    }
  });
  return await Promise.all(jobs);
}
