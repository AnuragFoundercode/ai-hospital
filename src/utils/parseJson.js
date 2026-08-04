/**
 * Safely parse JSON - handles both string and already-parsed objects
 * MySQL2 sometimes auto-parses JSON columns
 */
const parseJson = (data) => {
  if (!data) return {};
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch (e) {
      return {};
    }
  }
  return data;
};

module.exports = parseJson;
