import { redisClient } from '../lib/redis';
import { config } from '../config';

/**
 * Redis-backed minimum-delay coordinator.
 *
 * Problem: With WORKER_CONCURRENCY=3, three workers can simultaneously
 * pass the rate limit check and all call sleep(2000) in parallel.
 * That does NOT enforce a 2-second minimum spacing.
 *
 * Solution: Use an atomic Redis operation to reserve the next available
 * send slot time.
 *
 * Key: sendslot:{senderId}
 * Value: Unix timestamp (ms) of when the LAST slot was reserved.
 *
 * Lua script atomically:
 *   1. Read lastSendTime from Redis (default to 0 if not set)
 *   2. slotTime = max(now, lastSendTime + minDelayMs)
 *   3. SET the key to slotTime with TTL
 *   4. Return slotTime
 *
 * The caller then sleeps until slotTime if it's in the future.
 * This guarantees sends are spaced >= minDelaySeconds apart across ALL workers.
 */

const RESERVE_SEND_SLOT_SCRIPT = `
local key = KEYS[1]
local nowMs = tonumber(ARGV[1])
local minDelayMs = tonumber(ARGV[2])
local ttlSeconds = tonumber(ARGV[3])

local lastSendMs = tonumber(redis.call('GET', key) or '0')
local slotMs = math.max(nowMs, lastSendMs + minDelayMs)

redis.call('SET', key, slotMs, 'EX', ttlSeconds)

return slotMs
`;

/**
 * Reserve a send slot for a sender.
 * Returns the Unix timestamp (ms) when this worker is allowed to send.
 * If the slot is in the future, the caller should sleep until then.
 */
export async function reserveSendSlot(senderId: string): Promise<number> {
  const minDelayMs = config.rateLimit.minDelaySeconds * 1000;

  if (minDelayMs <= 0) {
    console.log(`[Delay] No minimum delay configured, proceeding immediately`);
    return Date.now();
  }

  const key = `sendslot:${senderId}`;
  const nowMs = Date.now();
  // TTL: keep the slot reservation alive for minDelay * 10 (generous buffer)
  const ttlSeconds = Math.max(60, config.rateLimit.minDelaySeconds * 10);

  const slotMs = (await redisClient.eval(
    RESERVE_SEND_SLOT_SCRIPT,
    1,
    key,
    String(nowMs),
    String(minDelayMs),
    String(ttlSeconds)
  )) as number;

  const waitMs = slotMs - nowMs;
  if (waitMs > 0) {
    console.log(`[Delay] Send slot reserved at T+${waitMs}ms for sender ${senderId}`);
  } else {
    console.log(`[Delay] Send slot immediately available for sender ${senderId}`);
  }

  return slotMs;
}

/**
 * Wait until the reserved send slot time.
 */
export async function waitForSendSlot(senderId: string): Promise<void> {
  const slotMs = await reserveSendSlot(senderId);
  const waitMs = slotMs - Date.now();
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}
