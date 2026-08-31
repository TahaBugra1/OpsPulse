require('dotenv').config();

const bcrypt = require('bcrypt');
const pool = require('./services/db');

const SEED_PASSWORD = 'sifre1234';

async function seed() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  const departmentRows = await Promise.all(
    ['IT', 'HR', 'Finance'].map((name) =>
      pool.query(
        `INSERT INTO departments (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, name`,
        [name]
      )
    )
  );
  const departments = Object.fromEntries(
    departmentRows.map((r) => [r.rows[0].name, r.rows[0].id])
  );

  const requestTypes = [
    { name: 'Password Reset', department: 'IT' },
    { name: 'New Laptop Request', department: 'IT' },
    { name: 'Leave Request', department: 'HR' },
    { name: 'Expense Reimbursement', department: 'Finance' },
  ];
  for (const rt of requestTypes) {
    await pool.query(
      `INSERT INTO request_types (name, department_id) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET department_id = EXCLUDED.department_id`,
      [rt.name, departments[rt.department]]
    );
  }

  const authorities = [
    { name: 'IT', surname: 'Yetkilisi', email: 'it.authority@opspulse.com', department: 'IT' },
    { name: 'HR', surname: 'Yetkilisi', email: 'hr.authority@opspulse.com', department: 'HR' },
  ];
  for (const a of authorities) {
    await pool.query(
      `INSERT INTO users (name, surname, email, password_hash, role, department_id)
       VALUES ($1, $2, $3, $4, 'DEPARTMENT_AUTHORITY', $5)
       ON CONFLICT (email) DO UPDATE SET department_id = EXCLUDED.department_id`,
      [a.name, a.surname, a.email, passwordHash, departments[a.department]]
    );
  }

  console.log('Seed tamamlandı.');
  console.log('Departments:', Object.keys(departments).join(', '));
  console.log('Request types:', requestTypes.map((r) => r.name).join(', '));
  console.log('DEPARTMENT_AUTHORITY kullanıcılar (şifre: ' + SEED_PASSWORD + '):');
  authorities.forEach((a) => console.log(`  - ${a.email} (${a.department})`));

  await pool.end();
}

seed().catch((err) => {
  console.error('Seed başarısız:', err);
  process.exit(1);
});
