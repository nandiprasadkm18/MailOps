# ReachSched

Production-oriented email scheduling and delivery platform with persistent delayed jobs, configurable rate limiting, multi-sender support, Slack notifications, searchable email history, and a modern web dashboard.

**What is ReachSched?**
ReachSched is designed to solve the problem of robust, rate-limited email delivery in the future without relying on frail in-memory timers. It features:
- **Scheduling emails for future delivery:** Uses BullMQ to queue emails and send them at exactly the requested future timestamp.
- **Persistent background processing:** Database-backed jobs ensure no emails are lost during server restarts.
- **Rate-controlled delivery:** Strictly adheres to configurable hourly limits across multiple concurrent workers.
- **Monitoring/searchability:** Full text search on email history powered by Elasticsearch and built-in queue monitoring via Bull Board.
- **Slack notification integration:** Instant alerts when rate limits are breached or campaigns complete.
- **Web dashboard:** A rich, responsive UI for composing emails, uploading CSVs, and managing the schedule.

### 2. KEY FEATURES

**Backend**
- Express.js REST API using TypeScript.
- PostgreSQL persistence managed via Prisma ORM.
- Redis-backed BullMQ delayed jobs for precise scheduling.
- Dedicated email worker processing.
- Persistent scheduled jobs (jobs survive crashes).
- Restart/recovery reconciliation (orphaned queued emails are safely detected on boot).
- Multiple senders and tenant isolation logic.
- Configurable worker concurrency (`WORKER_CONCURRENCY`).
- Minimum delay between sends (`MIN_DELAY_SECONDS`).
- Configurable hourly email limits per sender and globally.
- Rate-limit rescheduling instead of dropping emails (pushes emails to the next available hour slot).
- Slack notification deduplication and live alerts when hourly limits are reached.
- Elasticsearch indexing & search for scheduled/sent emails.
- Bull Board queue monitoring.
- Ethereal SMTP delivery for safe staging.
- Google OAuth authentication.

**Frontend**
- Google OAuth login and Developer login bypass.
- Authenticated dashboard with user profile menu.
- Compose email with rich text editor.
- Recipient list upload (CSV parsing) and recipient count.
- Scheduling controls including start time, delay, and hourly limit.
- Scheduled and Sent emails lists with real-time updates.
- Email detail view with Star and Archive tagging functionality.
- Loading states, empty states, and toast notifications.
- Slack Integrations page (Connect, Test, Disconnect states).
- Modern responsive glassmorphic UI.

### 3. TECHNOLOGY STACK

| Layer | Technology | Purpose |
|------|------------|---------|
| Frontend | React, TypeScript, Next.js, Tailwind CSS | UI application framework and styling |
| Backend | Node.js, TypeScript, Express.js | Core API and worker runtime |
| Data | PostgreSQL, Prisma | Transactional source of truth and ORM |
| Queue | BullMQ, Redis | Persistent delayed job scheduling and rate limiting |
| Email | Nodemailer, Ethereal | SMTP client and safe mail delivery testing |
| Search | Elasticsearch | Fast text search for email history |
| Authentication | Google OAuth, Passport.js | Secure user login |
| Notifications | Slack OAuth / Webhooks | Real-time rate-limit alerts |
| Monitoring | Bull Board | Developer dashboard for Redis queues |

### 4. SYSTEM ARCHITECTURE

```text
Browser
   |
   v
React (Next.js) Frontend
   |
   v
Express API  <-->  Google OAuth / Slack OAuth
   |
   +--------------------+--------------------+
   |                    |                    |
   v                    v                    v
PostgreSQL            Redis            Elasticsearch
   |                    |                    ^
   |                    v                    |
   |                 BullMQ                  |
   |                    |                    |
   |                    v                    |
   |              Email Worker---------------+
   |                    |
   |                    v
   |               SMTP/Ethereal
```

