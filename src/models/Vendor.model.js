const { pool } = require('../config/database');

/**
 * Vendor Model - For Service Providers
 * (Doctors, Pharmacies, Pathology Labs, Blood Banks, Diagnostic Centers, Ambulance Services)
 */
class VendorModel {
  async create(vendorData) {
    const {
      uuid, vendor_type, name, contact_person, mobile, email,
      password_hash, business_name, business_registration_number,
      gst_number, pan_number, license_number
    } = vendorData;

    const [result] = await pool.query(
      `INSERT INTO vendors (uuid, vendor_type, name, contact_person, mobile, email, password_hash, business_name, business_registration_number, gst_number, pan_number, license_number) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid, vendor_type, name, contact_person, mobile, email, password_hash, business_name, business_registration_number, gst_number, pan_number, license_number]
    );
    return result;
  }

  async findByMobile(mobile) {
    const [rows] = await pool.query('SELECT * FROM vendors WHERE mobile = ?', [mobile]);
    return rows[0] || null;
  }

  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM vendors WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async findByUuid(uuid) {
    const [rows] = await pool.query('SELECT * FROM vendors WHERE uuid = ?', [uuid]);
    return rows[0] || null;
  }

  async findByType(vendorType) {
    const [rows] = await pool.query('SELECT * FROM vendors WHERE vendor_type = ? AND is_active = 1 AND is_verified = 1', [vendorType]);
    return rows;
  }

  async updateProfile(id, data) {
    const fields = Object.keys(data).map((key) => `${key} = ?`).join(', ');
    const values = Object.values(data);
    const [result] = await pool.query(
      `UPDATE vendors SET ${fields} WHERE id = ?`,
      [...values, id]
    );
    return result;
  }

  async updateVerificationStatus(id, status, reason = null) {
    const [result] = await pool.query(
      `UPDATE vendors SET verification_status = ?, rejection_reason = ?, verified_at = IF(? = 'approved', NOW(), NULL), is_verified = IF(? = 'approved', 1, 0) WHERE id = ?`,
      [status, reason, status, status, id]
    );
    return result;
  }

  async updateDocuments(id, documents) {
    const fields = Object.keys(documents).map((key) => `${key} = ?`).join(', ');
    const values = Object.values(documents);
    const [result] = await pool.query(
      `UPDATE vendors SET ${fields} WHERE id = ?`,
      [...values, id]
    );
    return result;
  }

  async updateFcmToken(id, fcmToken) {
    const [result] = await pool.query(
      'UPDATE vendors SET fcm_token = ? WHERE id = ?',
      [fcmToken, id]
    );
    return result;
  }
}

module.exports = new VendorModel();
