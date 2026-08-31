const pool = require('./db');

async function checkDatabaseConnection() {
  await pool.query('SELECT 1');
}

module.exports = { checkDatabaseConnection };
