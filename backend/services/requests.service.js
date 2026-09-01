const pool = require('./db');
const { emitToRequestRoom, emitToUserRoom } = require('../sockets/emitter');

const SLA_HOURS = { HIGH: 4, MEDIUM: 24, LOW: 72 };

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function computeSlaDueAt(anchor, priority) {
  const hours = SLA_HOURS[priority];
  return new Date(anchor.getTime() + hours * 60 * 60 * 1000);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) throw err;
    const e = new Error('İşlem gerçekleştirilemedi, lütfen tekrar deneyin');
    e.status = 500;
    throw e;
  } finally {
    client.release();
  }
}

async function createRequest({ title, description, request_type_id, priority }, user) {
  if (user.role === 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }

  if (!title || !title.trim() || !description || !description.trim()) {
    fail(400, 'Başlık ve açıklama zorunlu');
  }

  let typeResult;
  try {
    typeResult = await pool.query(
      'SELECT id, department_id, is_active FROM request_types WHERE id = $1',
      [request_type_id]
    );
  } catch (dbErr) {
    fail(500, 'Talep oluşturulamadı, lütfen tekrar deneyin');
  }
  const requestType = typeResult.rows[0];
  if (!requestType) {
    fail(404, 'Talep türü bulunamadı');
  }
  if (!requestType.is_active) {
    fail(400, 'Bu talep türü artık kullanılamıyor');
  }

  const resolvedPriority = priority || 'MEDIUM';
  if (!SLA_HOURS[resolvedPriority]) {
    fail(400, 'Geçersiz öncelik');
  }

  const createdAt = new Date();
  const slaDueAt = computeSlaDueAt(createdAt, resolvedPriority);

  return withTransaction(async (client) => {
    const insertResult = await client.query(
      `INSERT INTO requests
        (title, description, request_type_id, department_id, created_by, priority, status, assigned_to, created_at, sla_due_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', NULL, $7, $8)
       RETURNING *`,
      [title, description, request_type_id, requestType.department_id, user.id, resolvedPriority, createdAt, slaDueAt]
    );
    const request = insertResult.rows[0];

    await client.query(
      `INSERT INTO request_history (request_id, actor_id, action, new_value)
       VALUES ($1, $2, 'CREATED', 'OPEN')`,
      [request.id, user.id]
    );

    return request;
  });
}

async function claimRequest(requestId, user) {
  if (user.role !== 'DEPARTMENT_AUTHORITY') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }

  let existing;
  try {
    existing = await pool.query('SELECT id, department_id FROM requests WHERE id = $1', [requestId]);
  } catch (dbErr) {
    fail(500, 'Talep üstlenilemedi, lütfen tekrar deneyin');
  }
  const request = existing.rows[0];
  if (!request) {
    fail(404, 'Talep bulunamadı');
  }
  if (user.department_id !== request.department_id) {
    fail(403, 'Bu departmana ait değil');
  }

  let notificationRow = null;

  const result = await withTransaction(async (client) => {
    const updateResult = await client.query(
      `UPDATE requests SET status = 'ASSIGNED', assigned_to = $1
       WHERE id = $2 AND status = 'OPEN'
       RETURNING *`,
      [user.id, requestId]
    );

    if (updateResult.rowCount === 0) {
      fail(409, 'Bu talep zaten üstlenilmiş');
    }

    const updated = updateResult.rows[0];

    await client.query(
      `INSERT INTO request_history (request_id, actor_id, action, old_value, new_value)
       VALUES ($1, $2, 'STATUS_CHANGED', 'OPEN', 'ASSIGNED')`,
      [updated.id, user.id]
    );

    const notifResult = await client.query(
      `INSERT INTO notifications (user_id, request_id, type, message)
       VALUES ($1, $2, 'REQUEST_ASSIGNED', $3)
       RETURNING *`,
      [updated.created_by, updated.id, `#${updated.request_number} numaralı talebiniz üstlenildi.`]
    );
    notificationRow = notifResult.rows[0];

    return updated;
  });

  try {
    const enriched = await fetchEnrichedRequest(result.id);
    emitToRequestRoom(result.id, 'request:updated', enriched);
  } catch (emitErr) {
    console.error('request:updated emisyonu basarisiz oldu:', emitErr);
  }
  if (notificationRow) {
    try {
      emitToUserRoom(notificationRow.user_id, 'notification:created', notificationRow);
    } catch (notifErr) {
      console.error('notification:created emisyonu basarisiz oldu:', notifErr);
    }
  }
  return result;
}

