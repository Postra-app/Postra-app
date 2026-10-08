import { recordAgentMessage } from '@gitroom/nestjs-libraries/services/ai-usage.record';
import { AGENT_FAIR_USE_MESSAGES } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { lacksSubscription } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/lacks.subscription';
import { INestApplication } from '@nestjs/common';
import { json, Request, Response } from 'express';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { MCPServer } from '@mastra/mcp';
import { randomUUID } from 'crypto';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { runWithContext } from './async.storage';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { createOAuthMiddleware } from './oauth-middleware';
import { publicBackendUrl } from './public-backend-url';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
const fixAcceptHeader = (req: Request) => {
  const value = 'application/json, text/event-stream';
  req.headers.accept = value;
  const idx = req.rawHeaders.findIndex((h) => h.toLowerCase() === 'accept');
  if (idx !== -1) {
    req.rawHeaders[idx + 1] = value;
  } else {
    req.rawHeaders.push('Accept', value);
  }
};

export const startMcp = async (app: INestApplication) => {
  const mastraService = app.get(MastraService, { strict: false });
  const organizationService = app.get(OrganizationService, { strict: false });
  const oauthService = app.get(OAuthService, { strict: false });
  const subscriptionService = app.get(SubscriptionService, { strict: false });

  // The agent asked through MCP (`ask_postra`) spends the same monthly
  // fair use (pricing.agent_messages) as the chat, and like the chat it is checked before a run
  // starts; the run itself re-checks only every few steps (E2E-08-47).
  // Answered as a tool error, which MCP clients show to the person.
  const AGENT_LIMIT =
    `You have reached this month's fair-use limit for the AI assistant (${AGENT_FAIR_USE_MESSAGES.toLocaleString('en-GB')} questions, the same on every plan). It resets with your next billing month.`;
  const agentCalls = (body: unknown) =>
    (Array.isArray(body) ? body : [body]).filter(
      (m: any) => m?.method === 'tools/call' && m?.params?.name === 'ask_postra'
    );
  // These routes are mounted before Nest's body parser, so req.body is empty
  // here; parse it (4mb, the MCP SDK's own limit) and Mastra reuses it. A body
  // that fails to parse is answered here: the stream is spent by then.
  const jsonBody = json({ limit: '4mb' });
  const readBody = (req: Request, res: Response) =>
    new Promise<boolean>((resolve) =>
      jsonBody(req, res, (err?: unknown) => {
        if (err) {
          res.status(400).json({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          });
          resolve(false);
          return;
        }
        resolve(true);
      })
    );
  // Every ask_postra is a whole agent run, and the rate limit below counts
  // requests, not the calls batched into one (CodeQL on #348).
  const MAX_AGENT_CALLS_PER_REQUEST = 5;
  const AGENT_BATCH_LIMIT = `Ask at most ${MAX_AGENT_CALLS_PER_REQUEST} questions in one request.`;

  // The refusal for the request, if any: a batch over the cap, or the
  // month's fair use spent. Otherwise its questions are counted, in one write.
  const agentRunRefusal = async (
    auth: any,
    body: unknown
  ): Promise<string | null> => {
    const calls = agentCalls(body).length;
    if (!calls) {
      return null;
    }
    if (calls > MAX_AGENT_CALLS_PER_REQUEST) {
      return AGENT_BATCH_LIMIT;
    }
    if (process.env.STRIPE_PUBLISHABLE_KEY) {
      try {
        const { credits } = await subscriptionService.checkCredits(
          auth,
          'ai_agent'
        );
        if (credits <= 0) {
          return AGENT_LIMIT;
        }
      } catch {
        // Same as the run's own check: never refuse because a check failed.
      }
    }
    recordAgentMessage(auth?.id, calls);
    return null;
  };
  const refuseAgentRun = (req: Request, res: Response, text: string) => {
    const answers = agentCalls(req.body).map((m: any) => ({
      jsonrpc: '2.0',
      id: m.id,
      result: { content: [{ type: 'text', text }], isError: true },
    }));
    res.status(200).json(Array.isArray(req.body) ? answers : answers[0]);
  };

  // These raw express handlers bypass Nest's ThrottlerGuard entirely — an
  // API-key holder could loop the full agent toolset unmetered. Redis-count
  // per org; fail-open on Redis errors (availability over strictness here).
  const MCP_RATE_LIMIT = 120;
  const MCP_RATE_WINDOW_SECONDS = 300;
  const mcpRateLimited = async (orgId: string): Promise<boolean> => {
    try {
      const key = `mcp-rate:${orgId}`;
      const count = await ioRedis.incr(key);
      if (count === 1) {
        await ioRedis.expire(key, MCP_RATE_WINDOW_SECONDS);
      }
      return count > MCP_RATE_LIMIT;
    } catch {
      return false;
    }
  };

  const resolveAuth = async (token: string) => {
    if (token.startsWith('pos_')) {
      const authorization = await oauthService.getOrgByOAuthToken(token);
      if (!authorization) return null;
      return authorization.organization;
    }
    return organizationService.getOrgByApiKey(token);
  };

  const mastra = await mastraService.mastra();
  const agent = mastra.getAgent('postra');
  const tools = await agent.listTools();

  const serverConfig = {
    name: 'Postra MCP',
    version: '1.0.0',
    tools,
    agents: { postra: agent },
  };

  const server = new MCPServer(serverConfig);

  const oauthMiddleware = createOAuthMiddleware({
    oauth: {
      // The address clients connect to, which they must find again in the
      // metadata (RFC 9728 §3.3). `new URL('/mcp-oauth', …/api)` dropped
      // the /api (E2E-08-45).
      resource: publicBackendUrl('/mcp-oauth'),
      authorizationServers: [process.env.NEXT_PUBLIC_BACKEND_URL!],
      validateToken: async (token: string) => {
        const org = await resolveAuth(token);
        if (!org) {
          return { valid: false, error: 'invalid_token', errorDescription: 'Invalid API Key or OAuth token' };
        }
        if (lacksSubscription(org)) {
          return { valid: false, error: 'invalid_token', errorDescription: 'No subscription found' };
        }
        return { valid: true, subject: token };
      },
    },
    mcpPath: '/mcp-oauth',
  });

  if (process.env.OPENAI_APP_CHALLANGE) {
    app.use('/.well-known/openai-apps-challenge', (req: Request, res: Response) => {
      res.setHeader('Content-Type', 'text/plain');
      res.send(process.env.OPENAI_APP_CHALLANGE);
    });
  }

  app.use('/.well-known/oauth-protected-resource', async (req: Request, res: Response) => {
    const url = new URL('/.well-known/oauth-protected-resource', process.env.NEXT_PUBLIC_BACKEND_URL);
    await oauthMiddleware(req, res, url);
  });

  app.use('/.well-known/oauth-authorization-server', async (req: Request, res: Response) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(204);
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'max-age=3600');
    res.json({
      issuer: process.env.NEXT_PUBLIC_BACKEND_URL,
      authorization_endpoint: `${process.env.FRONTEND_URL}/oauth/authorize`,
      token_endpoint: `${process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      // The token endpoint reads client_id and client_secret from the body;
      // without this line RFC 8414 says clients should use HTTP Basic.
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      // Claude, ChatGPT and other MCP clients register themselves here
      // (RFC 7591); "none" is a public client using PKCE.
      registration_endpoint: `${process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL}/oauth/register`,
      // Checked at /oauth/token since E2E-08-44. No scopes_supported: an
      // approved app gets the whole organisation, so naming read/write
      // scopes promised a limit nothing enforced.
      code_challenge_methods_supported: ['S256'],
    });
  });

  app.use('/mcp-oauth', async (req: Request, res: Response, next: () => void) => {
    // Skip if this is the /mcp/:id route
    if (req.path !== '/' && req.path !== '') {
      next();
      return;
    }

    const url = new URL('/mcp-oauth', process.env.NEXT_PUBLIC_BACKEND_URL);

    const result = await oauthMiddleware(req, res, url);
    if (!result.proceed) return;

    const token = result.tokenValidation?.subject;
    const auth = await resolveAuth(token!);
    if (!auth) {
      res.status(401).json({ error: 'invalid_token', error_description: 'Could not resolve organization' });
      return;
    }
    if (lacksSubscription(auth)) {
      res.status(401).json({ error: 'invalid_token', error_description: 'No subscription found' });
      return;
    }

    if (await mcpRateLimited(auth.id)) {
      res.status(429).send('Too many requests');
      return;
    }

    if (!(await readBody(req, res))) {
      return;
    }
    const refusal = await agentRunRefusal(auth, req.body);
    if (refusal) {
      refuseAgentRun(req, res, refusal);
      return;
    }

    fixAcceptHeader(req);
    await runWithContext({ requestId: token!, auth }, async () => {
      await server.startHTTP({
        url: url,
        httpPath: url.pathname,
        options: {
          sessionIdGenerator: () => {
            return randomUUID();
          },
          enableJsonResponse: true,
        },
        req,
        res,
      });
    });
  });

  app.use('/mcp', async (req: Request, res: Response, next: () => void) => {
    if (req.path !== '/' && req.path !== '') {
      next();
      return;
    }

    // @ts-ignore
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      res.status(401).send('Missing Authorization header');
      return;
    }

    // @ts-ignore
    req.auth = await resolveAuth(token);
    // @ts-ignore
    if (!req.auth) {
      res.status(401).send('Invalid API Key or OAuth token');
      return;
    }
    // @ts-ignore
    if (lacksSubscription(req.auth)) {
      res.status(401).send('No subscription found');
      return;
    }

    // @ts-ignore
    if (await mcpRateLimited(req.auth.id)) {
      res.status(429).send('Too many requests');
      return;
    }

    if (!(await readBody(req, res))) {
      return;
    }
    // @ts-ignore
    const refusal = await agentRunRefusal(req.auth, req.body);
    if (refusal) {
      refuseAgentRun(req, res, refusal);
      return;
    }

    const url = new URL('/mcp', process.env.NEXT_PUBLIC_BACKEND_URL);

    fixAcceptHeader(req);
    // @ts-ignore
    await runWithContext({ requestId: token, auth: req.auth }, async () => {
      await server.startHTTP({
        url,
        httpPath: url.pathname,
        options: {
          sessionIdGenerator: () => {
            return randomUUID();
          },
          enableJsonResponse: true,
        },
        req,
        res,
      });
    });
  });

  app.use('/mcp/:id', async (req: Request, res: Response) => {
    // @ts-ignore
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    // @ts-ignore
    req.auth = await organizationService.getOrgByApiKey(req.params.id);
    // @ts-ignore
    if (!req.auth) {
      res.status(400).send('Invalid API Key');
      return;
    }
    // @ts-ignore
    if (lacksSubscription(req.auth)) {
      res.status(401).send('No subscription found');
      return;
    }

    // @ts-ignore
    if (await mcpRateLimited(req.auth.id)) {
      res.status(429).send('Too many requests');
      return;
    }

    if (!(await readBody(req, res))) {
      return;
    }
    // @ts-ignore
    const refusal = await agentRunRefusal(req.auth, req.body);
    if (refusal) {
      refuseAgentRun(req, res, refusal);
      return;
    }

    const url = new URL(
      `/mcp/${req.params.id}`,
      process.env.NEXT_PUBLIC_BACKEND_URL
    );

    fixAcceptHeader(req);
    await runWithContext(
      // @ts-ignore
      { requestId: req.params.id, auth: req.auth },
      async () => {
        await server.startHTTP({
          url,
          httpPath: url.pathname,
          options: {
            sessionIdGenerator: () => {
              return randomUUID();
            },
            enableJsonResponse: true,
          },
          req,
          res,
        });
      }
    );
  });

  app.use(['/sse/:id', '/message/:id'], async (req: Request, res: Response) => {
    // @ts-ignore
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    // @ts-ignore
    req.auth = await organizationService.getOrgByApiKey(req.params.id);
    // @ts-ignore
    if (!req.auth) {
      res.status(400).send('Invalid API Key');
      return;
    }
    // @ts-ignore
    if (lacksSubscription(req.auth)) {
      res.status(401).send('No subscription found');
      return;
    }

    // @ts-ignore
    if (await mcpRateLimited(req.auth.id)) {
      res.status(429).send('Too many requests');
      return;
    }

    // The SSE transport answers on the stream, so here the refusal is the
    // POST's own status.
    if (!(await readBody(req, res))) {
      return;
    }
    // @ts-ignore
    const refusal = await agentRunRefusal(req.auth, req.body);
    if (refusal) {
      res.status(refusal === AGENT_LIMIT ? 402 : 400).send(refusal);
      return;
    }

    const url = new URL(req.originalUrl, process.env.NEXT_PUBLIC_BACKEND_URL);

    await runWithContext(
      // @ts-ignore
      { requestId: req.params.id, auth: req.auth },
      async () => {
        await new MCPServer(serverConfig).startSSE({
          url,
          ssePath: `/sse/${req.params.id}`,
          messagePath: `/message/${req.params.id}`,
          req,
          res,
        });
      }
    );
  });
};
