'use client';

import React, {
  FC,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { CopilotChat, CopilotKitCSSProperties } from '@copilotkit/react-ui';
import DOMPurify from 'dompurify';
import {
  InputProps,
  UserMessageProps,
} from '@copilotkit/react-ui/dist/components/chat/props';
import { Input } from '@gitroom/frontend/components/agents/agent.input';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  CopilotKit,
  useCopilotAction,
  useCopilotMessagesContext,
} from '@copilotkit/react-core';
import {
  MediaPortal,
  PropertiesContext,
} from '@gitroom/frontend/components/agents/agent';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useParams } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { TextMessage } from '@copilotkit/runtime-client-gql';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { ExistingDataContextProvider } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import useSWR from 'swr';

export const AgentChat: FC = () => {
  const { backendUrl } = useVariables();
  const params = useParams<{ id: string }>();
  const { properties } = useContext(PropertiesContext);
  const t = useT();
  const fetch = useFetch();

  // Same budget the backend enforces with a 402 (pricing.agent_tokens) —
  // checked up-front so the user gets a clear banner instead of a failed send.
  const { data: agentCredits } = useSWR('/copilot/credits?type=ai_agent', async (url: string) =>
    (await fetch(url)).json()
  );
  if (agentCredits && agentCredits.credits <= 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-[24px]">
        <div className="max-w-[440px] text-center flex flex-col gap-[10px]">
          <div className="text-[17px] font-[650] text-newTextColor">
            {t('agent_limit_title', 'Monthly AI assistant limit reached')}
          </div>
          <div className="text-[13.5px] text-newTextColor/70">
            {t(
              'agent_limit_description',
              'You have used this month\'s AI assistant allowance. It resets with your next billing month — or upgrade your plan for a higher limit.'
            )}
          </div>
          <a
            href="/billing"
            className="text-[13.5px] underline underline-offset-4 text-[#38bdf8]"
          >
            {t('agent_limit_upgrade', 'See plans')}
          </a>
        </div>
      </div>
    );
  }

  return (
    <CopilotKit
      {...(params.id === 'new' ? {} : { threadId: params.id })}
      credentials="include"
      runtimeUrl={backendUrl + '/copilot/agent'}
      showDevConsole={false}
      agent="postra"
      properties={{
        integrations: properties,
      }}
    >
      <Hooks />
      <LoadMessages id={params.id} />
      <div
        style={
          {
            '--copilot-kit-primary-color': '#38bdf8',
            '--copilot-kit-background-color': 'rgba(15,23,42,0.72)',
          } as CopilotKitCSSProperties
        }
        className="agent-chat-shell trz agent flex flex-col gap-[15px] transition-all flex-1 items-center relative bg-[linear-gradient(180deg,rgba(10,14,26,0.94),rgba(8,14,28,0.98))]"
      >
        <div className="absolute left-0 w-full h-full px-[14px] pt-[14px] pb-[24px]">
          <style>{`
            @media (max-width: 767px) {
              .agent-chat-shell .copilotKitMessages,
              .agent-chat-shell .copilotKitMessagesContainer {
                width: 100% !important;
                max-width: 100% !important;
                align-self: stretch !important;
              }
              .agent-chat-shell .copilotKitMessages,
              .agent-chat-shell .copilotKitMessagesContainer {
                padding-left: 10px !important;
                padding-right: 10px !important;
              }
              .agent-chat-shell .copilotKitMessage.copilotKitUserMessage,
              .agent-chat-shell .copilotKitMessage.copilotKitAssistantMessage {
                max-width: 100% !important;
                width: 100% !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
                min-width: 0 !important;
              }
            }
          `}</style>
          <CopilotChat
            className="w-full h-full"
            labels={{
              title: t('your_assistant', 'Your Assistant'),
              initial: t(
                'agent_welcome_message',
                `Hi! I'm your Postra agent 🙌🏻 Tell me what you want to publish — I'll schedule posts across multiple channels and generate images and videos.`
              ),
            }}
            UserMessage={Message}
            Input={NewInput}
          />
        </div>
      </div>
    </CopilotKit>
  );
};

const LoadMessages: FC<{ id: string }> = ({ id }) => {
  const { setMessages } = useCopilotMessagesContext();
  const fetch = useFetch();

  const loadMessages = useCallback(async (idToSet: string) => {
    const data = await (await fetch(`/copilot/${idToSet}/list`)).json();
    setMessages(
      data.messages.map((p: any) => {
        return new TextMessage({
          content: p.content.content,
          role: p.role,
        });
      })
    );
  }, []);

  useEffect(() => {
    if (id === 'new') {
      setMessages([]);
      return;
    }
    loadMessages(id);
  }, [id]);

  return null;
};

