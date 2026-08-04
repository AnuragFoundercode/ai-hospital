const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');

/**
 * Database Seeder
 */
const seed = async () => {
  try {
    console.log('🌱 Seeding database...');

    // Add super admin
    const [existing] = await pool.query('SELECT id FROM admins WHERE email = ?', ['admin@aihospital.com']);

    if (existing.length === 0) {
      const hashedPassword = await bcrypt.hash('Admin@123', 10);
      await pool.query(
        'INSERT INTO admins (uuid, full_name, email, mobile, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)',
        ['admin-uuid-001', 'Super Admin', 'admin@aihospital.com', '9999999999', hashedPassword, 'super_admin']
      );
      console.log('✅ Super Admin created (email: admin@aihospital.com, pass: Admin@123)');
    } else {
      console.log('ℹ️  Super Admin already exists');
    }

    console.log('🎉 Seeding completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  }
};

seed();
