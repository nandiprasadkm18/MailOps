import { Router, Request, Response } from 'express';
import { EmailStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { emailQueue } from '../lib/queue';
import { config } from '../config';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { indexEmail, searchEmails } from '../lib/elasticsearch';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

interface ScheduleEmailBody {
  subject: string;
  body: string;
  recipients: string[];
  scheduledAt: string;      // ISO datetime
  delayBetweenEmails?: number; // seconds between each email
  hourlyLimit?: number;
  senderEmail?: string;
  senderName?: string;
}

/**
 * POST /api/emails/schedule
 * 
 * Accepts subject, body, list of recipient emails (or CSV upload),
 * scheduledAt, delayBetweenEmails, hourlyLimit.
 * Creates one Email row per recipient with status=pending,
 * then enqueues a BullMQ delayed job per row using delay = scheduledAt - now.
 * Job ID = DB row's primary key (idempotent).
 */
router.post('/schedule', upload.single('csv'), async (req: Request, res: Response) => {
  try {
    // Get tenant from session or use default for testing
    const tenantId = (req as any).user?.tenantId || 'default-tenant';

    let body: ScheduleEmailBody;

    // Handle CSV upload
    if (req.file) {
      const csvContent = req.file.buffer.toString('utf-8');
      const records = parse(csvContent, {
        columns: false,
        skip_empty_lines: true,
        trim: true,
      }) as string[][];

      const recipients = records
        .map((row: string[]) => row[0]) // First column = email
        .filter((email: string) => email && email.includes('@'));

      body = {
        subject: req.body.subject,
        body: req.body.body,
        recipients,
        scheduledAt: req.body.scheduledAt,
        delayBetweenEmails: req.body.delayBetweenEmails ? parseInt(req.body.delayBetweenEmails, 10) : undefined,
        hourlyLimit: req.body.hourlyLimit ? parseInt(req.body.hourlyLimit, 10) : undefined,
        senderEmail: req.body.senderEmail,
        senderName: req.body.senderName,
      };
    } else {
      body = req.body;
    }

    const { subject, body: emailBody, recipients, scheduledAt, delayBetweenEmails, hourlyLimit, senderEmail, senderName } = body;

    // Validation
    if (!subject || !emailBody || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields: subject, body, recipients (non-empty array)',
      });
    }

    if (!scheduledAt) {
      return res.status(400).json({ error: 'scheduledAt is required (ISO datetime)' });
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ error: 'Invalid scheduledAt datetime' });
    }

    // Ensure or create the sender
    const sEmail = senderEmail || (req as any).user?.email || 'noreply@reachsched.com';
    const sName = senderName || (req as any).user?.name || 'ReachSched';

    let sender = await prisma.sender.findUnique({
      where: { tenantId_email: { tenantId, email: sEmail } },
    });

    if (!sender) {
      sender = await prisma.sender.create({
        data: {
          tenantId,
          email: sEmail,
          name: sName,
        },
      });
    }

    // Create Email rows and enqueue BullMQ jobs
    const createdEmails = [];
    const baseDelayMs = Math.max(0, scheduledDate.getTime() - Date.now());
    const betweenDelayMs = (delayBetweenEmails || 0) * 1000;

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i].trim();
      if (!recipient || !recipient.includes('@')) continue;

      // Calculate delay for this specific email
      const jobDelay = baseDelayMs + (i * betweenDelayMs);

      // Create DB row — store hourlyLimit so worker can enforce it after restarts
      const email = await prisma.email.create({
        data: {
          tenantId,
          senderId: sender.id,
          toAddress: recipient,
          subject,
          body: emailBody,
          scheduledAt: new Date(Date.now() + jobDelay),
          status: EmailStatus.pending,
          hourlyLimit: hourlyLimit ?? config.rateLimit.maxPerHourPerSender,
        },
      });

      // Index in Elasticsearch (allow failures, DB is source of truth)
      await indexEmail(email, sender.email);

      // Enqueue BullMQ delayed job with jobId = DB row ID (idempotent)
      // Include hourlyLimit in job data so the worker enforces the right limit
      await emailQueue.add(
        'send-email',
        {
          emailId: email.id,
          tenantId: email.tenantId,
          senderId: email.senderId,
          hourlyLimit: email.hourlyLimit ?? config.rateLimit.maxPerHourPerSender,
        },
        {
          jobId: email.id, // Job ID = DB primary key (idempotent)
          delay: jobDelay,
        }
      );

      // Update with bullJobId
      await prisma.email.update({
        where: { id: email.id },
        data: {
          status: EmailStatus.queued,
          bullJobId: email.id,
        },
      });

      createdEmails.push(email);
    }

    return res.status(201).json({
      message: `Scheduled ${createdEmails.length} emails`,
      count: createdEmails.length,
      emails: createdEmails.map((e) => ({
        id: e.id,
        toAddress: e.toAddress,
        scheduledAt: e.scheduledAt,
        status: 'queued',
      })),
    });
  } catch (error) {
    console.error('[API] Schedule error:', error);
    return res.status(500).json({
      error: 'Failed to schedule emails',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/emails/scheduled
 * Returns pending/queued emails for the tenant.
 */
router.get('/scheduled', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default-tenant';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = req.query.search as string;

    const where: any = {
      tenantId,
      status: { in: [EmailStatus.pending, EmailStatus.queued] },
    };

    if (search) {
      where.OR = [
        { subject: { contains: search, mode: 'insensitive' } },
        { toAddress: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [emails, total] = await Promise.all([
      prisma.email.findMany({
        where,
        include: { sender: true },
        orderBy: { scheduledAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.email.count({ where }),
    ]);

    return res.json({
      emails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[API] Get scheduled error:', error);
    return res.status(500).json({ error: 'Failed to fetch scheduled emails' });
  }
});

/**
 * GET /api/emails/sent
 * Returns sent/failed emails for the tenant.
 */
router.get('/sent', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default-tenant';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = req.query.search as string;

    const where: any = {
      tenantId,
      status: { in: [EmailStatus.sent, EmailStatus.failed] },
    };

    if (search) {
      where.OR = [
        { subject: { contains: search, mode: 'insensitive' } },
        { toAddress: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [emails, total] = await Promise.all([
      prisma.email.findMany({
        where,
        include: { sender: true },
        orderBy: { sentAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.email.count({ where }),
    ]);

    return res.json({
      emails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[API] Get sent error:', error);
    return res.status(500).json({ error: 'Failed to fetch sent emails' });
  }
});

/**
 * GET /api/emails/search
 * Search emails using Elasticsearch.
 */
router.get('/search', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default-tenant';
    const query = req.query.q as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    if (!query) {
      return res.status(400).json({ error: 'Search query "q" is required' });
    }

    const { emails, total } = await searchEmails(tenantId, query, page, limit);

    return res.json({
      emails,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('[API] Search error:', error);
    return res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /api/emails/stats
 * Dashboard statistics.
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default-tenant';

    const [pending, queued, sent, failed] = await Promise.all([
      prisma.email.count({ where: { tenantId, status: EmailStatus.pending } }),
      prisma.email.count({ where: { tenantId, status: EmailStatus.queued } }),
      prisma.email.count({ where: { tenantId, status: EmailStatus.sent } }),
      prisma.email.count({ where: { tenantId, status: EmailStatus.failed } }),
    ]);

    return res.json({
      pending,
      queued,
      sent,
      failed,
      total: pending + queued + sent + failed,
    });
  } catch (error) {
    console.error('[API] Stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * DELETE /api/emails/:id
 * Cancel a scheduled email.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default-tenant';
    const { id } = req.params;

    const email = await prisma.email.findFirst({
      where: { id, tenantId },
    });

    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }

    if (email.status === EmailStatus.sent) {
      return res.status(400).json({ error: 'Cannot cancel an already sent email' });
    }

    // Remove from BullMQ queue
    try {
      const job = await emailQueue.getJob(id);
      if (job) await job.remove();
    } catch (e) {
      // Job might not exist in queue, that's fine
    }

    // Delete from DB
    await prisma.email.delete({ where: { id } });

    return res.json({ message: 'Email cancelled and removed' });
  } catch (error) {
    console.error('[API] Delete error:', error);
    return res.status(500).json({ error: 'Failed to cancel email' });
  }
});

/**
 * PUT /api/emails/:id/star
 * Toggle star status
 */
router.put('/:id/star', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default-tenant';
    const { id } = req.params;
    const { isStarred } = req.body;

    const email = await prisma.email.findFirst({ where: { id, tenantId } });
    if (!email) return res.status(404).json({ error: 'Email not found' });

    const updated = await prisma.email.update({
      where: { id },
      data: { isStarred }
    });
    return res.json(updated);
  } catch (error) {
    console.error('[API] Star error:', error);
    return res.status(500).json({ error: 'Failed to star email' });
  }
});

/**
 * PUT /api/emails/:id/archive
 * Toggle archive status
 */
router.put('/:id/archive', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default-tenant';
    const { id } = req.params;
    const { isArchived } = req.body;

    const email = await prisma.email.findFirst({ where: { id, tenantId } });
    if (!email) return res.status(404).json({ error: 'Email not found' });

    const updated = await prisma.email.update({
      where: { id },
      data: { isArchived }
    });
    return res.json(updated);
  } catch (error) {
    console.error('[API] Archive error:', error);
    return res.status(500).json({ error: 'Failed to archive email' });
  }
});

/**
 * GET /api/emails/rate-limit-status
 * Current rate limit status.
 */
router.get('/rate-limit-status', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default-tenant';

    // Get all senders for this tenant
    const senders = await prisma.sender.findMany({ where: { tenantId } });

    const { checkRateLimit } = await import('../services/ratelimit.service');

    const statuses = await Promise.all(
      senders.map(async (sender) => {
        const result = await checkRateLimit(sender.id);
        return {
          senderId: sender.id,
          senderEmail: sender.email,
          ...result,
        };
      })
    );

    return res.json({ senders: statuses });
  } catch (error) {
    console.error('[API] Rate limit status error:', error);
    return res.status(500).json({ error: 'Failed to fetch rate limit status' });
  }
});

export default router;
