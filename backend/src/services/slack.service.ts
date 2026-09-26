import prisma from '../lib/prisma';
import { redisClient } from '../lib/redis';

/**
 * Slack notification service.
 *
 * - Looks up SlackIntegration FRESH on each call (no caching)
 *   so connecting/reconnecting Slack works without restart.
 * - Uses Redis SET NX for deduplication to avoid spamming the
 *   same rate-limit notification for the same sender/hour window.
 *   Key: slack:rate-limit-notified:{senderId}:{epochHour}
 * - If Slack is disconnected: silently skips, never crashes.
 */

function getEpochHour(): number {
  return Math.floor(Date.now() / (1000 * 60 * 60));
}

function getSlackSentKey(senderId: string): string {
  return `slack:sent:${senderId}:${getEpochHour()}`;
}

function getSlackLockKey(senderId: string): string {
  return `slack:lock:${senderId}:${getEpochHour()}`;
}

/**
 * Send a Slack notification.
 * Returns true if the notification was sent, false if skipped or failed.
 */
export async function sendSlackNotification(
  tenantId: string,
  message: string
): Promise<boolean> {
  try {
    // Always query fresh — no caching, per spec
    const integration = await prisma.slackIntegration.findUnique({
      where: { tenantId },
    });

    if (!integration) {
      // Slack not connected — silently skip
      return false;
    }

    const response = await fetch(integration.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: message,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: message,
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error(
        `[Slack] Webhook failed with status ${response.status}: ${await response.text()}`
      );
      return false;
    }

    console.log(`[Slack] Rate-limit notification sent to tenant ${tenantId}`);
    return true;
  } catch (error) {
    // Silently skip — never crash, never block email flow
    console.error('[Slack] Error sending notification:', error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Send a rate-limit Slack notification with deduplication.
 *
 * Only ONE notification is sent per sender per hourly window.
 * Uses Redis SET NX (atomic) to ensure this across multiple workers.
 *
 * @param tenantId - Tenant for Slack integration lookup
 * @param senderId - Sender for deduplication key
 * @param senderEmail - Email address of sender (for the message)
 * @param senderCount - Current count this hour
 * @param senderLimit - Configured limit
 * @param globalCount - Global count this hour
 * @param globalLimit - Global limit
 * @param emailSubject - Subject of the email that triggered the limit
 */
export async function sendRateLimitNotification(
  tenantId: string,
  senderId: string,
  senderEmail: string,
  senderCount: number,
  senderLimit: number,
  globalCount: number,
  globalLimit: number,
  emailSubject: string
): Promise<void> {
  const sentKey = getSlackSentKey(senderId);
  const lockKey = getSlackLockKey(senderId);

  // Check the sent key before attempting delivery
  const alreadySent = await redisClient.get(sentKey);
  if (alreadySent) {
    console.log(`[Slack] Deduplication: notification already successfully sent for sender ${senderId} this hour, skipping`);
    return;
  }

  // Acquire the short-lived lock atomically with SET NX EX
  const lockAcquired = await redisClient.set(lockKey, '1', 'EX', 30, 'NX');
  if (!lockAcquired) {
    console.log(`[Slack] Deduplication: another worker currently handling the notification for sender ${senderId}, skipping`);
    return;
  }

  try {
    console.log(`[Slack] Deduplication: notification lock acquired for sender ${senderId}`);

    // Re-check the sent key after acquiring the lock
    const doubleCheck = await redisClient.get(sentKey);
    if (doubleCheck) {
      console.log(`[Slack] Deduplication: notification already successfully sent for sender ${senderId} this hour, skipping`);
      return;
    }

    const message = formatRateLimitMessage(
      senderEmail,
      senderCount,
      senderLimit,
      globalCount,
      globalLimit,
      emailSubject
    );

    // Call sendSlackNotification()
    const success = await sendSlackNotification(tenantId, message);

    // Only after sendSlackNotification() returns true, create the 1-hour sent key
    if (success) {
      await redisClient.set(sentKey, '1', 'EX', 3600);
      console.log(`[Slack] Delivery successful for sender ${senderId}`);
    } else {
      // If Slack returns false or throws, do NOT create the sent key
      console.log(`[Slack] Delivery failed and retry allowed for sender ${senderId}`);
    }
  } finally {
    // Release the short-lived lock so another attempt can retry
    await redisClient.del(lockKey);
  }
}

export function formatRateLimitMessage(
  senderEmail: string,
  senderCount: number,
  senderLimit: number,
  globalCount: number,
  globalLimit: number,
  emailSubject: string
): string {
  const now = new Date();
  const windowStr = `${now.toISOString().substring(0, 13)}:00 UTC`;

  return (
    `:warning: *ReachSched Rate Limit Hit*\n\n` +
    `• *Sender:* ${senderEmail}\n` +
    `• *Sender usage:* ${senderCount}/${senderLimit} emails this hour\n` +
    `• *Global usage:* ${globalCount}/${globalLimit} emails this hour\n` +
    `• *Email subject:* "${emailSubject}"\n` +
    `• *Window:* ${windowStr}\n` +
    `• *Action:* Job rescheduled to next hour window\n` +
    `• *Time:* ${now.toISOString()}`
  );
}
