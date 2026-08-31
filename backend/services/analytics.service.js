const pool = require('./db');

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function scopeToDepartment(user) {
  if (user.role === 'ADMIN') return null;
  if (user.role === 'DEPARTMENT_AUTHORITY') return user.department_id;
  fail(403, 'Bu işlem için yetkiniz yok');
}

async function getSummary(user) {
  const departmentId = scopeToDepartment(user);

  const whereClause = departmentId ? 'WHERE department_id = $1' : '';
  const params = departmentId ? [departmentId] : [];

  let result;
  try {
    result = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'OPEN')::int AS total_open,
         COUNT(*) FILTER (WHERE status = 'ASSIGNED')::int AS total_assigned,
         COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS total_in_progress,
         COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS total_completed,
         COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS total_rejected,
         COUNT(*) FILTER (WHERE sla_due_at < now() AND status NOT IN ('COMPLETED', 'REJECTED'))::int AS total_overdue
       FROM requests
       ${whereClause}`,
      params
    );
  } catch (dbErr) {
    fail(500, 'Özet getirilemedi, lütfen tekrar deneyin');
  }

  return result.rows[0];
}

async function getSla(user) {
  const departmentId = scopeToDepartment(user);

  const whereClause = departmentId ? 'AND r.department_id = $1' : '';
  const params = departmentId ? [departmentId] : [];

  let result;
  try {
    result = await pool.query(
      `SELECT
         COUNT(*)::int AS total_completed,
         COUNT(*) FILTER (WHERE h.created_at <= r.sla_due_at)::int AS on_time_completed,
         AVG(EXTRACT(EPOCH FROM (h.created_at - r.created_at)) / 3600) AS avg_resolution_hours
       FROM requests r
       JOIN LATERAL (
         SELECT created_at
         FROM request_history
         WHERE request_id = r.id AND action = 'STATUS_CHANGED' AND new_value = 'COMPLETED'
         ORDER BY created_at DESC
         LIMIT 1
       ) h ON true
       WHERE r.status = 'COMPLETED'
       ${whereClause}`,
      params
    );
  } catch (dbErr) {
    fail(500, 'SLA verileri getirilemedi, lütfen tekrar deneyin');
  }

  const row = result.rows[0];
  const totalCompleted = Number(row.total_completed);

  if (totalCompleted === 0) {
    return { compliance_rate: 0, avg_resolution_hours: null };
  }

  const complianceRate = Math.round(((Number(row.on_time_completed) / totalCompleted) * 100 + Number.EPSILON) * 100) / 100;
  const avgResolutionHours = Math.round((Number(row.avg_resolution_hours) + Number.EPSILON) * 100) / 100;

  return { compliance_rate: complianceRate, avg_resolution_hours: avgResolutionHours };
}

async function getWorkload(user) {
  const departmentId = scopeToDepartment(user);

  const whereClause = departmentId ? 'WHERE d.id = $1' : '';
  const params = departmentId ? [departmentId] : [];

  let result;
  try {
    result = await pool.query(
      `SELECT
         d.name AS department_name,
         COUNT(r.id) FILTER (WHERE r.status = 'OPEN')::int AS open,
         COUNT(r.id) FILTER (WHERE r.status = 'ASSIGNED')::int AS assigned,
         COUNT(r.id) FILTER (WHERE r.status = 'IN_PROGRESS')::int AS in_progress,
         COUNT(r.id) FILTER (WHERE r.status = 'COMPLETED')::int AS completed,
         COUNT(r.id) FILTER (WHERE r.status = 'REJECTED')::int AS rejected
       FROM departments d
       LEFT JOIN requests r ON r.department_id = d.id
       ${whereClause}
       GROUP BY d.id, d.name
       ORDER BY d.name`,
      params
    );
  } catch (dbErr) {
    fail(500, 'İş yükü verileri getirilemedi, lütfen tekrar deneyin');
  }

  return result.rows;
}

module.exports = {
  getSummary,
  getSla,
  getWorkload,
};
