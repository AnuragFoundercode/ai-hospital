const { pool } = require('../../config/database');
const distanceService = require('../../services/distance.service');

// ─────────────────────────────────────────────
// USER AMBULANCE CONTROLLER
// Uses: ambulance_services (provider/driver), ambulance_types (categories), ambulance_vehicles
// ─────────────────────────────────────────────

/**
 * GET /api/v1/user/ambulance/categories
 */
const getCategories = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, description, icon_url, base_fare, per_km_charge FROM ambulance_types WHERE is_active = 1 ORDER BY sort_order');
    return res.status(200).json({ message: 'Ambulance categories fetched.', data: rows });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/user/ambulances?pincode=&type_id=&user_lat=&user_lng=
 * List available ambulances (from ambulance_services + vehicles)
 */
const getAmbulanceList = async (req, res) => {
  try {
    const { pincode, type_id, user_lat, user_lng } = req.query;

    let where = ['asv.is_active = 1', 'asv.is_available = 1', 'asr.is_active = 1', 'asr.is_verified = 1', 'asr.is_online = 1'];
    let params = [];

    // Zone filter by pincode
    if (pincode) {
      const [zoneRows] = await pool.query("SELECT id FROM zones WHERE is_active = 1 AND JSON_CONTAINS(pincodes, ?)", [JSON.stringify(pincode)]);
      if (zoneRows.length) { where.push('asr.zone_id = ?'); params.push(zoneRows[0].id); }
      else { return res.status(200).json({ message: 'No ambulance available in this pincode.', data: [] }); }
    }

    if (type_id) { where.push('asv.ambulance_type_id = ?'); params.push(parseInt(type_id)); }

    const whereClause = where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT asv.id as vehicle_id, asv.vehicle_number, asv.vehicle_model,
              asr.id as service_id, asr.uuid, asr.name, asr.owner_name, asr.mobile, asr.profile_photo, asr.base_latitude, asr.base_longitude, asr.latitude, asr.longitude, asr.is_online, asr.base_fare as service_base_fare, asr.per_km_charge as service_per_km,
              at.id as type_id, at.name as type_name, at.base_fare as type_base_fare, at.per_km_charge as type_per_km, at.description as type_description, at.icon_url as type_icon
       FROM ambulance_vehicles asv
       JOIN ambulance_services asr ON asv.ambulance_service_id = asr.id
       JOIN ambulance_types at ON asv.ambulance_type_id = at.id
       WHERE ${whereClause}`,
      params
    );

    // Calculate distance from user
    const ambulances = rows.map(r => {
      let distanceInfo = null;
      if (user_lat && user_lng && (r.latitude || r.base_latitude) && (r.longitude || r.base_longitude)) {
        const lat = parseFloat(r.latitude || r.base_latitude);
        const lng = parseFloat(r.longitude || r.base_longitude);
        const km = distanceService.haversine(parseFloat(user_lat), parseFloat(user_lng), lat, lng);
        distanceInfo = { distance_km: parseFloat(km.toFixed(2)), eta_minutes: Math.ceil(km * 3) };
      }

      return {
        id: r.uuid,
        vehicle_id: r.vehicle_id,
        name: r.name,
        owner_name: r.owner_name,
        profile_photo: r.profile_photo,
        mobile: r.mobile,
        vehicle: { number: r.vehicle_number, model: r.vehicle_model },
        type: { id: r.type_id, name: r.type_name, base_fare: r.type_base_fare, per_km_charge: r.type_per_km, icon: r.type_icon },
        base_fare: r.service_base_fare || r.type_base_fare,
        per_km_charge: r.service_per_km || r.type_per_km,
        is_online: r.is_online,
        distance: distanceInfo,
      };
    });

    // Sort by nearest
    if (user_lat && user_lng) ambulances.sort((a, b) => (a.distance?.distance_km || 999) - (b.distance?.distance_km || 999));

    return res.status(200).json({ message: 'Ambulances fetched.', data: ambulances, total: ambulances.length });
  } catch (error) {
    console.error('getAmbulanceList error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/user/ambulance/:uuid?user_lat=&user_lng=
 */
const getAmbulanceDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const { user_lat, user_lng } = req.query;

    const [rows] = await pool.query(
      `SELECT asr.*, asv.vehicle_number, asv.vehicle_model, asv.ambulance_type_id,
              at.name as type_name, at.base_fare as type_base_fare, at.per_km_charge as type_per_km, at.description as type_description
       FROM ambulance_services asr
       LEFT JOIN ambulance_vehicles asv ON asv.ambulance_service_id = asr.id AND asv.is_active = 1
       LEFT JOIN ambulance_types at ON asv.ambulance_type_id = at.id
       WHERE asr.uuid = ? AND asr.is_active = 1`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ message: 'Ambulance not found.' });
    const r = rows[0];

    let distanceInfo = null;
    if (user_lat && user_lng && r.base_latitude && r.base_longitude) {
      distanceInfo = await distanceService.getDistance(parseFloat(user_lat), parseFloat(user_lng), parseFloat(r.base_latitude), parseFloat(r.base_longitude));
    }

    return res.status(200).json({
      message: 'Ambulance detail fetched.',
      data: {
        id: r.uuid,
        name: r.name,
        owner_name: r.owner_name,
        mobile: r.mobile,
        profile_photo: r.profile_photo,
        registration_number: r.registration_number,
        vehicle: { number: r.vehicle_number, model: r.vehicle_model },
        type: { id: r.ambulance_type_id, name: r.type_name, base_fare: r.type_base_fare, per_km_charge: r.type_per_km, description: r.type_description },
        location: { city: r.city, state: r.state, latitude: r.base_latitude, longitude: r.base_longitude, coverage_radius_km: r.coverage_radius_km },
        fare: { base_fare: r.base_fare || r.type_base_fare, per_km_charge: r.per_km_charge || r.type_per_km },
        is_verified: r.is_verified,
        distance_from_user: distanceInfo,
      },
    });
  } catch (error) {
    console.error('getAmbulanceDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = { getCategories, getAmbulanceList, getAmbulanceDetail };
