import { meterCopilotAdapter } from '@gitroom/nestjs-libraries/services/ai-usage.copilot';
import { aiUsageOrgContext } from '@gitroom/nestjs-libraries/services/ai-usage.model-wrap';
import { Throttle } from '@nestjs/throttler';
import {
  Logger,
  Controller,
  Get,
  HttpException,
  Post,
  Req,
  Res,
  Query,
  Param,
  Body,
} from '@nestjs/common';
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from '@copilotkit/runtime';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { BrandKitService } from '@gitroom/nestjs-libraries/database/prisma/brand-kit/brand-kit.service';
import { MastraAgent } from '@ag-ui/mastra';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import {
  agentRouteRequest,
  isAgentGeneration,
  takeAgentRunSlot,
} from '@gitroom/nestjs-libraries/chat/agent-run-slot';
import { PendingActionService } from '@gitroom/nestjs-libraries/chat/pending-action.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { Request, Response } from 'express';
import { RequestContext } from '@mastra/core/di';
import { recordAgentMessage } from '@gitroom/nestjs-libraries/services/ai-usage.record';
import { AGENT_FAIR_USE_MESSAGES } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { AutocompleteDto } from '@gitroom/nestjs-libraries/dtos/copilot/autocomplete.dto';

export type ChannelsContext = {
  integrations: string;
  organization: string;
  ui: string;
  brandKit: string;
};

// The runtime answers with its own CORS headers; without these it allows any
// origin. Same list as the app's CORS in main.ts.
const copilotCors = () => ({
  origin: [
    process.env.FRONTEND_URL,
    ...(process.env.NOT_SECURED ? ['http://localhost:6274'] : []),
    ...(process.env.MAIN_URL ? [process.env.MAIN_URL] : []),
  ].filter((o): o is string => !!o),
  credentials: !process.env.NOT_SECURED,
});

