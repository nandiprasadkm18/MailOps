import { Worker, Job, DelayedError } from 'bullmq';
import { EmailStatus } from '@prisma/client';
import { config } from './config';
import prisma from './lib/prisma';
import { redisConnection } from './lib/redis';
import { EMAIL_QUEUE_NAME } from './lib/queue';
import { sendEmail, verifyTransporter } from './services/email.service';
import { checkAndReserveRateLimit } from './services/ratelimit.service';
import { waitForSendSlot } from './services/delay.service';
import { sendRateLimitNotification } from './services/slack.service';
import { runReconciliation } from './services/reconciliation.service';
import { updateEmailStatus } from './lib/elasticsearch';

/**
 * EmailJobData is stored in the BullMQ job payload.
 *
 * hourlyLimit is deliberately included so the worker can enforce
 * the per-schedule limit even after restarts (no dependency on
 * in-memory state or config defaults for the per-job limit).
 */
interface EmailJobData {
  emailId: string;
  tenantId: string;
  senderId: string;
  hourlyLimit?: number; // User-defined limit from Compose UI
}

/**
 * Worker process for sending emails.
 *
 * Flow per job:
 *   1. Idempotency check (DB status)
 *   2. Atomic Redis rate-limit check-and-reserve (Lua script)
 *      → uses per-job hourlyLimit, falls back to env default
 *   3. If rate-limited: reschedule as BullMQ delayed job → DelayedError
 *   4. Redis-backed minimum-delay reservation (Lua slot reservation)
 *   5. SMTP send
 *   6. DB update to SENT
 *   7. Elasticsearch update
 *
 * Concurrency: configurable via WORKER_CONCURRENCY (default: 3).
 * No in-memory state used for correctness.
 */

async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { emailId, tenantId, senderId, hourlyLimit } = job.data;
  console.log(`[Worker] Processing email ${emailId} (job ${job.id})`);

  // ── Step 1: Idempotency check ─────────────────────────────────────────────
  const email = await prisma.$transaction(async (tx) => {
    const row = await tx.email.findUnique({
      where: { id: emailId },
      include: { sender: true },
    });

    if (!row) {
      throw new Error(`Email row ${emailId} not found in database`);
    }

    if (row.status === EmailStatus.sent) {
      console.log(`[Worker] Email ${emailId} already SENT — skipping duplicate delivery`);
      return null;
    }

    if (row.status === EmailStatus.failed) {
      console.log(`[Worker] Email ${emailId} previously failed — retrying`);
    }

    // Mark as queued (in-progress)
    await tx.email.update({
      where: { id: emailId },
      data: { status: EmailStatus.queued },
    });

    return row;
  });

  if (!email) return; // Already sent — exit gracefully

  // ── Step 2: Atomic rate-limit check-and-reserve ────────────────────────────
  // Prefer job-level hourlyLimit (user-defined from Compose UI),
  // fall back to env config default.
  const effectiveHourlyLimit = hourlyLimit ?? (email as any).hourlyLimit ?? config.rateLimit.maxPerHourPerSender;
  const rateLimitResult = await checkAndReserveRateLimit(senderId, effectiveHourlyLimit);

  if (!rateLimitResult.allowed) {
    console.log(
      `[RateLimit] Hourly limit reached for sender ${email.sender.email}: ` +
      `${rateLimitResult.senderCount}/${rateLimitResult.senderLimit} sender, ` +
      `${rateLimitResult.globalCount}/${rateLimitResult.globalLimit} global`
    );

    // Fire Slack notification with deduplication (fire-and-forget)
    sendRateLimitNotification(
      tenantId,
      senderId,
      email.sender.email,
      rateLimitResult.senderCount,
      rateLimitResult.senderLimit,
      rateLimitResult.globalCount,
      rateLimitResult.globalLimit,
      email.subject
    ).catch((err) => console.error('[Worker] Slack notification error:', err));

    // Reschedule to next hourly window — do NOT fail or drop
    const delayMs = rateLimitResult.retryAfterMs + 2000; // +2s buffer
    console.log(`[RateLimit] Rescheduling email ${emailId} by ${delayMs}ms (next hour window)`);
    console.log(`[RateLimit] Next available time: ${new Date(Date.now() + delayMs).toISOString()}`);

    // Revert status back to queued in DB so reconciliation handles restarts
    await prisma.email.update({
      where: { id: emailId },
      data: { status: EmailStatus.queued },
    });

    await job.moveToDelayed(Date.now() + delayMs);
    throw new DelayedError();
  }

  // ── Step 3: Redis-backed minimum-delay slot reservation ────────────────────
  // This is atomic across all workers/instances — no in-memory sleep race.
  await waitForSendSlot(senderId);

  // ── Step 4: SMTP send ─────────────────────────────────────────────────────
  try {
    console.log(`[Worker] Sending email ${emailId} to ${email.toAddress}`);
    await sendEmail({
      from: email.sender.email,
      to: email.toAddress,
      subject: email.subject,
      body: email.body,
    });

    // ── Step 5: Mark SENT in DB (only after SMTP acceptance) ─────────────────
    // NOTE: If the worker crashes between SMTP accept and this DB update,
    // the email will be retried once. This is an acknowledged distributed-system
    // limitation — exact-once SMTP cannot be guaranteed without provider-side
    // idempotency keys. The DB idempotency guard prevents duplicate jobs, but
    // not duplicate SMTP sends in the crash window.
    const sentDate = new Date();
    await prisma.email.update({
      where: { id: emailId },
      data: {
        status: EmailStatus.sent,
        sentAt: sentDate,
        bullJobId: job.id?.toString() || null,
      },
    });

    console.log(`[Worker] Email ${emailId} marked as SENT`);

    // ── Step 6: Elasticsearch update ─────────────────────────────────────────
    await updateEmailStatus(emailId, EmailStatus.sent, sentDate);
  } catch (sendError) {
    // SMTP failed — revert to queued so BullMQ retry picks it up
    await prisma.email.update({
      where: { id: emailId },
      data: { status: EmailStatus.queued },
    }).catch(() => {}); // best-effort

    console.error(`[Worker] SMTP delivery failed for email ${emailId}:`, sendError instanceof Error ? sendError.message : sendError);
    throw sendError; // Let BullMQ retry via its retry policy
  }
}

