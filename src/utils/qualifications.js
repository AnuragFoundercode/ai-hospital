/**
 * Normalize a qualifications input into a clean JSON string (or null).
 * Accepts an array of { name, url }. Ignores entries missing url.
 * Returns null if nothing valid (so the DB column stays NULL) OR undefined
 * if the caller didn't send the field at all (so we can skip updating it).
 */
const normalizeQualifications = (input) => {
  if (input === undefined) return undefined; // field not sent -> don't touch
  if (input === null) return null;
  if (!Array.isArray(input)) return null;
  const cleaned = input
    .filter((q) => q && q.url)
    .map((q) => ({ name: q.name || 'Qualification', url: q.url }));
  return cleaned.length ? JSON.stringify(cleaned) : null;
};

/** Parse the stored JSON back to an array for API responses. */
const parseQualifications = (stored) => {
  if (!stored) return [];
  try {
    const arr = typeof stored === 'string' ? JSON.parse(stored) : stored;
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
};

module.exports = { normalizeQualifications, parseQualifications };
