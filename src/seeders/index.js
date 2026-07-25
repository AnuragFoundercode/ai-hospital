const { pool } = require('../config/database');

/**
 * Database Seeder
 * Add initial data for development/testing
 */
const seed = async () => {
  try {
    console.log('🌱 Seeding database...');

    // Add super admin
    const [existing] = await pool.query('SELECT id FROM users WHERE role = ?', ['super_admin']);

    if (existing.length === 0) {
      await pool.query(
        `INSERT INTO users (uuid, full_name, mobile, role, is_verified) VALUES (?, ?, ?, ?, ?)`,
        ['admin-uuid-001', 'Super Admin', '9999999999', 'super_admin', 1]
      );
      console.log('✅ Super Admin created');
    }

    console.log('🎉 Seeding completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  }
};

seed();
