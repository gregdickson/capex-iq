import { RequestHandler } from 'express';

export function apiKeyAuth(apiKey: string): RequestHandler {
  return (req, res, next) => {
    // Allow health check through
    if (req.path === '/health') return next();

    // Check Authorization header (for API clients)
    const authHeader = req.headers.authorization;
    if (authHeader === `Bearer ${apiKey}`) return next();

    // Check cookie (for browser sessions)
    const cookies = parseCookies(req.headers.cookie || '');
    if (cookies['capexiq_key'] === apiKey) return next();

    // Login page and login POST are public
    if (req.path === '/login') return next();

    // Redirect browsers to login, return 401 for API requests
    const wantsJson = req.headers.accept?.includes('application/json');
    if (wantsJson) {
      res.status(401).json({ error: 'Unauthorized' });
    } else {
      res.redirect('/login');
    }
  };
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key] = rest.join('=');
  }
  return cookies;
}