- **Frontend**: Handles user interaction, OAuth initiation, composing, and API consumption.
- **Express API**: Validates requests, writes initial data to Postgres, and pushes scheduling parameters to BullMQ.
- **PostgreSQL / Prisma**: The transactional source of truth for Users, Senders, Emails, and Integrations.
- **Redis / BullMQ**: Manages delayed job lifecycles and stores rate-limiting counters atomically.
- **Email Worker**: The background process that pops jobs off BullMQ, checks limits, sends the email, and indexes the result.
- **Elasticsearch**: Indexed search projection of email content.
- **Ethereal SMTP**: Mocks actual email transport.
- **Slack / Google**: External identity and notification providers.
- **Bull Board**: Mounts an internal route (`/admin/queues`) over the Redis instance.

### 5. EMAIL SCHEDULING FLOW

## How Scheduling Works

1. User authenticates via Google OAuth (or Dev bypass).
2. User opens the Compose modal in the dashboard.
3. User enters subject, body, and uploads a CSV of recipients.
4. The frontend parses the CSV locally and displays the recipient count.
5. User selects a future start time, minimum delay between sends, and maximum hourly limit.
6. Frontend sends the scheduling payload to the backend `POST /api/emails/schedule`.
7. Backend validates the payload and bulk-inserts Email records into PostgreSQL with a `pending` status.
8. Backend adds jobs to the BullMQ `email-queue`, carefully staggering the `delay` option for each job based on the requested start time and minimum delay.
9. Redis/BullMQ persists the scheduled jobs in memory and disk (if configured).
10. The `Email Worker` polls BullMQ and receives jobs strictly when their delay expires.
11. The worker applies a rate-limit check (Lua script in Redis).
12. If limits are hit, the worker reschedules the job and fires a Slack alert. If clear, the worker proceeds.
13. The worker sends the payload via Nodemailer to Ethereal SMTP.
14. PostgreSQL is updated to `sent` with a `sentAt` timestamp.
15. The record is indexed into Elasticsearch.
16. The frontend fetches the updated records.

### 6. PERSISTENCE AND RESTART RECOVERY

## Persistence and Restart Recovery

- **PostgreSQL** stores the immutable source of truth (users, emails, delivery status).
- **Redis / BullMQ** stores transient job states (waiting, delayed, active, completed).
- Jobs are stored in Redis instead of application memory (like `setTimeout`) so they survive full process crashes.
- If the Express API server restarts, no emails are lost because they are safely queued in Redis.
- If the Worker restarts mid-send, BullMQ's lock mechanism ensures stalled active jobs are eventually moved back to the wait queue for another worker.
- **Reconciliation Pass**: On API boot, a routine scans PostgreSQL for emails marked `pending` or `queued` that do NOT have a corresponding active job in BullMQ. It automatically re-queues these orphans.
- **Idempotency**: The system relies on the PostgreSQL UUID as the primary BullMQ Job ID. This prevents the reconciliation pass from accidentally queueing the same email twice.
- **Tradeoff**: While the system is highly robust, exactly-once delivery cannot be mathematically guaranteed if the worker crashes perfectly *after* the SMTP provider acknowledges the email but *before* the Postgres transaction commits.

### 7. RATE LIMITING

## Rate Limiting

- Rate limits exist to prevent SMTP providers from blocking the account due to sudden massive spikes in volume.
- **Global Limit**: Total emails the platform can send per hour.
- **Per-Sender Limit**: Total emails a specific sender can send per hour.
- Counter logic uses Redis `INCR` and `EXPIRE` commands atomically to enforce hourly tumbling windows.
- The system handles multiple concurrent workers safely via these atomic Redis operations.
- When an email breaches the limit, it is **rescheduled** back into the BullMQ delayed queue for the top of the next hour instead of failing permanently.
- A Slack notification is fired alerting the user of the breach, utilizing a 1-hour locking deduplication key in Redis to prevent Slack webhook spam.

Example:
Hourly limit = 5
Jobs:
1 -> sent
2 -> sent
3 -> sent
4 -> sent
5 -> sent
6 -> rate limited (Rescheduled for next hour)
7 -> rate limited (Rescheduled for next hour)

### 8. CONCURRENCY AND MINIMUM SEND DELAY

## Worker Concurrency

- Configured via the `WORKER_CONCURRENCY` environment variable.
- BullMQ uses this variable to spawn parallel processing tracks.
- Multiple jobs are processed concurrently, dramatically increasing throughput while remaining safe due to the atomic Redis rate-limit checks.