const VALID_TRANSITIONS = {
  OPEN: ['REJECTED'],
  ASSIGNED: ['IN_PROGRESS', 'REJECTED'],
  IN_PROGRESS: ['COMPLETED', 'REJECTED'],
};

async function changeRequestStatus(requestId, { status, note }, user) {
  const isKnownTarget = Object.values(VALID_TRANSITIONS).some((targets) => targets.includes(status));
  if (!isKnownTarget) {
    fail(400, 'Geçersiz durum geçişi');
  }

  if (status === 'REJECTED' && (typeof note !== 'string' || !note.trim())) {
    fail(400, 'Red sebebi belirtilmeli');
  }

  let existing;
  try {
    existing = await pool.query(
      'SELECT id, status, assigned_to, department_id, created_by, request_number FROM requests WHERE id = $1',
      [requestId]
    );
  } catch (dbErr) {
    fail(500, 'Durum güncellenemedi, lütfen tekrar deneyin');
  }
  const request = existing.rows[0];
  if (!request) {
    fail(404, 'Talep bulunamadı');
  }

  if (!VALID_TRANSITIONS[request.status] || !VALID_TRANSITIONS[request.status].includes(status)) {
    fail(400, 'Geçersiz durum geçişi');
  }

  if (request.status === 'OPEN' && status === 'REJECTED') {
    if (user.role !== 'DEPARTMENT_AUTHORITY' || user.department_id !== request.department_id) {
      fail(403, 'Bu işlem için yetkiniz yok');
    }
  } else {
    if (user.id !== request.assigned_to) {
      fail(403, 'Bu işlem için yetkiniz yok');
    }
  }

  let notificationRow = null;

  const result = await withTransaction(async (client) => {
    let updateResult;
    if (request.status === 'OPEN' && status === 'REJECTED') {
      updateResult = await client.query(
        `UPDATE requests SET status = $1 WHERE id = $2 AND status = $3 RETURNING *`,
        [status, requestId, request.status]
      );
    } else {
      updateResult = await client.query(
        `UPDATE requests SET status = $1 WHERE id = $2 AND status = $3 AND assigned_to = $4 RETURNING *`,
        [status, requestId, request.status, user.id]
      );
    }

    if (updateResult.rowCount === 0) {
      fail(409, 'Talep durumu değişmiş, tekrar deneyin');
    }

    const updated = updateResult.rows[0];

    await client.query(
      `INSERT INTO request_history (request_id, actor_id, action, old_value, new_value, note)
       VALUES ($1, $2, 'STATUS_CHANGED', $3, $4, $5)`,
      [updated.id, user.id, request.status, status, note || null]
    );

    if (status === 'COMPLETED' || status === 'REJECTED') {
      const type = status === 'COMPLETED' ? 'REQUEST_COMPLETED' : 'REQUEST_REJECTED';
      const message =
        status === 'COMPLETED'
          ? `#${updated.request_number} numaralı talebiniz tamamlandı.`
          : `#${updated.request_number} numaralı talebiniz reddedildi.`;
      const notifResult = await client.query(
        `INSERT INTO notifications (user_id, request_id, type, message)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [updated.created_by, updated.id, type, message]
      );
      notificationRow = notifResult.rows[0];
    }

    return updated;
  });

  try {
    const enriched = await fetchEnrichedRequest(result.id);
    emitToRequestRoom(result.id, 'request:updated', enriched);
  } catch (emitErr) {
    console.error('request:updated emisyonu basarisiz oldu:', emitErr);
  }
  if (notificationRow) {
    try {
      emitToUserRoom(notificationRow.user_id, 'notification:created', notificationRow);
    } catch (notifErr) {
      console.error('notification:created emisyonu basarisiz oldu:', notifErr);
    }
  }
  return result;
}

async function changePriority(requestId, { priority }, user) {
  if (!SLA_HOURS[priority]) {
    fail(400, 'Geçersiz öncelik');
  }

  let existing;
  try {
    existing = await pool.query(
      'SELECT id, status, assigned_to, priority, created_at FROM requests WHERE id = $1',
      [requestId]
    );
  } catch (dbErr) {
    fail(500, 'Öncelik güncellenemedi, lütfen tekrar deneyin');
  }
  const request = existing.rows[0];
  if (!request) {
    fail(404, 'Talep bulunamadı');
  }

  if (user.id !== request.assigned_to) {
    fail(403, 'Bu işlem için yetkiniz yok');
  }
  if (request.status !== 'ASSIGNED' && request.status !== 'IN_PROGRESS') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }

  const newSlaDueAt = computeSlaDueAt(request.created_at, priority);

  const result = await withTransaction(async (client) => {
    const updateResult = await client.query(
      `UPDATE requests SET priority = $1, sla_due_at = $2
       WHERE id = $3 AND status IN ('ASSIGNED', 'IN_PROGRESS') AND assigned_to = $4
       RETURNING *`,
      [priority, newSlaDueAt, requestId, user.id]
    );

    if (updateResult.rowCount === 0) {
      fail(409, 'Talep durumu değişmiş, tekrar deneyin');
    }

    const updated = updateResult.rows[0];

    await client.query(
      `INSERT INTO request_history (request_id, actor_id, action, old_value, new_value)
       VALUES ($1, $2, 'PRIORITY_CHANGED', $3, $4)`,
      [updated.id, user.id, request.priority, priority]
    );

    return updated;
  });

  try {
    const enriched = await fetchEnrichedRequest(result.id);
    emitToRequestRoom(result.id, 'request:updated', enriched);
  } catch (emitErr) {
    console.error('request:updated emisyonu basarisiz oldu:', emitErr);
  }
  return result;
}

const REQUEST_LIST_SELECT = `
  SELECT
    r.*,
    (r.sla_due_at < now() AND r.status NOT IN ('COMPLETED', 'REJECTED')) AS is_overdue,
    rt.name AS request_type_name,
    d.name AS department_name,
    TRIM(CONCAT(creator.name, ' ', COALESCE(creator.surname, ''))) AS created_by_name,
    CASE WHEN r.assigned_to IS NULL THEN NULL
      ELSE TRIM(CONCAT(assignee.name, ' ', COALESCE(assignee.surname, '')))
    END AS assigned_to_name
  FROM requests r
  JOIN request_types rt ON rt.id = r.request_type_id
  JOIN departments d ON d.id = r.department_id
  JOIN users creator ON creator.id = r.created_by
  LEFT JOIN users assignee ON assignee.id = r.assigned_to
`;

const COMMENT_SELECT = `
  SELECT
    c.*,
    TRIM(CONCAT(author.name, ' ', COALESCE(author.surname, ''))) AS author_name
  FROM request_comments c
  JOIN users author ON author.id = c.author_id
`;

const VALID_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'];

async function listRequests(query, user) {
  const status = query && query.status;
  if (status !== undefined && status !== null && status !== '' && !VALID_STATUSES.includes(status)) {
    fail(400, 'Geçersiz status değeri');
  }

  const conditions = [];
  const params = [];

  if (user.role === 'EMPLOYEE') {
    params.push(user.id);
    conditions.push(`r.created_by = $${params.length}`);
  } else if (user.role === 'DEPARTMENT_AUTHORITY') {
    params.push(user.department_id);
    conditions.push(`r.department_id = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`r.status = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  let result;
  try {
    result = await pool.query(
      `${REQUEST_LIST_SELECT} ${whereClause} ORDER BY r.created_at DESC`,
      params
    );
  } catch (dbErr) {
    fail(500, 'Talepler getirilemedi, lütfen tekrar deneyin');
  }

  return result.rows;
}

async function fetchEnrichedRequest(id) {
  let result;
  try {
    result = await pool.query(`${REQUEST_LIST_SELECT} WHERE r.id = $1`, [id]);
  } catch (dbErr) {
    fail(500, 'Talep getirilemedi, lütfen tekrar deneyin');
  }
  const request = result.rows[0];
  if (!request) {
    fail(404, 'Talep bulunamadı');
  }
  return request;
}

async function getRequestById(id, user) {
  const request = await fetchEnrichedRequest(id);

  const isOwner = request.created_by === user.id;
  const isDepartmentAuthority =
    user.role === 'DEPARTMENT_AUTHORITY' && user.department_id === request.department_id;
  const isAdmin = user.role === 'ADMIN';

  if (!isOwner && !isDepartmentAuthority && !isAdmin) {
    fail(403, 'Bu işlem için yetkiniz yok');
  }

  return request;
}

async function addComment(requestId, content, user) {
  if (user.role === 'ADMIN') {
    fail(403, 'Bu işlem için yetkiniz yok');
  }

  const trimmedContent = typeof content === 'string' ? content.trim() : '';
  if (!trimmedContent) {
    fail(400, 'Yorum içeriği boş olamaz');
  }
  if (trimmedContent.length > 2000) {
    fail(400, 'Yorum en fazla 2000 karakter olabilir');
  }

  await getRequestById(requestId, user);

  let notificationRow = null;

  const comment = await withTransaction(async (client) => {
    const insertResult = await client.query(
      `INSERT INTO request_comments (request_id, author_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [requestId, user.id, trimmedContent]
    );
    const insertedComment = insertResult.rows[0];

    const freshRequest = await client.query(
      'SELECT created_by, assigned_to, request_number FROM requests WHERE id = $1',
      [requestId]
    );
    const { created_by, assigned_to, request_number } = freshRequest.rows[0];
    const recipient = user.id === created_by ? assigned_to : created_by;

    if (recipient && recipient !== user.id) {
      const notifResult = await client.query(
        `INSERT INTO notifications (user_id, request_id, type, message)
         VALUES ($1, $2, 'COMMENT_ADDED', $3)
         RETURNING *`,
        [recipient, requestId, `#${request_number} numaralı talebe yeni bir yorum eklendi.`]
      );
      notificationRow = notifResult.rows[0];
    }

    return insertedComment;
  });

  try {
    const enrichedCommentResult = await pool.query(`${COMMENT_SELECT} WHERE c.id = $1`, [comment.id]);
    emitToRequestRoom(requestId, 'request:commented', enrichedCommentResult.rows[0]);
  } catch (emitErr) {
    console.error('request:commented emisyonu basarisiz oldu:', emitErr);
  }
  if (notificationRow) {
    try {
      emitToUserRoom(notificationRow.user_id, 'notification:created', notificationRow);
    } catch (notifErr) {
      console.error('notification:created emisyonu basarisiz oldu:', notifErr);
    }
  }

  return comment;
}

async function listComments(requestId, user) {
  await getRequestById(requestId, user);

  let result;
  try {
    result = await pool.query(
      `${COMMENT_SELECT} WHERE c.request_id = $1 ORDER BY c.created_at ASC`,
      [requestId]
    );
  } catch (dbErr) {
    fail(500, 'Yorumlar getirilemedi, lütfen tekrar deneyin');
  }

  return result.rows;
}

module.exports = {
  createRequest,
  claimRequest,
  changeRequestStatus,
  changePriority,
  listRequests,
  getRequestById,
  addComment,
  listComments,
};
