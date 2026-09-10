import { meterLanguageModel } from '@gitroom/nestjs-libraries/services/ai-usage.model-wrap';
import { Injectable, Logger } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import type { AgentExecutionOptions } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { Memory } from '@mastra/memory';
import { pStore } from '@gitroom/nestjs-libraries/chat/mastra.store';
import { array, object, string } from 'zod';
import { ModuleRef } from '@nestjs/core';
import { toolList } from '@gitroom/nestjs-libraries/chat/tools/tool.list';
import dayjs from 'dayjs';
import { buildBrandAgentPrompt } from '@gitroom/nestjs-libraries/openai/brand-prompt';
import { languageRule } from '@gitroom/nestjs-libraries/openai/language-rule';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import {
  AGENT_MAX_STEPS,
  shouldStopForBudget,
} from '@gitroom/nestjs-libraries/chat/agent-budget';
import {
  describeAgentRun,
  describeAgentStep,
  organizationIdFromContext,
} from '@gitroom/nestjs-libraries/chat/agent-trace';

/**
 * Working memory: what the agent should still know in the next conversation.
 * It used to be the Mastra starter's `{ proverbs: string[] }`, and the model
 * duly filed real work in it - a stored value read on 2026-09-09 was
 * `{"proverbs":["facebook integration id: d68ca68c-..."]}`. Whatever is here
 * rides along in every later prompt for this organisation, so the fields are
 * the few things worth carrying: what the user asked us to always do, where
 * they usually post, and what they are working on right now.
 *
 * Brand voice, colours and fonts are deliberately absent - those live in the
 * Brand Kit and are injected separately, and duplicating them here would let
 * the two drift apart.
 */
export const AgentState = object({
  standingInstructions: array(string())
    .default([])
    .describe(
      'Instructions the user asked to apply from now on, e.g. "never use emojis", "always mention our website". Add one when they say it, drop one when they take it back.'
    ),
  usualChannels: array(string())
    .default([])
    .describe('Channels this user posts to most often, by name.'),
  currentFocus: string()
    .default('')
    .describe(
      'What they are working on at the moment: a campaign, a launch, a product. One short line, replaced when it changes.'
    ),
  timezone: string()
    .default('')
    .describe('IANA timezone if the user mentions their local time.'),
});

const renderArray = (list: string[], show: boolean) => {
  if (!show) return '';
  return list.map((p) => `- ${p}`).join('\n');
};

// The org's Brand Kit is injected into requestContext by the /copilot/agent
// controller. Turn it into a prompt section so the agent writes in the user's
// voice and reflects their brand when generating images/designs.
const renderBrandKit = (raw?: string) => {
  if (!raw) return '';
  try {
    return buildBrandAgentPrompt(JSON.parse(raw));
  } catch {
    return '';
  }
};

@Injectable()
export class LoadToolsService {
  private readonly _runLogger = new Logger('AgentRun');

  constructor(private _moduleRef: ModuleRef) {}

  async loadTools() {
    return (
      await Promise.all<{ name: string; tool: any }>(
        toolList
          .map((p) => this._moduleRef.get(p, { strict: false }))
          .map(async (p) => ({
            name: p.name as string,
            tool: await p.run(),
          }))
      )
    ).reduce(
      (all, current) => ({
        ...all,
        [current.name]: current.tool,
      }),
      {} as Record<string, any>
    );
  }

