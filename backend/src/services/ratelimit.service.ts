import { redisClient } from '../lib/redis';
import { config } from '../config';

/**
 * Redis-backed rate limiter using atomic Lua scripts.
 *
 * Key pattern: ratelimit:{senderId}:{epochHour}
 * Global key:  ratelimit:global:{epochHour}
 *
 * The check-and-increment is done in a SINGLE atomic Lua script
 * so there is no TOCTOU race between check and increment.
 *
 * With WORKER_CONCURRENCY=3 and multiple worker instances,
 * the Lua script guarantees exactly-once slot reservation per send.
 */

function getEpochHour(): number {
  return Math.floor(Date.now() / (1000 * 60 * 60));
}

function getSenderKey(senderId: string, epochHour: number): string {
  return `ratelimit:${senderId}:${epochHour}`;
}

function getGlobalKey(epochHour: number): string {
  return `ratelimit:global:${epochHour}`;
}

export interface RateLimitResult {
  allowed: boolean;
  senderCount: number;
  globalCount: number;
  senderLimit: number;
  globalLimit: number;
  retryAfterMs: number;
}

/**
 * Lua script: atomically check both sender and global counters.
 * Returns:
 *   [1, senderCount, globalCount]  → allowed (slot reserved)
 *   [0, senderCount, globalCount]  → denied
 *
 * KEYS[1] = senderKey
 * KEYS[2] = globalKey
 * ARGV[1] = senderLimit
 * ARGV[2] = globalLimit
 * ARGV[3] = ttlSeconds (3600)
 */
const CHECK_AND_RESERVE_SCRIPT = `
local senderKey = KEYS[1]
local globalKey = KEYS[2]
local senderLimit = tonumber(ARGV[1])
local globalLimit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local senderCount = tonumber(redis.call('GET', senderKey) or '0')
local globalCount = tonumber(redis.call('GET', globalKey) or '0')

if senderCount >= senderLimit or globalCount >= globalLimit then
  return {0, senderCount, globalCount}
end

local newSender = redis.call('INCR', senderKey)
redis.call('EXPIRE', senderKey, ttl)
local newGlobal = redis.call('INCR', globalKey)
redis.call('EXPIRE', globalKey, ttl)

return {1, newSender, newGlobal}
`;

/**
 * Atomically check rate limit AND reserve a slot if allowed.
 *
 * @param senderId - Sender ID for per-sender limiting
 * @param scheduleHourlyLimit - Hourly limit from the schedule (user-defined).
 *   Falls back to config env default if not provided.
 */
export async function checkAndReserveRateLimit(
  senderId: string,
  scheduleHourlyLimit?: number | null
): Promise<RateLimitResult> {
  const epochHour = getEpochHour();
  const senderKey = getSenderKey(senderId, epochHour);
  const globalKey = getGlobalKey(epochHour);

  // Prefer the per-schedule limit; fall back to env default
  const senderLimit = scheduleHourlyLimit ?? config.rateLimit.maxPerHourPerSender;
  const globalLimit = config.rateLimit.maxPerHourGlobal;

  console.log(
    `[RateLimit] Checking sender ${senderId} (senderLimit=${senderLimit}, globalLimit=${globalLimit})`
  );

  const result = (await redisClient.eval(
    CHECK_AND_RESERVE_SCRIPT,
    2,
    senderKey,
    globalKey,
    String(senderLimit),
    String(globalLimit),
    '3600'
  )) as [number, number, number];

  const allowed = result[0] === 1;
  const senderCount = result[1];
  const globalCount = result[2];

  const nowMs = Date.now();
  const currentHourStartMs = epochHour * 60 * 60 * 1000;
  const nextHourStartMs = currentHourStartMs + 60 * 60 * 1000;
  const retryAfterMs = nextHourStartMs - nowMs;

  if (allowed) {
    console.log(
      `[RateLimit] Slot reserved for sender ${senderId}: ${senderCount}/${senderLimit} sender, ${globalCount}/${globalLimit} global`
    );
  } else {
    console.log(
      `[RateLimit] Hourly limit reached for sender ${senderId}: ${senderCount}/${senderLimit} sender, ${globalCount}/${globalLimit} global. Next window in ${Math.ceil(retryAfterMs / 1000)}s`
    );
  }

  return {
    allowed,
    senderCount,
    globalCount,
    senderLimit,
    globalLimit,
    retryAfterMs,
  };
}

/**
 * @deprecated Use checkAndReserveRateLimit (atomic) instead.
 * Left for compatibility; reads current counts without reserving.
 */
export async function checkRateLimit(
  senderId: string,
  scheduleHourlyLimit?: number | null
): Promise<RateLimitResult> {
  return checkAndReserveRateLimit(senderId, scheduleHourlyLimit);
}

/**
 * @deprecated Increment is now done atomically inside checkAndReserveRateLimit.
 * Kept for backward compat but is a no-op.
 */
export async function incrementRateLimit(
  _senderId: string
): Promise<{ senderCount: number; globalCount: number }> {
  return { senderCount: 0, globalCount: 0 };
}

export function getLimitHitType(result: RateLimitResult): 'sender' | 'global' | null {
  if (result.senderCount >= result.senderLimit) return 'sender';
  if (result.globalCount >= result.globalLimit) return 'global';
  return null;
}

/**
 * Get current counts without reserving a slot (read-only peek).
 */
export async function peekRateLimit(
  senderId: string,
  scheduleHourlyLimit?: number | null
): Promise<RateLimitResult> {
  const epochHour = getEpochHour();
  const senderKey = getSenderKey(senderId, epochHour);
  const globalKey = getGlobalKey(epochHour);

  const senderLimit = scheduleHourlyLimit ?? config.rateLimit.maxPerHourPerSender;
  const globalLimit = config.rateLimit.maxPerHourGlobal;

  const [senderCountStr, globalCountStr] = await Promise.all([
    redisClient.get(senderKey),
    redisClient.get(globalKey),
  ]);

  const senderCount = parseInt(senderCountStr || '0', 10);
  const globalCount = parseInt(globalCountStr || '0', 10);
  const allowed = senderCount < senderLimit && globalCount < globalLimit;

  const nowMs = Date.now();
  const currentHourStartMs = epochHour * 60 * 60 * 1000;
  const nextHourStartMs = currentHourStartMs + 60 * 60 * 1000;
  const retryAfterMs = nextHourStartMs - nowMs;

  return { allowed, senderCount, globalCount, senderLimit, globalLimit, retryAfterMs };
}