const Message: FC<UserMessageProps> = (props) => {
  const convertContentToImagesAndVideo = useMemo(() => {
    // Sanitized at the end — message content echoes user input, and the
    // regex templating alone is not an XSS boundary.
    const html = (props.message?.content || '')
      .replace(/Video: (http.*mp4\n)/g, (match, p1) => {
        return `<video controls class="h-[150px] w-[150px] rounded-[8px] mb-[10px]"><source src="${p1.trim()}" type="video/mp4">Your browser does not support the video tag.</video>`;
      })
      .replace(/Image: (http.*\n)/g, (match, p1) => {
        return `<img src="${p1.trim()}" class="h-[150px] w-[150px] max-w-full border border-newBgColorInner" />`;
      })
      .replace(/\[\-\-Media\-\-\](.*)\[\-\-Media\-\-\]/g, (match, p1) => {
        return `<div class="flex justify-center mt-[20px]">${p1}</div>`;
      })
      .replace(
        /(\[--integrations--\][\s\S]*?\[--integrations--\])/g,
        (match, p1) => {
          return ``;
        }
      );
    return DOMPurify.sanitize(html, { ADD_ATTR: ['controls'] });
  }, [props.message?.content]);
  return (
    <div
      className="copilotKitMessage copilotKitUserMessage min-w-[300px]"
      dangerouslySetInnerHTML={{ __html: convertContentToImagesAndVideo }}
    />
  );
};
const NewInput: FC<InputProps> = (props) => {
  const [media, setMedia] = useState([] as { path: string; id: string }[]);
  const [value, setValue] = useState('');
  const { properties } = useContext(PropertiesContext);
  const t = useT();
  return (
    <>
      <MediaPortal
        value={value}
        media={media}
        setMedia={(e) => setMedia(e.target.value)}
      />
      <Input
        {...props}
        placeholder={t(
          'write_your_post_placeholder',
          'Write your message...'
        )}
        onChange={setValue}
        onSend={(text) => {
          const send = props.onSend(
            text +
              (media.length > 0
                ? '\n[--Media--]' +
                  media
                    .map((m) =>
                      hasExtension(m.path, 'mp4')
                        ? `Video: ${m.path}`
                        : `Image: ${m.path}`
                    )
                    .join('\n') +
                  '\n[--Media--]'
                : '') +
              `
${
  properties.length
    ? `[--integrations--]
Use the following social media platforms: ${JSON.stringify(
        properties.map((p) => ({
          id: p.id,
          platform: p.identifier,
          profilePicture: p.picture,
          additionalSettings: p.additionalSettings,
        }))
      )}
[--integrations--]`
    : ``
}`
          );
          setValue('');
          setMedia([]);
          return send;
        }}
      />
    </>
  );
};

/**
 * Delete and reschedule do not happen when the agent says so: the tool parks
 * the action on the server and returns a token, and this card is the only way
 * to spend it. Render-only (`available: 'disabled'`) so the model cannot call
 * it and cannot answer on the user's behalf.
 */
const ConfirmActionCard: FC<{
  result: {
    status?: string;
    token?: string;
    summary?: string;
    expiresInMinutes?: number;
  } | null;
  destructive: boolean;
}> = ({ result, destructive }) => {
  const t = useT();
  const fetch = useFetch();
  const [state, setState] = useState<
    'idle' | 'working' | 'approved' | 'declined' | 'error'
  >('idle');

  const act = useCallback(
    async (decision: 'approve' | 'decline') => {
      if (!result?.token) return;
      setState('working');
      try {
        const response = await fetch(
          `/copilot/pending/${result.token}/${decision}`,
          { method: 'POST' }
        );
        if (!response.ok) throw new Error(String(response.status));
        setState(decision === 'approve' ? 'approved' : 'declined');
      } catch {
        setState('error');
      }
    },
    [fetch, result?.token]
  );

  if (result?.status !== 'awaiting_confirmation' || !result?.token) return null;

  return (
    <div className="my-[10px] p-[14px] rounded-[8px] border border-newBorder bg-newColColor flex flex-col gap-[10px]">
      <div className="text-[13.5px] text-newTextColor">{result.summary}</div>

      {state === 'idle' || state === 'working' ? (
        <>
          <div className="flex gap-[8px]">
            <button
              type="button"
              disabled={state === 'working'}
              onClick={() => act('approve')}
              className={
                'h-[32px] px-[14px] rounded-[6px] text-[13px] font-[600] disabled:opacity-50 ' +
                (destructive
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'bg-[#38bdf8] text-[#06222e] hover:bg-[#7dd3fc]')
              }
            >
              {t('agent_confirm_approve', 'Approve')}
            </button>
            <button
              type="button"
              disabled={state === 'working'}
              onClick={() => act('decline')}
              className="h-[32px] px-[14px] rounded-[6px] text-[13px] text-newTextColor hover:bg-white/[0.08] disabled:opacity-50"
            >
              {t('agent_confirm_decline', 'Decline')}
            </button>
          </div>
          <div className="text-[11px] text-newTextColor/60">
            {t(
              'agent_confirm_hint',
              'Nothing happens until you approve it here.'
            )}
          </div>
        </>
      ) : null}

      {state === 'approved' && (
        <div className="text-[12.5px] text-[#38bdf8]">
          {t('agent_confirm_done', 'Done.')}
        </div>
      )}
      {state === 'declined' && (
        <div className="text-[12.5px] text-newTextColor/70">
          {t('agent_confirm_declined', 'Declined — nothing was changed.')}
        </div>
      )}
      {state === 'error' && (
        <div className="text-[12.5px] text-red-400">
          {t(
            'agent_confirm_expired',
            'That confirmation is no longer valid. Ask the assistant again.'
          )}
        </div>
      )}
    </div>
  );
};

