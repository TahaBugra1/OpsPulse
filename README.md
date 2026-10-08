# OpsPulse

A role-based operations platform for managing internal IT, HR, and Finance requests in one place. Employees create requests, department authorities claim and resolve the requests routed to their department, and administrators oversee the whole system. Every step a request goes through is recorded, SLA deadlines are tracked, and updates reach the right people in real time.

## Features

**Roles**

| Role | Capabilities |
|---|---|
| Employee | Creates requests, tracks their own requests, comments, sees a personal summary |
| Department Authority | Sees only their department's requests; claims requests from the queue, processes, completes, or rejects them; views their team |
| Administrator | Sees the whole system; manages users and the catalog (departments, request types); moderates comments |

**Requests**
- A locked state machine: `Open → Assigned → In Progress → Completed / Rejected`. Completed or rejected requests cannot be reopened.
- Claiming and status changes are atomic; if two people act on the same request at once, only one succeeds.
- Priority-based SLA deadlines (High 4 hours, Medium 24 hours, Low 72 hours) with overdue tracking.
- Creation, assignment, status, and priority changes are written to the `request_history` table; the request detail page shows the full history.
- Comments (edit, delete), notifications, search and filters, saved queue filters.

**Analytics**
- Status summary, SLA compliance rate, average resolution time.
- Distribution charts, request volume over time, bottleneck detection (SLA breaches, stage durations, authority workload).

**Real time**
- Live request updates, notification badge, and queue via Socket.io.
- Events are sent to user-, department-, and request-scoped rooms; nothing is broadcast to everyone.

**AI suggestion (optional)**
- On the new request form, Google Gemini suggests a request type and priority.
- A suggestion is never applied automatically and is never shown before being validated against the real request types. If no API key is set or the service doesn't respond, the form works as usual.

## Security

- **Two-layer authorization:** on top of role checks, every query is scoped to the signed-in user (their own requests / their own department). Scope comes from the verified token, never from the client.
- Registration has no role selection; everyone starts as an Employee. Department Authority accounts can only be created by an administrator.
- Accounts created by an administrator get a one-time temporary password; the backend rejects every other request until the user sets their own.
- `is_active` and the forced password change flag are re-checked against the database on every request.
- JWT authentication, bcrypt password hashing, Google OAuth, Helmet, restricted CORS.
- Separate rate limits for login, registration, password changes, and AI.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Router, Recharts |
| Backend | Node.js, Express, Socket.io, JWT, bcrypt, Google OAuth |
| Database | PostgreSQL |
| AI | Google Gemini API |
| Testing | Vitest (frontend), `node --test` + Supertest (backend) |

## Architecture

```
Route → Controller → Service → PostgreSQL
```

Controllers stay thin; business rules and queries live in the service layer. Every write to the `requests` table goes through a single set of service functions (`createRequest`, `claimRequest`, `changeRequestStatus`, `changePriority`). These functions update the request, record the history entry, and create the notification in the same transaction.

The database consists of 7 tables: `departments`, `users`, `request_types`, `requests`, `request_comments`, `request_history`, `notifications`.

![Database schema](db/db.png)

## Getting Started

### Prerequisites
- Node.js 22+
- PostgreSQL

### 1. Database

```bash
createdb opspulse
psql -d opspulse -f db/schema.sql
```

`schema.sql` contains the complete, current schema. The files under `db/migrations/` are only for upgrading an older database; do not run them on a fresh install.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env    # edit the values
npm run seed            # departments, request types, and department authorities
npm run dev             # http://localhost:4000
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Token signing secret (should be long and random) |
| `CLIENT_ORIGIN` | Frontend URL for CORS, e.g. `http://localhost:5173` |
| `ALLOWED_EMAIL_DOMAIN` | Email domain allowed to register, e.g. `company.com` |
| `GOOGLE_CLIENT_ID` | OAuth client ID for Google sign-in |
| `GEMINI_API_KEY` | Optional. If left empty, the AI suggestion is disabled |
| `GEMINI_MODEL` | Gemini model to use (default `gemini-2.5-flash`) |

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev             # http://localhost:5173
```

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend URL (default `http://localhost:4000`) |
| `VITE_GOOGLE_CLIENT_ID` | Same value as the backend's `GOOGLE_CLIENT_ID` |

### Accounts

- **Department authorities** are created by `npm run seed`. Password: `sifre1234`
  - `it.authority@opspulse.com`, `it.authority2@opspulse.com`
  - `hr.authority@opspulse.com`
  - `finance.authority@opspulse.com`
- **Employee** accounts are created from the registration page (the email must end with `ALLOWED_EMAIL_DOMAIN`).
- **Administrators** cannot be created through the app. Register first, then promote the account in the database:

```sql
UPDATE users SET role = 'ADMIN', department_id = NULL WHERE email = 'you@company.com';
```

## Tests

```bash
cd backend && npm test     # runs against a real PostgreSQL database; seed it first
cd frontend && npm test
```

## Project Structure

```
backend/
  routes/          endpoint definitions
  controllers/     HTTP layer
  services/        business rules and queries
  middleware/      authentication, rate limiting, error handling
  sockets/         Socket.io authentication and rooms
  test/
frontend/src/
  pages/           pages
  components/      shared components and route guards
  context/         session, socket, and page title
  lib/             API client and data hooks
db/                schema, schema diagram, and migrations
```

## License

[MIT](LICENSE)
