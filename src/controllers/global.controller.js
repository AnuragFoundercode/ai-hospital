const { pool } = require('../config/database');

// ─────────────────────────────────────────────
// GLOBAL CONTROLLER - Public APIs (no token)
// ─────────────────────────────────────────────

/**
 * GET /api/v1/global/states
 */
const getStates = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, code FROM states WHERE is_active = 1 ORDER BY name');
    return res.status(200).json({ message: 'States fetched.', data: rows });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/global/zones?state_code=UP
 */
const getZonesByState = async (req, res) => {
  try {
    const { state_code } = req.query;

    if (!state_code) {
      return res.status(400).json({ message: 'state_code query param required.' });
    }

    // Get state name from code
    const [stateRows] = await pool.query('SELECT name FROM states WHERE code = ? AND is_active = 1', [state_code.toUpperCase()]);
    if (!stateRows.length) {
      return res.status(404).json({ message: 'State not found.' });
    }

    const stateName = stateRows[0].name;
    const [rows] = await pool.query('SELECT id, name, state, pincodes FROM zones WHERE state = ? AND is_active = 1 ORDER BY name', [stateName]);

    return res.status(200).json({
      message: 'Zones fetched.',
      data: rows.map((z) => ({
        id: z.id,
        name: z.name,
        state: z.state,
        pincodes: typeof z.pincodes === 'string' ? JSON.parse(z.pincodes) : z.pincodes,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/global/validate-pincode
 * Body: { pincode, zone_name }
 * Validates pincode exists in given zone
 */
const validatePincode = async (req, res) => {
  try {
    const { pincode, zone_name } = req.body;

    if (!pincode) {
      return res.status(400).json({ message: 'pincode required.' });
    }

    let where = 'is_active = 1';
    let params = [];

    if (zone_name) {
      where += ' AND name = ?';
      params.push(zone_name);
    }

    const [rows] = await pool.query(`SELECT id, name, state, pincodes FROM zones WHERE ${where}`, params);

    let matchedZone = null;
    for (const zone of rows) {
      const pincodes = typeof zone.pincodes === 'string' ? JSON.parse(zone.pincodes) : zone.pincodes;
      if (pincodes.includes(pincode)) {
        matchedZone = { zone_id: zone.id, zone_name: zone.name, state: zone.state };
        break;
      }
    }

    if (!matchedZone) {
      return res.status(404).json({ message: 'Pincode not found in any active zone.', data: { pincode, zone_name: zone_name || null, valid: false } });
    }

    return res.status(200).json({
      message: 'Pincode valid.',
      data: { pincode, valid: true, ...matchedZone },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getStates,
  getZonesByState,
  validatePincode,
};
