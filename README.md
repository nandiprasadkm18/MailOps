# ReachSched

ReachSched is a robust email scheduling and delivery platform designed for resilient background processing, strict rate limiting, multi-tenant isolation, and high-performance searchability.

## Tech Stack

### Backend
- Express
- TypeScript
- PostgreSQL
- Prisma
- Redis
- BullMQ
- Elasticsearch
- Node.js

### Frontend
- Next.js
- React
- TypeScript
- Tailwind CSS

### Infrastructure / Services
- Docker & Docker Compose
- Ethereal SMTP

## Features Implemented

### Backend
- Express + TypeScript API
- PostgreSQL persistence
- Prisma
- Redis
- BullMQ delayed-job scheduling
- Persistent scheduling
- BullMQ worker
- Configurable worker concurrency
- Minimum delay between emails
- Global hourly rate limiting
- Per-sender hourly rate limiting
- Atomic Redis-backed rate limiting
- Automatic rescheduling when an hourly limit is reached
- Slack notification when a sender reaches its hourly limit
- Slack notification deduplication
- Multiple senders / tenant isolation
- Retry handling
- FAILED status after retry exhaustion
- Idempotency
- Restart reconciliation
- Elasticsearch indexing/search
- Bull Board
- Ethereal SMTP
- Google OAuth
- Email/password authentication

### Frontend
- Google login
- Email/password registration and login
- Dashboard
- User profile
- Logout
- Compose New Email
- Subject and body
- CSV/TXT recipient upload
- Number of detected email addresses
- Scheduled start time
- Delay between emails
- Hourly limit
- Scheduled emails list
- Sent emails list
- Search
- Status filtering
- Email status display
- Loading states
- Empty states
- Error handling
- Toast notifications
- Slack integration UI

## Architecture Overview

### Scheduling

Frontend
→ Express API
→ PostgreSQL
→ BullMQ delayed job
→ Redis
→ BullMQ worker
→ rate-limit/delay checks
→ Ethereal SMTP
→ PostgreSQL / Elasticsearch status updates

- Scheduling uses BullMQ delayed jobs.
- Redis stores BullMQ job state.
- No cron jobs are used.

### Persistence and Restart Recovery
- PostgreSQL stores persistent email/application state.
- Redis stores BullMQ job state.
- Scheduled jobs survive worker/API restarts through the persistent queue.
- The worker performs reconciliation on startup.
- Existing active jobs are not duplicated.
- Pending/queued emails can be requeued when recovery is required.

### Rate Limiting
- Global hourly limit
- Per-sender hourly limit
- Redis-backed counters
- Atomic rate-limit reservation/check
- Minimum delay between sends
- Rescheduling when the hourly limit is reached
- Slack notification when the sender limit is reached
- Slack notification deduplication

### Concurrency
The BullMQ worker processes multiple jobs concurrently based on the `WORKER_CONCURRENCY` environment variable (defaults to `3`).

## Assumptions, Shortcuts, and Trade-offs
- Ethereal SMTP: Ethereal is used as the email transport required by the assignment. It provides a safe test mailbox and preview URLs instead of delivering messages to real recipient inboxes.
- BullMQ delayed jobs: Scheduled emails are implemented using BullMQ delayed jobs rather than cron-based scheduling. This keeps scheduling persistent through Redis and allows the worker to process jobs independently of the API process.
- Rate limiting: Email limits use Redis-backed atomic counters with a fixed hourly (tumbling-window) design. When a sender or global limit is reached, the email is rescheduled for the next available hourly window rather than being dropped.
- Distributed delivery: The system uses database state, BullMQ job IDs, idempotency checks, and reconciliation to prevent duplicate processing during retries and restarts. As with SMTP-based distributed systems, absolute exactly-once delivery cannot be guaranteed once an external SMTP server has accepted a message.
- Concurrency: Worker concurrency is configurable through environment variables. Multiple workers can operate safely because rate-limit reservations are performed atomically in Redis.
- Authentication: Email/password authentication is implemented with hashed passwords, while Google OAuth is supported separately. Email ownership verification is outside the scope of the assignment.
- Local infrastructure: PostgreSQL, Redis, and Elasticsearch are provided through Docker Compose to make the required services reproducible during development and evaluation.

