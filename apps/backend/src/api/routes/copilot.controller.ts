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
} from '@nestjs/common';
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
  copilotRuntimeNextJSAppRouterEndpoint,
} from '@copilotkit/runtime';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { BrandKitService } from '@gitroom/nestjs-libraries/database/prisma/brand-kit/brand-kit.service';
import { MastraAgent } from '@ag-ui/mastra';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import {
  isAgentGeneration,
  takeAgentRunSlot,
} from '@gitroom/nestjs-libraries/chat/agent-run-slot';
import { PendingActionService } from '@gitroom/nestjs-libraries/chat/pending-action.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { Request, Response } from 'express';
import { RequestContext } from '@mastra/core/di';
import { recordAgentMessage } from '@gitroom/nestjs-libraries/services/ai-usage.record';
import { threadStateClient } from '@gitroom/nestjs-libraries/chat/thread-state';
import { AGENT_FAIR_USE_MESSAGES } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';

export type ChannelsContext = {
  integrations: string;
  organization: string;
  ui: string;
  brandKit: string;
};

@Controller('/copilot')
export class CopilotController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _mastraService: MastraService,
    private _brandKitService: BrandKitService,
    private _pendingActionService: PendingActionService,
    private _postsService: PostsService
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
      runtime: new CopilotRuntime(),
      // Ghost-text suggestions; recorded in AiUsage like every other AI call
      // (decision 2026-10-02: keep the feature, meter it).
      serviceAdapter: meterCopilotAdapter(
        new OpenAIAdapter({
          model: 'gpt-4.1',
        }),
        organization.id,
        'autocomplete'
      ),
    });

    return copilotRuntimeHandler(req, res);
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

    const mastra = await this._mastraService.mastra();
    const requestContext = new RequestContext<ChannelsContext>();
    requestContext.set(
      'integrations',
      req?.body?.variables?.properties?.integrations || []
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
    // Without a state client CopilotKit's loadAgentState answered "no
    // messages" and the browser emptied a chat opened again (K. 2026-10-08).
    const memory = await mastra.getAgent('postra').getMemory();
    for (const agent of Object.values(agents)) {
      Object.assign(agent, {
        client: threadStateClient((threadId) =>
          memory!.recall({ resourceId: organization.id, threadId })
        ),
      });
    }

    const runtime = new CopilotRuntime({
      agents,
    });

    const copilotRuntimeHandler = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: '/copilot/agent',
      runtime,
      // properties: req.body.variables.properties,
      serviceAdapter: new OpenAIAdapter({
        model: 'gpt-4.1',
      }),
    });

    // ALS scope so the metered gpt-5.5 model (built once at boot) can attribute
    // its token usage to this request's organization.
    return aiUsageOrgContext.run(organization.id, () =>
      copilotRuntimeHandler.handleRequest(req, res)
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