## Minimum Delay Between Sends

- Configured during the user's scheduling request and backed by a global safety limit `MIN_DELAY_SECONDS`.
- Ensures emails are trickled out (e.g. 1 email every 10 seconds) rather than blasted simultaneously, maximizing deliverability.
- Enforced by mathematically offsetting the initial BullMQ `delay` parameter for each subsequent recipient during the schedule phase.

### 9. SLACK INTEGRATION

## Slack Integration

1. User navigates to the Integrations page.
2. User clicks "Connect Slack".
3. ReachSched redirects to the Slack v2 OAuth portal.
4. User authorizes the app for a specific channel.
5. Backend receives the OAuth callback and securely stores the Slack `accessToken` and `webhookUrl` alongside the tenant in Postgres.
6. The UI dynamically displays the connected Workspace and Channel.
7. Future rate-limit breaches automatically trigger Slack webhook notifications.
8. Users can test the connection manually from the UI.
9. Users can disconnect, completely removing the webhook from Postgres. If disconnected, rate-limited emails continue to reschedule correctly, they simply skip the Slack notification step.
*(Note: Webhook URLs and tokens are never exposed to the frontend).*

### 10. ELASTICSEARCH

## Elasticsearch

- Used strictly as a highly-available search and projection layer, complementing PostgreSQL's relational structure.
- Emails are indexed asynchronously right after they are successfully sent or queued.
- Search queries against the `/api/emails/search` endpoint hit Elasticsearch for fast multi-field matching (Subject, Body, Recipient) rather than using slow `LIKE` queries in Postgres.
- The backend automatically initializes and provisions the `emails` index mappings during server boot if it doesn't exist.

### 11. BULL BOARD

## Queue Monitoring

- Bull Board is mounted at `http://localhost:3001/admin/queues`.
- It visualizes the BullMQ `email-queue` in real-time.
- Developers can inspect waiting, active, delayed, and completed jobs, including the full JSON payload of each email.
- Crucial for operational debugging and visually proving that rate-limited emails successfully transition to the `delayed` state.

### 12. PROJECT STRUCTURE

```text
ReachSched/
├── backend/
│   ├── prisma/             # Schema & Migrations
│   ├── src/
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── services/       # Slack, ES, Queue logic
│   │   ├── lib/            # Utilities
│   │   ├── config.ts
│   │   ├── server.ts       # Express API entry
│   │   └── worker.ts       # BullMQ Worker entry
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── src/
│   │   ├── app/            # Next.js App Router
│   │   ├── components/     # React Components
│   │   ├── lib/            # API Clients
│   │   └── types/
│   ├── .env.local
│   ├── package.json
│   └── tsconfig.json
│
├── docker-compose.yml      # Infrastructure (Postgres, Redis, ES)
└── README.md
```

### 13. PREREQUISITES

- Node.js (v18+)
- npm or pnpm
- Docker and Docker Compose
- (Optional) Ethereal Email account
- (Optional) Slack App OAuth credentials
- (Optional) Google OAuth credentials

### 14. ENVIRONMENT VARIABLES

**Backend (`backend/.env`)**

| Variable | Required | Description | Example |
|---|---|---|---|
| DATABASE_URL | Yes | PostgreSQL connection string | `postgresql://<db_user>:<db_password>@localhost:5433/reachsched?schema=public` |
| REDIS_HOST | Yes | Redis host | `localhost` |
| REDIS_PORT | Yes | Redis port | `6379` |
| ETHEREAL_USER | No | Ethereal test email | `your_ethereal_user@ethereal.email` |
| ETHEREAL_PASS | No | Ethereal password | `your_ethereal_password` |
| ETHEREAL_HOST | No | SMTP host | `smtp.ethereal.email` |
| ETHEREAL_PORT | No | SMTP port | `587` |
| MAX_PER_HOUR_GLOBAL | Yes | Global rate limit | `100` |
| MAX_PER_HOUR_PER_SENDER | Yes | Per-sender rate limit | `50` |
| MIN_DELAY_SECONDS | Yes | Minimum send delay | `2` |
| WORKER_CONCURRENCY | Yes | Concurrent jobs | `3` |
| GOOGLE_CLIENT_ID | No | OAuth Client ID | `<your-id>` |
| GOOGLE_CLIENT_SECRET | No | OAuth Secret | `<your-secret>` |
| GOOGLE_CALLBACK_URL | No | OAuth Callback | `http://localhost:3001/api/auth/google/callback` |
| SLACK_CLIENT_ID | No | Slack Client ID | `<your-id>` |
| SLACK_CLIENT_SECRET | No | Slack Secret | `<your-secret>` |
| SLACK_REDIRECT_URI | No | Slack Callback | `http://localhost:3001/api/slack/callback` |
| SESSION_SECRET | Yes | Cookie signing key | `super_secret_session_key` |
| PORT | Yes | Express API Port | `3001` |
| FRONTEND_URL | Yes | CORS Origin | `http://localhost:3000` |
| ELASTICSEARCH_URL | Yes | ES Connection | `http://localhost:9200` |
| ELASTICSEARCH_INDEX | Yes | Target ES Index | `emails` |