export const Hooks: FC = () => {
  const modals = useModals();

  useCopilotAction({
    name: 'deletePost',
    available: 'disabled',
    render: ({ status, result }) =>
      status === 'complete' ? (
        <ConfirmActionCard result={result} destructive={true} />
      ) : (
        <></>
      ),
  });

  useCopilotAction({
    name: 'reschedulePost',
    available: 'disabled',
    render: ({ status, result }) =>
      status === 'complete' ? (
        <ConfirmActionCard result={result} destructive={false} />
      ) : (
        <></>
      ),
  });

  useCopilotAction({
    name: 'manualPosting',
    description:
      'This tool should be triggered when the user wants to manually add the generated post',
    parameters: [
      {
        name: 'list',
        type: 'object[]',
        description:
          'list of posts to schedule to different social media (integration ids)',
        attributes: [
          {
            name: 'integrationId',
            type: 'string',
            description: 'The integration id',
          },
          {
            name: 'date',
            type: 'string',
            description: 'UTC date of the scheduled post',
          },
          {
            name: 'settings',
            type: 'object',
            description: 'Settings for the integration [input:settings]',
          },
          {
            name: 'posts',
            type: 'object[]',
            description: 'list of posts / comments (one under another)',
            attributes: [
              {
                name: 'content',
                type: 'string',
                description: 'the content of the post',
              },
              {
                name: 'attachments',
                type: 'object[]',
                description: 'list of attachments',
                attributes: [
                  {
                    name: 'id',
                    type: 'string',
                    description: 'id of the attachment',
                  },
                  {
                    name: 'path',
                    type: 'string',
                    description: 'url of the attachment',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    renderAndWaitForResponse: ({ args, status, respond }) => {
      if (status === 'executing') {
        return <OpenModal args={args} respond={respond} />;
      }

      return null;
    },
  });
  return null;
};

const OpenModal: FC<{
  respond: (value: any) => void;
  args: {
    list: {
      integrationId: string;
      date: string;
      settings?: Record<string, any>;
      posts: { content: string; attachments: { id: string; path: string }[] }[];
    }[];
  };
}> = ({ args, respond }) => {
  const modals = useModals();
  const { properties } = useContext(PropertiesContext);
  const startModal = useCallback(async () => {
    for (const integration of args.list) {
      await new Promise((res) => {
        const group = makeId(10);
        modals.openModal({
          id: 'add-edit-modal',
          closeOnClickOutside: false,
          removeLayout: true,
          closeOnEscape: false,
          withCloseButton: false,
          askClose: true,
          size: '80%',
          title: ``,
          classNames: {
            modal: 'w-[100%] max-w-[1400px] text-textColor',
          },
          children: (
            <ExistingDataContextProvider
              value={{
                group,
                integration: integration.integrationId,
                integrationPicture:
                  properties.find((p) => p.id === integration.integrationId)
                    .picture || '',
                settings: integration.settings || {},
                posts: integration.posts.map((p) => ({
                  approvedSubmitForOrder: 'NO',
                  content: p.content,
                  createdAt: new Date().toISOString(),
                  state: 'DRAFT',
                  id: makeId(10),
                  settings: JSON.stringify(integration.settings || {}),
                  group,
                  integrationId: integration.integrationId,
                  integration: properties.find(
                    (p) => p.id === integration.integrationId
                  ),
                  publishDate: dayjs.utc(integration.date).toISOString(),
                  image: p.attachments.map((a) => ({
                    id: a.id,
                    path: a.path,
                  })),
                })),
              }}
            >
              <AddEditModal
                date={dayjs.utc(integration.date)}
                allIntegrations={properties}
                integrations={properties.filter(
                  (p) => p.id === integration.integrationId
                )}
                onlyValues={integration.posts.map((p) => ({
                  content: p.content,
                  id: makeId(10),
                  settings: integration.settings || {},
                  image: p.attachments.map((a) => ({
                    id: a.id,
                    path: a.path,
                  })),
                }))}
                reopenModal={() => {}}
                mutate={() => res(true)}
              />
            </ExistingDataContextProvider>
          ),
        });
      });
    }

    respond('User scheduled all the posts');
  }, [args, respond, properties]);

  useEffect(() => {
    startModal();
  }, []);
  return (
    <div onClick={() => respond('continue')}>
      Opening manually ${JSON.stringify(args)}
    </div>
  );
};
