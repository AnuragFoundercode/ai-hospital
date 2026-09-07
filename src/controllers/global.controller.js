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

/**
 * GET /api/v1/global/help-support?type=user
 * Global contact (same for everyone) + FAQs filtered by audience.
 * type: user | doctor | pharmacy | pathology_lab | diagnostic_center | blood_bank | ambulance_service | delivery_partner | sample_collector
 * FAQs returned = those matching the given type PLUS common 'all' ones.
 */
const VALID_AUDIENCES = ['user', 'doctor', 'pharmacy', 'pathology_lab', 'diagnostic_center', 'blood_bank', 'ambulance_service', 'delivery_partner', 'sample_collector'];

const getHelpSupport = async (req, res) => {
  try {
    const type = req.query.type;

    // Contact (single row)
    const [cfgRows] = await pool.query('SELECT contact_number, contact_email, whatsapp_number FROM support_config ORDER BY id ASC LIMIT 1');
    const contact = cfgRows[0] || { contact_number: null, contact_email: null, whatsapp_number: null };

    // FAQs: 'all' always; plus the requested audience if it's valid
    let faqs;
    if (type && VALID_AUDIENCES.includes(type)) {
      const [rows] = await pool.query(
        `SELECT id, audience, question, answer FROM faqs
         WHERE is_active = 1 AND (audience = 'all' OR audience = ?)
         ORDER BY FIELD(audience, ?, 'all'), sort_order ASC, id ASC`,
        [type, type]
      );
      faqs = rows;
    } else {
      // No/invalid type -> only common FAQs
      const [rows] = await pool.query(
        "SELECT id, audience, question, answer FROM faqs WHERE is_active = 1 AND audience = 'all' ORDER BY sort_order ASC, id ASC"
      );
      faqs = rows;
    }

    return res.status(200).json({
      message: 'Help & support fetched.',
      data: {
        contact: {
          phone: contact.contact_number,
          email: contact.contact_email,
          whatsapp: contact.whatsapp_number,
        },
        faqs,
      },
    });
  } catch (error) {
    console.error('getHelpSupport error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/global/policies
 * List all active policies (title + slug). Content excluded to keep it light.
 */
const getPolicies = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, slug, updated_at FROM policies WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'
    );
    return res.status(200).json({ message: 'Policies fetched.', data: rows });
  } catch (error) {
    console.error('getPolicies error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/global/policies/:slug
 * Full content of a single policy.
 */
const getPolicyBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const [rows] = await pool.query(
      'SELECT id, title, slug, content, updated_at FROM policies WHERE slug = ? AND is_active = 1',
      [slug]
    );
    if (!rows.length) return res.status(404).json({ message: 'Policy not found.' });
    return res.status(200).json({ message: 'Policy fetched.', data: rows[0] });
  } catch (error) {
    console.error('getPolicyBySlug error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getStates,
  getZonesByState,
  validatePincode,
  getHelpSupport,
  getPolicies,
  getPolicyBySlug,
};