**Frontend (`frontend/.env.local`)**

| Variable | Required | Description | Example |
|---|---|---|---|
| NEXT_PUBLIC_API_URL | Yes | Backend API URL | `http://localhost:3001` |

### 15. ETHEREAL EMAIL SETUP

1. Go to https://ethereal.email/create to generate a temporary test account.
2. Copy the SMTP credentials.
3. Place them into `backend/.env` under `ETHEREAL_USER` and `ETHEREAL_PASS`.
4. Run the backend and schedule an email.
5. In the worker console, you will see a unique Preview URL printed. Click it to view the exact rendered payload inside Ethereal's faux-mailbox. Ethereal guarantees no real emails are mistakenly delivered to actual customers during development.

### 16. BACKEND SETUP

1. Navigate to backend: `cd backend`
2. Install dependencies: `npm install`
3. Create environment file: `cp .env.example .env`
4. Start infrastructure (from root): `docker-compose up -d`
5. Generate Prisma Client & Push schema: 
   ```bash
   npx prisma generate
   npx prisma db push
   ```
6. Start the API Server: `npm run dev`
7. Start the Worker (in a separate terminal): `npm run dev:worker`

*(Note: Both the API and Worker must be running for emails to be successfully picked off the queue and sent).*

### 17. DATABASE SETUP

- Uses PostgreSQL (port `5433` via docker-compose).
- Schema is managed via Prisma.
- `npx prisma db push` will create all necessary tables automatically.
- The `npx prisma studio` command can be used to view the Postgres data in a GUI.

### 18. REDIS / BULLMQ SETUP

- Redis operates as the core queue persistence layer and locking mechanism. 
- It is NOT used as an ephemeral cache. 
- The delayed jobs are stored durably in Redis so they survive backend API crashes. 
- The API creates the jobs in Redis; the autonomous Worker consumes them.

### 19. FRONTEND SETUP

1. Navigate to frontend: `cd frontend`
2. Install dependencies: `npm install`
3. Configure `.env.local` to point to `http://localhost:3001`.
4. Start the Next.js server: `npm run dev`
- The frontend will be available at `http://localhost:3000`.

### 20. COMPLETE LOCAL STARTUP

**Terminal 1 (Infrastructure):**
```bash
docker-compose up -d
```

**Terminal 2 (API):**
```bash
cd backend
npm install
npm run dev
```

**Terminal 3 (Worker):**
```bash
cd backend
npm run dev:worker
```

**Terminal 4 (Frontend):**
```bash
cd frontend
npm install
npm run dev
```

**Access URLs:**
- Frontend: `http://localhost:3000`
- Backend Health: `http://localhost:3001/api/health`
- Bull Board: `http://localhost:3001/admin/queues`
- Elasticsearch: `http://localhost:9200`

### 21. FIRST TEST / VERIFICATION

