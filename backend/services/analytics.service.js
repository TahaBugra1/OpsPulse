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

function parseDaysParam(query) {
  if (query.days === undefined) return 30;

  const parsed = Number(query.days);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 90) {
    fail(400, 'days parametresi 1 ile 90 arasında bir tam sayı olmalıdır');
  }

  return parsed;
}

async function getDistribution(query, user) {
  const departmentId = scopeToDepartment(user);
  const days = parseDaysParam(query);

  const statusPriorityWhere = departmentId ? 'WHERE department_id = $1' : '';
  const statusPriorityParams = departmentId ? [departmentId] : [];
  const volumeParams = departmentId ? [days, departmentId] : [days];

  let statusPriorityResult;
  let departmentResult;
  let requestTypeResult;
  let volumeResult;
  try {
    statusPriorityResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'OPEN')::int AS status_open,
         COUNT(*) FILTER (WHERE status = 'ASSIGNED')::int AS status_assigned,
         COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS status_in_progress,
         COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS status_completed,
         COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS status_rejected,
         COUNT(*) FILTER (WHERE priority = 'HIGH')::int AS priority_high,
         COUNT(*) FILTER (WHERE priority = 'MEDIUM')::int AS priority_medium,
         COUNT(*) FILTER (WHERE priority = 'LOW')::int AS priority_low
       FROM requests
       ${statusPriorityWhere}`,
      statusPriorityParams
    );

    departmentResult = await pool.query(
      `SELECT
         d.name AS department_name,
         COUNT(r.id)::int AS count
       FROM departments d
       LEFT JOIN requests r ON r.department_id = d.id
       WHERE d.is_active = true ${departmentId ? 'AND d.id = $1' : ''}
       GROUP BY d.id, d.name
       ORDER BY d.name`,
      departmentId ? [departmentId] : []
    );

    requestTypeResult = await pool.query(
      `SELECT
         rt.name AS request_type_name,
         COUNT(r.id)::int AS count
       FROM request_types rt
       LEFT JOIN requests r ON r.request_type_id = rt.id
       WHERE rt.is_active = true ${departmentId ? 'AND rt.department_id = $1' : ''}
       GROUP BY rt.id, rt.name
       ORDER BY rt.name`,
      departmentId ? [departmentId] : []
    );

    volumeResult = await pool.query(
      `SELECT
         to_char(gs.day, 'YYYY-MM-DD') AS date,
         COUNT(r.id)::int AS count
       FROM generate_series(
              (CURRENT_DATE - ($1::int - 1))::timestamp,
              CURRENT_DATE::timestamp,
              INTERVAL '1 day'
            ) AS gs(day)
       LEFT JOIN requests r ON r.created_at::date = gs.day::date ${departmentId ? 'AND r.department_id = $2' : ''}
       GROUP BY gs.day
       ORDER BY gs.day`,
      volumeParams
    );
  } catch (dbErr) {
    fail(500, 'Dağılım verileri getirilemedi, lütfen tekrar deneyin');
  }

  const counts = statusPriorityResult.rows[0];

  const status = [
    { status: 'OPEN', count: counts.status_open },
    { status: 'ASSIGNED', count: counts.status_assigned },
    { status: 'IN_PROGRESS', count: counts.status_in_progress },
    { status: 'COMPLETED', count: counts.status_completed },
    { status: 'REJECTED', count: counts.status_rejected },
  ];

  const priority = [
    { priority: 'HIGH', count: counts.priority_high },
    { priority: 'MEDIUM', count: counts.priority_medium },
    { priority: 'LOW', count: counts.priority_low },
  ];

  const department = departmentResult.rows.map((r) => ({ department: r.department_name, count: r.count }));

  const requestType = requestTypeResult.rows.map((r) => ({ requestType: r.request_type_name, count: r.count }));

  const volumeOverTime = volumeResult.rows.map((r) => ({ date: r.date, count: r.count }));

  return { status, requestType, department, priority, volumeOverTime };
}

module.exports = {
  getSummary,
  getSla,
  getWorkload,
  getDistribution,
};
