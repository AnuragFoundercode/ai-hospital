const { pool } = require('../config/database');

/**
 * User Model - For Patients / End Users only
 */
class UserModel {
  async create(userData) {
    const { uuid, full_name, mobile, email, gender, date_of_birth } = userData;
    const [result] = await pool.query(
      'INSERT INTO users (uuid, full_name, mobile, email, gender, date_of_birth) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid, full_name, mobile, email, gender, date_of_birth]
    );
    return result;
  }

  async findByMobile(mobile) {
    const [rows] = await pool.query('SELECT * FROM users WHERE mobile = ?', [mobile]);
    return rows[0] || null;
  }

  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async findByUuid(uuid) {
    const [rows] = await pool.query('SELECT * FROM users WHERE uuid = ?', [uuid]);
    return rows[0] || null;
  }

  async updateProfile(id, data) {
    const fields = Object.keys(data).map((key) => `${key} = ?`).join(', ');
    const values = Object.values(data);
    const [result] = await pool.query(
      `UPDATE users SET ${fields} WHERE id = ?`,
      [...values, id]
    );
    return result;
  }

  async updateFcmToken(id, fcmToken) {
    const [result] = await pool.query(
      'UPDATE users SET fcm_token = ? WHERE id = ?',
      [fcmToken, id]
    );
    return result;
  }

  async verifyUser(id) {
    const [result] = await pool.query(
      'UPDATE users SET is_verified = 1 WHERE id = ?',
      [id]
    );
    return result;
  }
}

module.exports = new UserModel();
