import { Router, type Request, type Response } from 'express';
import {
  getPipelineRuns,
  getPipelineRun,
  getRunSummary,
  getRunCompanies,
  getFailedCompanies,
  getCompanyById,
  getSentTodayCount,
} from '../db/queries.js';
import { getSetting } from '../db/settings.js';

const router = Router();

// Dashboard — pipeline runs overview
router.get('/', async (_req: Request, res: Response) => {
  const runs = await getPipelineRuns();
  const sentToday = await getSentTodayCount();
  const dailyLimit = await getSetting('daily_send_limit') || '150';
  res.render('dashboard', {
    page: 'dashboard',
    title: 'Dashboard',
    runs,
    sentToday,
    dailyLimit: parseInt(dailyLimit, 10),
  });
});

// Run detail — drill into a specific run
router.get('/runs/:id', async (req: Request, res: Response) => {
  const runId = parseInt(String(req.params.id), 10);
  if (isNaN(runId)) { res.status(400).send('Invalid run ID'); return; }

  const run = await getPipelineRun(runId);
  if (!run) { res.status(404).send('Run not found'); return; }

  const statusFilter = (req.query.status as string) || undefined;
  const page = parseInt(req.query.page as string, 10) || 1;
  const summary = await getRunSummary(runId);
  const { companies, total, pageSize } = await getRunCompanies(runId, statusFilter, page);

  res.render('run-detail', {
    page: 'dashboard',
    title: `Run #${runId}`,
    run,
    summary,
    companies,
    total,
    currentPage: page,
    pageSize,
    statusFilter: statusFilter || 'all',
    totalPages: Math.ceil(total / pageSize),
  });
});

// Failures view
router.get('/failures', async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const { companies, total, pageSize } = await getFailedCompanies(page);

  res.render('failures', {
    page: 'failures',
    title: 'Failures',
    companies,
    total,
    currentPage: page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
});

// Company detail (JSON API for debugging)
router.get('/api/companies/:id', async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID' }); return; }

  const company = await getCompanyById(id);
  if (!company) { res.status(404).json({ error: 'Not found' }); return; }

  res.json(company);
});

export default router;
