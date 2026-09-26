import prisma from '../lib/prisma';
import { emailQueue } from '../lib/queue';
import { EmailStatus } from '@prisma/client';

/**
 * Reconciliation pass: runs on worker/server boot.
 * 
 * Queries for Email rows with status IN (pending, queued) that have no 
 * corresponding active/delayed job in BullMQ, and re-enqueues ONLY those.
 * Never touches rows already status=sent.
 * 
 * Job ID equals the DB row's primary key — this makes re-enqueuing idempotent
 * (BullMQ will not create a duplicate job with the same ID).
 */
export async function runReconciliation(): Promise<{ requeued: number; skipped: number }> {
  // (The starting log is handled inside start() or just kept minimal)

  // Get all emails that should be in the queue
  const pendingEmails = await prisma.email.findMany({
    where: {
      status: {
        in: [EmailStatus.pending, EmailStatus.queued],
      },
    },
  });

  if (pendingEmails.length === 0) {
    console.log('[Reconciliation] No pending/queued emails found. Nothing to reconcile.');
    return { requeued: 0, skipped: 0 };
  }

  console.log(`[Reconciliation] Found ${pendingEmails.length} pending/queued emails to check`);

  let requeued = 0;
  let skipped = 0;

  for (const email of pendingEmails) {
    try {
      // Check if the job already exists in BullMQ
      const existingJob = await emailQueue.getJob(email.id);

      if (existingJob) {
        const state = await existingJob.getState();
        // Job exists and is in a valid state — don't re-enqueue
        if (['delayed', 'waiting', 'active', 'prioritized'].includes(state)) {
          skipped++;
          continue;
        }
        // Job exists but is completed/failed — might need re-enqueue if DB says pending
        // Remove stale job first
        await existingJob.remove();
      }

      // Calculate delay: max(0, scheduledAt - now)
      const now = Date.now();
      const scheduledMs = new Date(email.scheduledAt).getTime();
      const delay = Math.max(0, scheduledMs - now);

      // Enqueue with job ID = DB row ID (idempotent)
      // Carry hourlyLimit so worker enforces correct limit after restart
      await emailQueue.add(
        'send-email',
        {
          emailId: email.id,
          tenantId: email.tenantId,
          senderId: email.senderId,
          hourlyLimit: (email as any).hourlyLimit ?? undefined,
        },
        {
          jobId: email.id, // Job ID = DB primary key
          delay,
        }
      );

      // Update status to queued
      await prisma.email.update({
        where: { id: email.id },
        data: {
          status: EmailStatus.queued,
          bullJobId: email.id,
        },
      });

      requeued++;
      console.log(`[Reconciliation] Re-enqueued email ${email.id} (delay: ${delay}ms)`);
    } catch (error) {
      console.error(`[Reconciliation] Failed to reconcile email ${email.id}:`, error);
    }
  }

  console.log(`[Reconciliation] Starting...`);
  console.log(`[Reconciliation] Requeued ${requeued} emails`);
  console.log(`[Reconciliation] Skipped ${skipped} emails (already in queue)`);
  return { requeued, skipped };
}
