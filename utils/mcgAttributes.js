const ATTRIBUTE_FIELD_KEYS = [
  'item_attribute',
  'itemAttribute',
  'ItemAttribute',
  'item_attributes',
  'ItemAttributes',
  'attributes',
  'Attributes'
];

const ARCHIVE_ATTRIBUTE_TOKENS = new Set(['archived', 'archive', 'archived_product', '1']);
const RESTORE_ATTRIBUTE_TOKENS = new Set(['2', 'active', 'restored', 'unarchived']);

const ATTRIBUTE_SPLIT_REGEX = /[,;|]/;

function pickRawAttributeSource(source) {
  if (!source) return undefined;
  if (typeof source === 'string' || Array.isArray(source)) return source;
  if (typeof source === 'object') {
    for (const key of ATTRIBUTE_FIELD_KEYS) {
      if (Object.prototype.hasOwnProperty.call(source, key) && source[key] != null) {
        return source[key];
      }
    }
  }
  return source;
}

function consumeValue(value, sink) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((entry) => consumeValue(entry, sink));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((entry) => consumeValue(entry, sink));
    return;
  }
  const str = String(value).trim();
  if (!str) return;
  const segments = str.split(ATTRIBUTE_SPLIT_REGEX).map((segment) => segment.trim()).filter(Boolean);
  if (segments.length > 1) {
    segments.forEach((segment) => consumeValue(segment, sink));
    return;
  }
  sink(str.toLowerCase());
}

export function extractMcgAttributeTags(source) {
  const raw = pickRawAttributeSource(source);
  const tags = new Set();
  consumeValue(raw, (tag) => {
    if (tag) tags.add(tag);
  });
  return Array.from(tags);
}

export function hasArchivedAttribute(source) {
  const tags = extractMcgAttributeTags(source);
  if (!tags.length) return false;
  const hasRestoreFlag = tags.some(tag => RESTORE_ATTRIBUTE_TOKENS.has(tag));
  if (hasRestoreFlag) return false;
  return tags.some(tag => ARCHIVE_ATTRIBUTE_TOKENS.has(tag));
}
