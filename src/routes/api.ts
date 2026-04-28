import { Router, type Request, type Response } from 'express';
import { getAllSettings, setSetting } from '../db/settings.js';
import {
  getActivePrompt,
  savePrompt,
  getPromptHistory,
  activatePrompt,
} from '../db/prompts.js';
import { getCompanyById, updateCompanyStatus, getReadyToSend, getSentTodayCount, getRetriableFailures } from '../db/queries.js';
import { getSettingNumber } from '../db/settings.js';
import { getQueue, QUEUE_NAMES } from '../queue/setup.js';

const router = Router();

// --- Settings ---

router.get('/api/settings', async (_req: Request, res: Response) => {
  const settings = await getAllSettings();
  res.json(settings);
});

router.put('/api/settings', async (req: Request, res: Response) => {
  const updates = req.body as Record<string, string>;

  if (!updates || typeof updates !== 'object') {
    res.status(400).json({ error: 'Expected JSON object with key-value pairs' });
    return;
  }

  for (const [key, value] of Object.entries(updates)) {
    await setSetting(key, String(value));
  }

  res.json({ updated: Object.keys(updates) });
});

// --- Prompts ---

const PROMPT_KEYS = [
  'email_generation_system',
  'email_generation_user',
  'ca_analysis_system',
  'ca_analysis_user',
];

router.get('/api/prompts', async (_req: Request, res: Response) => {
  const prompts: Record<string, any> = {};
  for (const key of PROMPT_KEYS) {
    const active = await getActivePrompt(key);
    prompts[key] = active;
  }
  res.json(prompts);
});

router.get('/api/prompts/:key', async (req: Request, res: Response) => {
  const key = String(req.params.key);
  const active = await getActivePrompt(key);
  const history = await getPromptHistory(key);
  res.json({ active, history });
});

router.put('/api/prompts/:key', async (req: Request, res: Response) => {
  const key = String(req.params.key);
  const { content, notes } = req.body as { content: string; notes?: string };

  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  const prompt = await savePrompt(key, content, notes);
  res.json(prompt);
});

router.post('/api/prompts/:id/activate', async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID' }); return; }

  const prompt = await activatePrompt(id);
  if (!prompt) { res.status(404).json({ error: 'Prompt not found' }); return; }

  res.json(prompt);
});

// --- Retry ---

router.post('/api/retry/:companyId', async (req: Request, res: Response) => {
  const companyId = parseInt(String(req.params.companyId), 10);
  if (isNaN(companyId)) { res.status(400).json({ error: 'Invalid ID' }); return; }

  const company = await getCompanyById(companyId);
  if (!company) { res.status(404).json({ error: 'Company not found' }); return; }

  // Determine which queue to re-enqueue to based on failure status
  const statusToQueue: Record<string, string> = {
    failed_matching: QUEUE_NAMES.MATCHING,
    failed_qualification: QUEUE_NAMES.QUALIFICATION,
    failed_email_generation: QUEUE_NAMES.EMAIL_GENERATION,
    failed_ghl_push: QUEUE_NAMES.GHL_SEND,
  };

  const queueName = statusToQueue[company.status];
  const referer = req.headers.referer || `/runs/${company.pipeline_run_id}`;
  if (!queueName) {
    // Redirect back with error flash via query param
    res.redirect(`${referer}${referer.includes('?') ? '&' : '?'}error=${encodeURIComponent(`Cannot retry status: ${company.status}`)}`);
    return;
  }

  // Build job data based on the queue
  const queue = getQueue(queueName);
  let jobData: Record<string, any> = {
    companyId: company.id,
    runId: company.pipeline_run_id,
  };

  if (queueName === QUEUE_NAMES.MATCHING) {
    jobData.domain = company.domain;
    jobData.orgName = company.org_name;
    jobData.orgDescription = '';
  } else if (queueName === QUEUE_NAMES.QUALIFICATION) {
    jobData.companyNumber = company.company_number;
    jobData.companyName = company.company_name;
    jobData.orgName = company.org_name;
    jobData.orgDescription = '';
  } else if (queueName === QUEUE_NAMES.EMAIL_GENERATION) {
    jobData.companyNumber = company.company_number;
    jobData.companyName = company.company_name;
    jobData.orgName = company.org_name;
    jobData.orgDescription = '';
    jobData.scoring = {
      capexiqScore: company.capexiq_score,
      ppeScore: company.ppe_score,
      sicScore: company.sic_score,
      investmentActivityScore: company.investment_activity_score,
      assetIntensityScore: company.asset_intensity_score,
      ppeCategory: company.ppe_category,
      opportunityValue: company.opportunity_value,
      indicators: company.ca_indicators || [],
    };
    jobData.caAnalysis = company.ca_analysis ? (typeof company.ca_analysis === 'string' ? JSON.parse(company.ca_analysis) : company.ca_analysis) : null;
    jobData.financials = company.financials ? (typeof company.financials === 'string' ? JSON.parse(company.financials) : company.financials) : {};
    jobData.extracted = {};
  }

  // Increment retry count and reset status
  await updateCompanyStatus(companyId, 'pending', {
    retry_count: (company.retry_count || 0) + 1,
    error_log: null,
  });

  await queue.add('retry', jobData, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });

  res.redirect(referer);
});

// --- Manual trigger: GHL send + retry (same as cron) ---

router.post('/api/trigger/send', async (_req: Request, res: Response) => {
  try {
    const dailyLimit = await getSettingNumber('daily_send_limit', 150);
    const sentToday = await getSentTodayCount();
    const remaining = Math.max(0, dailyLimit - sentToday);

    let sendCount = 0;
    if (remaining > 0) {
      const records = await getReadyToSend(remaining);
      const ghlQueue = getQueue(QUEUE_NAMES.GHL_SEND);
      for (const record of records) {
        await ghlQueue.add('ghl-send', {
          companyId: record.id,
          runId: record.pipeline_run_id,
        }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        });
        sendCount++;
      }
    }

    // Retry failed jobs
    const statusToQueue: Record<string, string> = {
      failed_matching: QUEUE_NAMES.MATCHING,
      failed_qualification: QUEUE_NAMES.QUALIFICATION,
      failed_email_generation: QUEUE_NAMES.EMAIL_GENERATION,
      failed_ghl_push: QUEUE_NAMES.GHL_SEND,
    };

    const failures = await getRetriableFailures(3);
    let retryCount = 0;
    for (const record of failures) {
      const queueName = statusToQueue[record.status];
      if (!queueName) continue;

      const queue = getQueue(queueName);
      const jobData: Record<string, any> = {
        companyId: record.id,
        runId: record.pipeline_run_id,
      };

      await updateCompanyStatus(record.id, 'pending', {
        retry_count: (record.retry_count || 0) + 1,
        error_log: null,
      });

      await queue.add('manual-retry', jobData, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
      retryCount++;
    }

    const referer = _req.headers.referer || '/';
    res.redirect(`${referer}${referer.includes('?') ? '&' : '?'}sent=${sendCount}&retried=${retryCount}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const referer = _req.headers.referer || '/';
    res.redirect(`${referer}${referer.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`);
  }
});

export default router;