// ── Create the worker ────────────────────────────────────────────────────────
const worker = new Worker<EmailJobData>(
  EMAIL_QUEUE_NAME,
  async (job) => {
    await processEmailJob(job);
  },
  {
    connection: redisConnection,
    concurrency: config.worker.concurrency,
  }
);

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully`);
});

worker.on('failed', async (job, error) => {
  if (error instanceof DelayedError) return; // Expected — rate limited, intentionally delayed

  console.error(`[Worker] Job ${job?.id} failed: ${error.message}`);

  // Mark as permanently FAILED after all retries exhausted
  if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
    try {
      // Use updateMany so we safely skip if the row was deleted (P2025 guard)
      await prisma.email.updateMany({
        where: { id: job.data.emailId },
        data: {
          status: EmailStatus.failed,
          errorMessage: error.message,
        },
      });
      await updateEmailStatus(job.data.emailId, EmailStatus.failed);
      console.log(`[Worker] Email ${job.data.emailId} marked as FAILED after ${job.attemptsMade} attempts`);
    } catch (e) {
      console.error('[Worker] Failed to update DB on terminal error:', e);
    }
  }
});

worker.on('error', (error) => {
  console.error('[Worker] Worker error:', error);
});

// ── Bootstrap ────────────────────────────────────────────────────────────────
async function start() {
  console.log('[Worker] Starting email worker...');

  await verifyTransporter();

  try {
    await runReconciliation();
  } catch (error) {
    console.error('[Worker] Reconciliation failed:', error);
  }

  console.log(`[Worker] Worker is now processing jobs... (concurrency: ${config.worker.concurrency})`);
}

start();

// ── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('[Worker] Received SIGTERM, shutting down...');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Worker] Received SIGINT, shutting down...');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});
