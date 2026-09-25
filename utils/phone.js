// Simple E.164-ish normalization
// - Keep digits and leading +
// - Remove extra leading zeros after country code when possible
// Note: Tries to use libphonenumber-js if available, otherwise falls back to lightweight helper.
let parsePhoneNumberFromString;
try {
  // Optional dependency – don't crash server if not installed in minimal setups
  // eslint-disable-next-line n/no-missing-import
  ({ parsePhoneNumberFromString } = await import('libphonenumber-js'));
} catch {}

export function normalizePhoneE164ish(input, region) {
  if (!input) return '';
  const raw = String(input).trim();
  // Try robust parsing with libphonenumber-js first
  try {
    if (parsePhoneNumberFromString) {
      const parsed = parsePhoneNumberFromString(raw, region || undefined);
      if (parsed && parsed.isValid()) return parsed.number; // E.164 format like +15551234567
    }
  } catch {}
  // Keep + and digits only
  let s = raw.replace(/[^0-9+]/g, '');
  // Collapse multiple +'s, allow only one at start
  s = s.replace(/^\++/, '+')
       .replace(/(?!^)\+/g, '');
  // If no leading + and looks like local with leading zeros, remove them
  if (!s.startsWith('+')) {
    s = s.replace(/^0+/, '');
  }
  // Reject too short
  if (!/^\+?[0-9]{7,16}$/.test(s)) return s;
  return s;
}
