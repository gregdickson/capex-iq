import { Queue, Worker, type Processor } from 'bullmq';
import { Redis } from 'ioredis';

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}

// Queue names
export const QUEUE_NAMES = {
  INTAKE: 'intake',
  MATCHING: 'matching',
  QUALIFICATION: 'qualification',
  EMAIL_GENERATION: 'email-generation',
  GHL_SEND: 'ghl-send',
} as const;

// Queue instances (lazy-created)
const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, { connection: getRedisConnection() }));
  }
  return queues.get(name)!;
}

// Worker factory with retry config
export function createWorker(
  name: string,
  processor: Processor,
  opts?: { concurrency?: number; limiter?: { max: number; duration: number } }
): Worker {
  return new Worker(name, processor, {
    connection: getRedisConnection(),
    concurrency: opts?.concurrency ?? 1,
    limiter: opts?.limiter,
    settings: {
      backoffStrategy: (attemptsMade: number) => {
        // Exponential backoff: 5s, 30s, 2min
        const delays = [5000, 30000, 120000];
        return delays[Math.min(attemptsMade - 1, delays.length - 1)];
      },
    },
  });
}

// Get queue stats for health check
export async function getQueueStats() {
  const stats: Record<string, { waiting: number; active: number; failed: number }> = {};

  for (const name of Object.values(QUEUE_NAMES)) {
    const q = getQueue(name);
    const [waiting, active, failed] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getFailedCount(),
    ]);
    stats[name] = { waiting, active, failed };
  }

  return stats;
}

export async function closeQueues(): Promise<void> {
  for (const q of queues.values()) {
    await q.close();
  }
  queues.clear();
  if (connection) {
    connection.disconnect();
    connection = null;
  }
}