@Controller('/copilot')
export class CopilotController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _mastraService: MastraService,
    private _brandKitService: BrandKitService,
    private _pendingActionService: PendingActionService,
    private _postsService: PostsService,
    private _openaiService: OpenaiService
  ) {}
  @Post('/chat')
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  chatAgent(
    @Req() req: Request,
    @Res() res: Response,
    @GetOrgFromRequest() organization: Organization
  ) {
    if (
      process.env.OPENAI_API_KEY === undefined ||
      process.env.OPENAI_API_KEY === ''
    ) {
      Logger.warn('OpenAI API key not set, chat functionality will not work');
      return;
    }

    const copilotRuntimeHandler = copilotRuntimeNodeHttpEndpoint({
      endpoint: '/copilot/chat',
      cors: copilotCors(),
      runtime: new CopilotRuntime(),
      // Ghost-text suggestions; recorded in AiUsage like every other AI call
      // (the feature stays, metered).
      serviceAdapter: meterCopilotAdapter(
        new OpenAIAdapter({
          model: 'gpt-4.1',
        }),
        'autocomplete'
      ),
    });

    // The metered model reads the organization from this scope.
    return aiUsageOrgContext.run(organization.id, () =>
      copilotRuntimeHandler(req, res)
    );
  }

  // Ghost text in the signature, AutoPost and Plugs editors. CopilotKit's
  // textarea stopped asking for suggestions itself (a stub since 1.60), so
  // the editors call this with their own suggestion function. Best effort: an
  // OpenAI failure is no suggestion, not an error in the editor.
  @Post('/autocomplete')
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async autocomplete(
    @GetOrgFromRequest() organization: Organization,
    @Body() body: AutocompleteDto
  ) {
    try {
      return {
        suggestion: await this._openaiService.autocomplete(
          body.surface,
          body.before,
          body.after ?? '',
          organization.id
        ),
      };
    } catch (err) {
      Logger.warn(
        `Autocomplete failed: ${err instanceof Error ? err.message : String(err)}`,
        'CopilotController'
      );
      return { suggestion: '' };
    }
  }

  @Post('/agent')
  @Throttle({ default: { ttl: 300000, limit: 60 } })
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async agent(
    @Req() req: Request,
    @Res() res: Response,
    @GetOrgFromRequest() organization: Organization
  ) {
    if (
      process.env.OPENAI_API_KEY === undefined ||
      process.env.OPENAI_API_KEY === ''
    ) {
      Logger.warn('OpenAI API key not set, chat functionality will not work');
      return;
    }

    // Only our methods, and a thread of this organisation (agent-run-slot.ts).
    const route = agentRouteRequest(req.body);
    if (!route.allowed) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const mastra = await this._mastraService.mastra();
    if (route.threadId) {
      const memory = await mastra.getAgent('postra').getMemory();
      const thread = await memory?.getThreadById({ threadId: route.threadId });
      if (thread && thread.resourceId !== organization.id) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }
    }

    // Monthly fair use (pricing.agent_messages, questions counted in
    // AiUsage). Like the image/video paths, only enforced with billing on —
    // without a publishable key the ledger is advisory. The chat UI checks the
    // same budget via GET /copilot/credits?type=ai_agent and shows a banner,
    // so this 402 is the backstop, not the primary UX.
    if (process.env.STRIPE_PUBLISHABLE_KEY) {
      const { credits } = await this._subscriptionService.checkCredits(
        organization,
        'ai_agent'
      );
      if (credits <= 0) {
        res.status(402).json({
          error:
            `You have reached this month's fair-use limit for the AI assistant (${AGENT_FAIR_USE_MESSAGES.toLocaleString('en-GB')} questions, the same on every plan). It resets with your next billing month.`,
        });
        return;
      }
    }

    // Only a reply costs tokens; the chat also asks which agents exist and
    // loads thread state on every page load.
    if (isAgentGeneration(req.body)) {
      const release = await takeAgentRunSlot(organization.id);
      if (!release) {
        res.status(429).json({
          error:
            'The AI assistant is already answering in another chat. Wait for it to finish, then try again.',
        });
        return;
      }
      res.on('close', () => {
        release().catch(() => undefined);
      });
      recordAgentMessage(organization.id);
    }

    const requestContext = new RequestContext<ChannelsContext>();
    // The provider's `properties`, forwarded with every run.
    requestContext.set(
      'integrations',
      req?.body?.body?.forwardedProps?.integrations || []
    );

    requestContext.set('organization', JSON.stringify(organization));
    requestContext.set('ui', 'true');

    // Give the agent the org's Brand Kit (voice, colors, font) so it writes in
    // the user's brand and reflects it when generating images/designs.
    const brandKit = await this._brandKitService.getNormalized(organization.id);
    requestContext.set('brandKit', brandKit ? JSON.stringify(brandKit) : '');

    const agents = MastraAgent.getLocalAgents({
      resourceId: organization.id,
      mastra,
      requestContext: requestContext as any,
    });
    const runtime = new CopilotRuntime({
      agents,
    });

    // The agents answer every run; no service adapter, so no unmetered
    // default model behind them.
    const copilotRuntimeHandler = copilotRuntimeNodeHttpEndpoint({
      endpoint: '/copilot/agent',
      cors: copilotCors(),
      runtime,
    });

    // ALS scope so the metered gpt-5.5 model (built once at boot) can attribute
    // its token usage to this request's organization.
    return aiUsageOrgContext.run(organization.id, () =>
      copilotRuntimeHandler(req, res)
    );
  }

  /**
   * The other half of the destructive tools: they park the action and return a
   * token, and nothing happens until this runs. Approving is a person clicking
   * a card in the chat, so the model cannot reach it however it is prompted.
   */
  @Post('/pending/:token/approve')
  @Throttle({ default: { ttl: 300000, limit: 60 } })
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async approvePendingAction(
    @GetOrgFromRequest() organization: Organization,
    @Param('token') token: string
  ) {
    const action = await this._pendingActionService.consume(
      token,
      organization.id
    );
    if (!action) {
      throw new HttpException(
        'This confirmation is no longer valid - it was already used or it expired. Ask the assistant again.',
        410
      );
    }

    if (action.kind === 'deletePost') {
      await this._postsService.deletePost(
        organization.id,
        action.payload.group
      );
      return { done: true, kind: action.kind };
    }

    await this._postsService.changeDate(
      organization.id,
      action.payload.id,
      action.payload.date,
      'schedule'
    );
    return { done: true, kind: action.kind };
  }

  @Post('/pending/:token/decline')
  @Throttle({ default: { ttl: 300000, limit: 60 } })
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async declinePendingAction(
    @GetOrgFromRequest() organization: Organization,
    @Param('token') token: string
  ) {
    await this._pendingActionService.consume(token, organization.id);
    return { done: true, declined: true };
  }

  @Get('/credits')
  calculateCredits(
    @GetOrgFromRequest() organization: Organization,
    @Query('type') type: 'ai_images' | 'ai_videos' | 'ai_agent'
  ) {
    return this._subscriptionService.checkCredits(
      organization,
      type || 'ai_images'
    );
  }

  @Get('/:thread/list')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async getMessagesList(
    @GetOrgFromRequest() organization: Organization,
    @Param('thread') threadId: string
  ): Promise<any> {
    const mastra = await this._mastraService.mastra();
    const memory = await mastra.getAgent('postra').getMemory();
    try {
      return await memory.recall({
        resourceId: organization.id,
        threadId,
      });
    } catch (err) {
      return { messages: [] };
    }
  }

  @Get('/list')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async getList(@GetOrgFromRequest() organization: Organization) {
    const mastra = await this._mastraService.mastra();
    const memory = await mastra.getAgent('postra').getMemory();
    const list = await memory.listThreads({
      filter: { resourceId: organization.id },
      perPage: 100000,
      page: 0,
      orderBy: { field: 'createdAt', direction: 'DESC' },
    });

    return {
      threads: list.threads.map((p) => ({
        id: p.id,
        title: p.title,
      })),
    };
  }
}
