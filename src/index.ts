import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ejsLayouts from 'express-ejs-layouts';
import { loadApiEnv } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { apiKeyAuth } from './middleware/auth.js';
import healthRouter from './routes/health.js';
import dashboardRouter from './routes/dashboard.js';
import uploadRouter from './routes/upload.js';
import apiRouter from './routes/api.js';
import { getAllSettings } from './db/settings.js';
import { getActivePrompt, savePrompt, getPromptHistory, activatePrompt } from './db/prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = loadApiEnv();

const app = express();

// EJS setup
app.set('view engine', 'ejs');
// EJS views live in src/, not dist/ — they aren't compiled by TypeScript
app.set('views', path.join(__dirname, '..', 'src', 'views'));
app.set('layout', 'layout');
app.use(ejsLayouts);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth middleware (health + login are public, everything else requires API key)
app.use(apiKeyAuth(env.API_KEY));

// Login routes
app.get('/login', (_req, res) => {
  res.render('login', { page: 'login', title: 'Login', error: null });
});

app.post('/login', (req, res) => {
  const { key } = req.body as { key: string };
  if (key === env.API_KEY) {
    res.setHeader('Set-Cookie', `capexiq_key=${key}; HttpOnly; Path=/; SameSite=Strict; Max-Age=2592000`);
    res.redirect('/');
  } else {
    res.render('login', { page: 'login', title: 'Login', error: 'Invalid key' });
  }
});

// Health check (no layout)
app.use(healthRouter);

// Dashboard routes
app.use(dashboardRouter);

// Upload routes
app.use(uploadRouter);

// API routes (JSON)
app.use(apiRouter);

// Settings page (form-based)
app.get('/settings', async (_req, res) => {
  const settings = await getAllSettings();
  res.render('settings', { page: 'settings', title: 'Settings', settings });
});

app.post('/settings', async (req, res) => {
  const body = req.body as Record<string, string>;
  const { getAllSettings: getAll, setSetting } = await import('./db/settings.js');

  for (const [key, value] of Object.entries(body)) {
    if (key && value !== undefined) {
      await setSetting(key, String(value));
    }
  }

  const settings = await getAll();
  res.render('settings', {
    page: 'settings',
    title: 'Settings',
    settings,
    message: 'Settings saved successfully',
  });
});

// Prompts page (form-based)
const PROMPT_KEYS = [
  'email_generation_system',
  'email_generation_user',
  'email_generation_no_match_system',
  'email_generation_no_match_user',
  'ca_analysis_system',
  'ca_analysis_user',
];

app.get('/prompts', async (req, res) => {
  const activeKey = (req.query.key as string) || PROMPT_KEYS[0];
  const activePrompt = await getActivePrompt(activeKey);
  const history = await getPromptHistory(activeKey);

  res.render('prompts', {
    page: 'prompts',
    title: 'Prompts',
    promptKeys: PROMPT_KEYS,
    activeKey,
    activePrompt,
    history,
  });
});

app.post('/prompts', async (req, res) => {
  const { key, content, notes } = req.body as { key: string; content: string; notes?: string };

  if (key && content) {
    await savePrompt(key, content, notes);
  }

  const activePrompt = await getActivePrompt(key);
  const history = await getPromptHistory(key);

  res.render('prompts', {
    page: 'prompts',
    title: 'Prompts',
    promptKeys: PROMPT_KEYS,
    activeKey: key,
    activePrompt,
    history,
    message: 'Prompt saved as new version',
  });
});

app.post('/prompts/activate', async (req, res) => {
  const { id, returnKey } = req.body as { id: string; returnKey: string };
  const promptId = parseInt(id, 10);

  if (!isNaN(promptId)) {
    await activatePrompt(promptId);
  }

  res.redirect(`/prompts?key=${returnKey || PROMPT_KEYS[0]}`);
});

// Start server
async function start() {
  console.log('[api] Running migrations...');
  await runMigrations();

  app.listen(env.PORT, () => {
    console.log(`[api] CapexIQ API running on port ${env.PORT}`);
  });
}

start().catch((err) => {
  console.error('[api] Failed to start:', err);
  process.exit(1);
});

export default app;
