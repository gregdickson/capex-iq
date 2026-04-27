import { Router, type Request, type Response } from 'express';
import { query } from '../db/client.js';
import { getRedisConnection, getQueueStats } from '../queue/setup.js';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  const checks: Record<string, any> = { status: 'ok' };

  // Database check
  try {
    await query('SELECT 1');
    checks.db = 'connected';
  } catch (err) {
    checks.db = 'disconnected';
    checks.status = 'degraded';
  }

  // Redis check
  try {
    const redis = getRedisConnection();
    await redis.ping();
    checks.redis = 'connected';
  } catch (err) {
    checks.redis = 'disconnected';
    checks.status = 'degraded';
  }

  // Queue stats
  try {
    checks.queues = await getQueueStats();
  } catch (err) {
    checks.queues = 'unavailable';
  }

  const statusCode = checks.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(checks);
});

export default router;
