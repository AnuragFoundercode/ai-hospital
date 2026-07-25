const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');

/**
 * Database Migration Runner
 * Runs all SQL migration files in order
 */

const MIGRATIONS_DIR = path.join(__dirname, 'sql');

const runMigrations = async () => {
  try {
    // Create migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get already executed migrations
    const [executed] = await pool.query('SELECT filename FROM migrations');
    const executedFiles = executed.map((row) => row.filename);

    // Check if sql directory exists
    if (!fs.existsSync(MIGRATIONS_DIR)) {
      fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
      console.log('📁 Created migrations/sql directory');
      return;
    }

    // Get all migration files
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const pending = files.filter((f) => !executedFiles.includes(f));

    if (pending.length === 0) {
      console.log('✅ All migrations are up to date');
      return;
    }

    // Execute pending migrations
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const statements = sql.split(';').filter((s) => s.trim());

      for (const statement of statements) {
        await pool.query(statement);
      }

      await pool.query('INSERT INTO migrations (filename) VALUES (?)', [file]);
      console.log(`✅ Migration executed: ${file}`);
    }

    console.log(`🎉 ${pending.length} migration(s) completed`);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
};

// Run if called directly
if (require.main === module) {
  runMigrations().then(() => process.exit(0));
}

module.exports = { runMigrations };