1. Open `http://localhost:3000`.
2. Login (use the Dev bypass if Google OAuth isn't configured).
3. Open the Compose modal.
4. Upload a small CSV or type in comma-separated emails.
5. Verify the frontend parsed the recipient count correctly.
6. Select a time 2 minutes into the future. Click "Schedule".
7. Verify it appears under "Scheduled".
8. Open Bull Board (`http://localhost:3001/admin/queues`) and verify the jobs are in the "Delayed" bucket.
9. Wait 2 minutes. Watch the worker terminal logs output success.
10. Verify the emails moved to the "Sent" tab.
11. Navigate to Integrations, connect Slack, and test the webhook connection.
12. Verify you received the Slack message!

### 22. API OVERVIEW

**Authentication**
- `GET /api/auth/me`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- Google OAuth endpoints

**Emails**
- `POST /api/emails/schedule`
- `GET /api/emails/scheduled`
- `GET /api/emails/sent`
- `GET /api/emails/search`
- `GET /api/emails/stats`
- `DELETE /api/emails/:id`
- `PUT /api/emails/:id/star`
- `PUT /api/emails/:id/archive`

**Slack**
- `GET /api/slack/status`
- `GET /api/slack/connect`
- `GET /api/slack/callback`
- `POST /api/slack/test`
- `DELETE /api/slack/disconnect`

**Queue / Monitoring**
- `/admin/queues` (Bull Board)

### 23. DATA MODEL

- **User**: The authenticated Google/Dev account mapping to a tenant.
- **Sender**: A profile representing the From address.
- **Email**: The core scheduling record. Contains `status`, `scheduledAt`, `sentAt`, `isStarred`, `isArchived`, and `hourlyLimit`. Bound to a specific sender and tenant.
- **SlackIntegration**: Stores the OAuth webhook URL securely tied to a tenant.

### 24. EMAIL LIFECYCLE

```text
Created
   |
   v
Pending (Written to Postgres)
   |
   v
Queued (BullMQ Delayed Job)
   |
   v
Processing (Worker Pick-up)
   |
   +----> Rate limited ----> Queued (Rescheduled)
   |
   v
Sent (SMTP Success)

Failure
   |
   v
Failed
```

### 25. SECURITY CONSIDERATIONS

- **OAuth Authentication**: Google and Slack integrations prevent manually pasting webhook secrets or managing raw passwords.
- **Session Handling**: Utilizes express-sessions bound securely via HTTP-only cookies.
- **Data Isolation**: All Postgres queries and API routes rigidly validate the authenticated `tenantId` preventing cross-user data spillage.
- **Environment Secrets**: Credentials are intentionally missing from source control.
- **Production Notes**: Ethereal MUST be swapped for SES/Sendgrid. `SESSION_SECRET` MUST be rotated. HTTPS MUST be mandated. `connect-redis` MUST replace the in-memory session store for horizontal scaling.

### 26. MULTI-TENANT / USER ISOLATION

The system implements strict logical multi-tenancy. When a user authenticates, they are assigned a `tenantId`. Every `Email`, `Sender`, and `SlackIntegration` record dictates a `tenantId`. API routes extract this ID from the session cookie and forcefully apply it to every single `prisma.email.findMany({ where: { tenantId }})` query, completely isolating customer data at the application layer.

### 27. RELIABILITY AND FAILURE HANDLING

- **Persistent Jobs**: If the server crashes, delayed jobs remain in Redis.
- **API Restart Behavior**: The API boots up and scans PostgreSQL for any orphaned `pending` records and idempotently re-syncs them to BullMQ.
- **Rate-limit Rescheduling**: The worker mathematically protects the user. If they configure 50/hour, the 51st email gracefully slides to the next hour; no emails are dropped or randomly failed.
- **SMTP Failure**: If Ethereal/SMTP drops a connection, the worker catches the error, marks the DB as `failed`, and moves on.

### 28. SCALABILITY

The architecture is inherently designed for high horizontal scalability:
- **Stateless API**: Express handles HTTP processing only.
- **Redis Queue**: BullMQ offloads the heavy delayed-timer workloads.
- **Configurable Workers**: You can spawn multiple `worker.ts` processes globally. Because the rate limiter uses atomic Redis Lua scripts (`INCR`), 5 concurrent workers will never accidentally exceed the sender's limit.
- **Elasticsearch**: Text searching is offloaded from Postgres.

### 29. ENGINEERING TRADEOFFS

- **PostgreSQL + Elasticsearch**: Postgres is utilized for flawless transactional ACID guarantees, while Elasticsearch is populated asynchronously to handle heavy full-text search requirements across thousands of historical emails.
- **Fixed Hourly Windows**: Rate limiting relies on fixed tumbling hourly windows (using simple Redis Expiry). This is highly performant and easy to reason about, but can allow sudden burst spikes right at the top of the hour compared to expensive sliding-window algorithms.
- **Idempotency**: UUIDs are passed into BullMQ as `jobId`. This flawlessly prevents duplicates, but requires trusting Postgres to remain available during the initial queue handoff.

### 30. KNOWN LIMITATIONS

- **Exactly-once external SMTP delivery**: We cannot mathematically guarantee exactly-once delivery across a sudden process crash if it occurs microseconds after the SMTP provider accepts the email but before our local Postgres commit finishes.
- **Session Store**: Currently defaults to in-memory, meaning if the API restarts, developers will be logged out.
- **Ethereal limitations**: Ethereal is strictly for development and shouldn't be used for production throughput.

### 31. DEVELOPMENT / DEBUGGING

- **Bull Board**: The single best place to visually debug exactly where an email is sitting (`/admin/queues`).
- **Worker Logs**: Detailed `[Worker]` tags will output exactly when a rate limit is hit, when an email is sent, or if SMTP fails.
- **Browser Network Tab**: Useful for tracking the JSON structure of the CSV upload payload hitting `POST /api/emails/schedule`.

### 32. TESTING / VERIFICATION

There are no automated test suites currently configured for this repository.
Instead, follow the **First Test / Verification** smoke-test procedure above to manually verify the complete pipeline (Scheduling -> Redis Delay -> Rate Limiting -> SMTP Send -> Postgres Update -> ElasticSearch Index -> UI Refresh).

### 33. PRODUCTION CONSIDERATIONS

Before deploying this architecture to a live domain, developers must:
- Provision a managed PostgreSQL instance (e.g. AWS RDS).
- Provision a highly-available Redis cluster.
- Provision a managed Elasticsearch/Opensearch cluster.
- Replace Ethereal with a transactional provider like AWS SES, Sendgrid, or Resend.
- Enforce HTTPS and configure `cookie: { secure: true }` in `server.ts`.
- Store infrastructure credentials in a Secret Manager.
- Use `connect-redis` to replace `MemoryStore` for sessions.
- Apply production OAuth Client IDs and valid Callback URIs.

### 34. TROUBLESHOOTING

- **Redis connection failed (`ECONNREFUSED`)**: Check if Docker Compose actually started `reachsched-redis` and that port 6379 is free.
- **PostgreSQL connection failed**: Check that you aren't running a local Postgres instance on `5432` or `5433` causing conflicts. Verify `DATABASE_URL` matches your Docker container.
- **Worker is not sending emails**: Ensure `npm run dev:worker` is actually running in a separate terminal. The API does not send emails; it only queues them.
- **Slack notification failure**: Ensure the API server is reachable via ngrok if testing webhooks, or ensure the UI fully completed the Slack OAuth cycle in the Integrations tab.

### 35. SUBMISSION CHECKLIST

**Backend**
- [x] Express + TypeScript
- [x] PostgreSQL persistence
- [x] Redis
- [x] BullMQ delayed jobs
- [x] Persistent scheduling
- [x] Worker
- [x] Configurable concurrency
- [x] Minimum delay
- [x] Hourly rate limiting
- [x] Rate-limit rescheduling
- [x] Slack notification
- [x] Elasticsearch indexing/search
- [x] Bull Board
- [x] Idempotency
- [x] Restart recovery

**Frontend**
- [x] Google OAuth
- [x] Dashboard
- [x] Compose
- [x] CSV/TXT upload
- [x] Recipient parsing
- [x] Scheduling
- [x] Scheduled list
- [x] Sent list
- [x] Email detail
- [x] Loading/error/empty states
- [x] Slack Integrations UI

**Documentation**
- [x] Backend setup
- [x] Frontend setup
- [x] Environment variables
- [x] Ethereal setup
- [x] Architecture
- [x] Persistence explanation
- [x] Rate-limit explanation
- [x] Concurrency explanation
- [x] Troubleshooting
- [x] Production considerations
