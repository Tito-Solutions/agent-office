// Connecting Jira (see jira/links.ts): /jira/connect sends the browser to Atlassian's consent page,
// which sends it back to /jira/callback with a code. Both need someone signed in, and the connection
// is theirs: their account's, or the office's on the shared password.
import type http from 'node:http';
import type { Config } from '../../config.js';
import { isSecure } from '../util.js';
import type { Route } from '../router.js';

/** The office as the browser reached it, which is where Atlassian has to send it back. */
export function officeOrigin(req: http.IncomingMessage, cfg: Config): string | undefined {
  const host = (cfg.trustProxy && (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim()) || req.headers.host;
  if (!host || !/^[A-Za-z0-9.\-[\]:]+$/.test(host)) return undefined;
  return `${isSecure(req, cfg) ? 'https' : 'http'}://${host}`;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** A page for the tab Atlassian sent back: it closes itself when it worked, since the office already shows it. */
function page(res: http.ServerResponse, status: number, title: string, text: string, ok: boolean) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<style>body{font:16px system-ui,sans-serif;background:#1d2030;color:#eef;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:30rem;padding:2rem;text-align:center}h1{font-size:1.4rem}a{color:#9cf}</style></head>
<body><main><h1>${ok ? '✅' : '⚠️'} ${escape(title)}</h1><p>${escape(text)}</p><p><a href="/">Back to the office</a></p></main>
${ok ? '<script>setTimeout(function(){window.close()},1500)</script>' : ''}</body></html>`;
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" });
  res.end(html);
}

export const jiraRoutes = {
  connect: {
    method: 'GET',
    path: '/jira/connect',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      const origin = officeOrigin(req, ctx.cfg);
      if (!origin) return page(res, 400, "Couldn't connect Jira", "The office couldn't tell its own address from this request.", false);
      try {
        const to = await ctx.jira.begin(session.account?.id ?? '', session.account?.name ?? 'the office', `${origin}/jira/callback`);
        res.writeHead(302, { location: to, 'cache-control': 'no-store' }).end();
      } catch (err) {
        page(res, 502, "Couldn't connect Jira", (err as Error).message, false);
      }
    },
  },
  callback: {
    method: 'GET',
    path: '/jira/callback',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const owner = session.account?.id ?? '';
      const q = url.searchParams;
      const state = q.get('state') ?? '';
      const error = q.get('error');
      if (error || !q.get('code')) {
        const why = error === 'access_denied' ? 'You said no on Atlassian’s page.' : `Atlassian said: ${(q.get('error_description') ?? error ?? 'no code').slice(0, 300)}`;
        ctx.jira.fail(owner, state, why);
        return page(res, 400, 'Jira wasn’t connected', why, false);
      }
      try {
        await ctx.jira.finish(owner, state, q.get('code')!);
        page(res, 200, 'Jira is connected', 'Workers you hire from now on can use Jira. You can close this tab.', true);
      } catch (err) {
        page(res, 400, 'Jira wasn’t connected', (err as Error).message, false);
      }
    },
  },
} satisfies Record<string, Route>;