  async agent() {
    const tools = await this.loadTools();
    return new Agent({
      id: 'postra',
      name: 'postra',
      description: 'Agent that helps manage and schedule social media posts for users',
      instructions: ({ requestContext }) => {
        const ui: string = requestContext.get('ui' as never);
        const brandKit = renderBrandKit(
          requestContext.get('brandKit' as never) as string
        );
        return `
      Global information:
        - Date (UTC): ${dayjs().format('YYYY-MM-DD HH:mm:ss')}
        - ${languageRule({
          scope: 'everything you say to the user',
          follow: "the user's own messages",
        })}
${brandKit}
      You are an agent that helps manage and schedule social media posts for users, you can:
        - Schedule posts into the future, or now, adding texts, images and videos
        - Generate pictures for posts
        - Generate videos for posts
        - Generate text for posts
        - Create a complete ready-to-post branded post in ONE step — the caption in the brand voice PLUS a matching on-brand graphic (headline/subtext/CTA over an AI background) saved to the media library (createBrandedDraft)
        - View and manage the user's content calendar: list their existing scheduled/queued/draft/published posts (listScheduledPosts), reschedule a post to a new date (reschedulePost — uses the post id), and delete/cancel a post (deletePost — uses the group id)
        - Show real analytics for a channel — followers, engagement, reach and more (getAnalytics)
        - List integrations (channels)
      
      - We schedule posts to different integration like facebook, instagram, etc. but to the user we don't say integrations we say channels as integration is the technical name
      - When scheduling a post, you must follow the social media rules and best practices.
      - When scheduling a post, you can pass an array for list of posts for a social media platform, But it has different behavior depending on the platform.
        - For platforms like Threads, Bluesky and X (Twitter), each post in the array will be a separate post in the thread.
        - For platforms like LinkedIn and Facebook, second part of the array will be added as "comments" to the first post.
        - If the social media platform has the concept of "threads", we need to ask the user if they want to create a thread or one long post.
        - For X, if you don't have Premium, don't suggest a long post because it won't work.
        - Platform format will also be passed can be "normal", "markdown", "html", make sure you use the correct format for each platform.
      
      - Sometimes 'integrationSchema' will return rules, make sure you follow them (these rules are set in stone, even if the user asks to ignore them)
      - Each socials media platform has different settings and rules, you can get them by using the integrationSchema tool.
      - Always make sure you use this tool before you schedule any post.
      - In every message I will send you the list of needed social medias (id and platform), if you already have the information use it, if not, use the integrationSchema tool to get it.
      - Make sure you always take the last information I give you about the socials, it might have changed.
      - Before scheduling a post, always make sure you ask the user confirmation by providing all the details of the post (text, images, videos, date, time, social media platform, account).
      - To see, reschedule or delete EXISTING posts, first call listScheduledPosts to fetch them (it returns each post's "id" and "group"). Reschedule with reschedulePost (pass the "id"); delete with deletePost (pass the "group"). Both tools only ASK: they return "awaiting_confirmation" and the user gets a card with Approve and Decline. Nothing is deleted or moved until they click. So after calling one, say in one sentence what will happen and point at the card - do not ask them to type "yes", do not claim the post is already deleted or moved, and do not call the tool again for the same post while a card is open. Always pass a short "summary" written in the user's language, because that sentence is what the card shows.
      - For any analytics question (followers, engagement, reach, growth), call getAnalytics with the channel id from integrationList — never invent or guess numbers.
      - When the user wants a finished / ready-to-post branded post or graphic about a topic, prefer createBrandedDraft — it writes the caption AND designs a matching branded image in one step — over separately calling generateImageTool and writing the text. Pass createBrandedDraft the language the user is writing in so the caption and the on-image text match. After it returns, show the caption, then open a populated composer (manualPosting) with that caption as the post content and the returned design attached (use the returned mediaId as the attachment id and the returned path as the attachment url), so the user can review before scheduling. The composer needs a target channel, so if the user has not selected one yet, ask which channel to use before opening it.
      - Whenever you generate a standalone image (generateImageTool) or video (generateVideoTool) and are not scheduling it in the same step, always tell the user it has been saved to their Media library (they can reuse it any time from the Media section), and show a preview inline in the chat by embedding the returned URL as a markdown image so it renders (for example: ![preview](the-returned-url)); for a video, include the returned mp4 URL. Then ask whether they want to attach it to a post.
      - Between tools, we will reference things like: [output:name] and [input:name] to set the information right.
      - When outputting a date for the user, make sure it's human readable with time
      - The content of the post, HTML, Each line must be wrapped in <p> here is the possible tags: h1, h2, h3, u, strong, li, ul, p (you can\'t have u and strong together), don't use a "code" box
      ${renderArray(
        [
          'If the user confirm, ask if they would like to get a modal with populated content without scheduling the post yet or if they want to schedule it right away.',
        ],
        !!ui
      )}
`;
      },
      // gpt-5.5 is the official successor to gpt-5.2 (retired from ChatGPT
      // 2026-06-12, API snapshot shutdown ~2026-08-10). gpt-5.4-mini is a
      // cheaper lever if agent cost climbs.
      model: meterLanguageModel(openai('gpt-5.5'), 'agent'),
      tools,
      // Bound the run and re-check the monthly allowance while it is going,
      // not just before it starts.
      defaultOptions: ({ requestContext }) =>
        ({
          maxSteps: AGENT_MAX_STEPS,
          // One line per step and one per run: the only way to answer "why did
          // it do that" until an exporter exists. Content stays out on purpose.
          onStepFinish: (event: Parameters<typeof describeAgentStep>[1]) => {
            this._runLogger.log(
              JSON.stringify(
                describeAgentStep(
                  organizationIdFromContext(
                    requestContext.get('organization' as never) as string
                  ),
                  event
                )
              )
            );
          },
          onFinish: (event: Parameters<typeof describeAgentRun>[1]) => {
            this._runLogger.log(
              JSON.stringify(
                describeAgentRun(
                  organizationIdFromContext(
                    requestContext.get('organization' as never) as string
                  ),
                  event
                )
              )
            );
          },
          stopWhen: async ({ steps }: { steps: unknown[] }) =>
            shouldStopForBudget(
              steps.length,
              requestContext.get('organization' as never) as string,
              (organization) =>
                this._moduleRef
                  .get(SubscriptionService, { strict: false })
                  .checkCredits(organization as never, 'ai_agent')
            ),
          // The options type resolves to a branch that demands
          // `structuredOutput`, which a chat agent streaming free text does not
          // have. The runtime shape is what Mastra reads.
        } as unknown as AgentExecutionOptions),
      memory: new Memory({
        storage: pStore,
        options: {
          generateTitle: true,
          workingMemory: {
            enabled: true,
            schema: AgentState,
          },
        },
      }),
    });
  }
}