## Backend Setup

### Prerequisites
- Node.js
- npm
- Docker & Docker Compose

### Install Dependencies
```bash
npm install
```

### Environment Configuration
The developer should create:
`backend/.env`
from:
`backend/.env.example`

### Start Infrastructure
Start the required PostgreSQL, Redis, and Elasticsearch services:
```bash
docker compose up -d postgres redis elasticsearch
```
- PostgreSQL uses port 5433
- Redis uses port 6379
- Elasticsearch uses port 9200

### Start Backend API
```bash
npm run dev
```
The backend API runs on port 3001.

### Start BullMQ Worker
```bash
npm run dev:worker
```
The worker processes scheduled email jobs in the background.

## Frontend Setup
```bash
npm install
npm run dev
```
The development server will run at `http://localhost:3000`.

## Ethereal Email Setup
ReachSched uses Ethereal SMTP to simulate actual email transport safely.
- Create an Ethereal account setup at https://ethereal.email/create
- Provide the SMTP credentials to the exact environment variables: `ETHEREAL_USER`, `ETHEREAL_PASS`, `ETHEREAL_HOST`, `ETHEREAL_PORT` inside `backend/.env`.
- Nodemailer uses these credentials to safely send mock emails.
- When an email is sent, Nodemailer logs an Ethereal preview URL in the worker console to view the rendered payload.

## Environment Variables

| Variable | Purpose | Example |
|---|---|---|
| DATABASE_URL | PostgreSQL connection string | `postgresql://<db_user>:<db_password>@localhost:5433/reachsched?schema=public` |
| REDIS_HOST | Redis host | `localhost` |
| REDIS_PORT | Redis port | `6379` |
| ETHEREAL_USER | Ethereal SMTP username | `your_ethereal_user@ethereal.email` |
| ETHEREAL_PASS | Ethereal SMTP password | `your_ethereal_password` |
| ETHEREAL_HOST | Ethereal SMTP host | `smtp.ethereal.email` |
| ETHEREAL_PORT | Ethereal SMTP port | `587` |
| MAX_PER_HOUR_GLOBAL | Global hourly rate limit | `100` |
| MAX_PER_HOUR_PER_SENDER | Per-sender hourly rate limit | `50` |
| MIN_DELAY_SECONDS | Minimum delay between sends | `2` |
| WORKER_CONCURRENCY | BullMQ worker concurrency | `3` |
| GOOGLE_CLIENT_ID | Google OAuth Client ID | `your_google_client_id` |
| GOOGLE_CLIENT_SECRET | Google OAuth Client Secret | `your_google_client_secret` |
| GOOGLE_CALLBACK_URL | Google OAuth Callback URI | `http://localhost:3001/api/auth/google/callback` |
| SLACK_CLIENT_ID | Slack OAuth Client ID | `your_slack_client_id` |
| SLACK_CLIENT_SECRET | Slack OAuth Client Secret | `your_slack_client_secret` |
| SLACK_REDIRECT_URI | Slack OAuth Redirect URI | `http://localhost:3001/api/slack/callback` |
| SESSION_SECRET | Express session cookie secret | `change-this-to-a-random-string-in-production` |
| PORT | Backend API Port | `3001` |
| FRONTEND_URL | Allowed CORS frontend origin | `http://localhost:3000` |
| ELASTICSEARCH_URL | Elasticsearch host | `http://localhost:9200` |
| ELASTICSEARCH_INDEX | Elasticsearch index name | `emails` |

## Running the Application

1. Start infrastructure:
   ```bash
   docker compose up -d postgres redis elasticsearch
   ```
2. Start backend API:
   ```bash
   cd backend
   npm run dev
   ```
3. Start BullMQ worker:
   ```bash
   cd backend
   npm run dev:worker
   ```
4. Start frontend:
   ```bash
   cd frontend
   npm run dev
   ```
5. Open the frontend URL:
   `http://localhost:3000`
