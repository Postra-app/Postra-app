'use client';

import { useState, useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { useUser } from '../layout/user.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { CopyButton } from '@gitroom/frontend/components/ui/copy-button';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useDecisionModal } from '@gitroom/frontend/components/layout/new-modal';
import { DeveloperComponent } from '@gitroom/frontend/components/developer/developer.component';
import clsx from 'clsx';

const mcpClients = [
  'Claude Code',
  'Cursor',
  'VS Code / Copilot',
  'Windsurf',
  'Amp',
  'Codex',
  'Gemini CLI',
  'Warp',
] as const;

type McpClient = (typeof mcpClients)[number];

const getMcpConfig = (
  client: McpClient,
  method: 'header' | 'path',
  mcpBase: string,
  apiKey: string
): { config: string; hint: string } => {
  const urlWithKey = `${mcpBase}/mcp/${apiKey}`;
  const urlBase = `${mcpBase}/mcp`;
  const bearer = `Bearer ${apiKey}`;

  const json = (obj: object) => JSON.stringify(obj, null, 2);

  if (method === 'path') {
    switch (client) {
      case 'Claude Code':
        return {
          config: `claude mcp add postra --transport http "${urlWithKey}"`,
          hint: 'Run this command in your terminal.',
        };
      case 'Cursor':
        return {
          config: json({ mcpServers: { postra: { url: urlWithKey } } }),
          hint: 'Add to .cursor/mcp.json in your project root.',
        };
      case 'VS Code / Copilot':
        return {
          config: json({
            servers: { postra: { type: 'http', url: urlWithKey } },
          }),
          hint: 'Add to .vscode/mcp.json in your project root.',
        };
      case 'Windsurf':
        return {
          config: json({
            mcpServers: { postra: { serverUrl: urlWithKey } },
          }),
          hint: 'Add to ~/.codeium/windsurf/mcp_config.json',
        };
      case 'Amp':
        return {
          config: `amp mcp add postra ${urlWithKey}`,
          hint: 'Run this command in your terminal.',
        };
      case 'Codex':
        return {
          config: `# ~/.codex/config.toml\n\n[mcp_servers.postra]\nurl = "${urlWithKey}"`,
          hint: 'Add to ~/.codex/config.toml',
        };
      case 'Gemini CLI':
        return {
          config: json({ mcpServers: { postra: { url: urlWithKey } } }),
          hint: 'Add to ~/.gemini/settings.json',
        };
      case 'Warp':
        return {
          config: json({ postra: { url: urlWithKey } }),
          hint: 'Settings > MCP Servers > + Add, then paste this config.',
        };
    }
  }

  switch (client) {
    case 'Claude Code':
      return {
        config: `claude mcp add postra \\\n  --transport http \\\n  --header "Authorization: ${bearer}" \\\n  "${urlBase}"`,
        hint: 'Run this command in your terminal.',
      };
    case 'Cursor':
      return {
        config: json({
          mcpServers: {
            postra: { url: urlBase, headers: { Authorization: bearer } },
          },
        }),
        hint: 'Add to .cursor/mcp.json in your project root.',
      };
    case 'VS Code / Copilot':
      return {
        config: json({
          servers: {
            postra: {
              type: 'http',
              url: urlBase,
              headers: { Authorization: bearer },
            },
          },
        }),
        hint: 'Add to .vscode/mcp.json in your project root.',
      };
    case 'Windsurf':
      return {
        config: json({
          mcpServers: {
            postra: {
              serverUrl: urlBase,
              headers: { Authorization: bearer },
            },
          },
        }),
        hint: 'Add to ~/.codeium/windsurf/mcp_config.json',
      };
    case 'Amp':
      return {
        config: json({
          'amp.mcpServers': {
            postra: { url: urlBase, headers: { Authorization: bearer } },
          },
        }),
        hint: 'Add to your Amp settings.json',
      };
    case 'Codex':
      return {
        config: `# ~/.codex/config.toml\n\n[mcp_servers.postra]\nurl = "${urlBase}"\nhttp_headers = { "Authorization" = "${bearer}" }`,
        hint: 'Add to ~/.codex/config.toml',
      };
    case 'Gemini CLI':
      return {
        config: json({
          mcpServers: {
            postra: { url: urlBase, headers: { Authorization: bearer } },
          },
        }),
        hint: 'Add to ~/.gemini/settings.json',
      };
    case 'Warp':
      return {
        config: json({
          postra: { url: urlBase, headers: { Authorization: bearer } },
        }),
        hint: 'Settings > MCP Servers > + Add, then paste this config.',
      };
  }
};

const McpSection = ({
  user,
  mcpBase,
}: {
  user: { publicApi: string };
  mcpBase: string;
}) => {
  const t = useT();
  const [activeClient, setActiveClient] = useState<McpClient>('Claude Code');
  const [method, setMethod] = useState<'header' | 'path'>('header');
  const [revealed, setRevealed] = useState(false);

  const { config, hint } = getMcpConfig(
    activeClient,
    method,
    mcpBase,
    user.publicApi
  );

  const remoteUrl = `${mcpBase}/mcp/${user.publicApi}`;
  const cliUrl = `${mcpBase}/mcp`;

  const maskedConfig = revealed
    ? config
    : config.replace(new RegExp(user.publicApi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '*'.repeat(user.publicApi.length));

  const maskedRemoteUrl = revealed
    ? remoteUrl
    : remoteUrl.replace(user.publicApi, '*'.repeat(user.publicApi.length));

  return (
    <div className="bg-white/[0.03] backdrop-blur-[8px] rounded-[16px] border border-white/10 overflow-hidden">
      <div className="bg-white/[0.03] px-[20px] py-[14px] border-b border-white/10 flex items-start justify-between gap-[12px]">
        <div>
          <div className="text-[15px] font-[600]">
            {t('mcp_client_configuration', 'MCP Client Configuration')}
          </div>
          <div className="text-[13px] text-newTextColor/55 mt-[2px]">
            {t(
              'connect_your_mcp_client_to_postra_to_schedule_your_posts_faster',
              'Connect Postra MCP server to your client (Http streaming) to schedule your posts faster.'
            )}
          </div>
        </div>
      </div>
      <div className="p-[20px] flex flex-col gap-[16px]">
        <div className="flex flex-col gap-[6px]">
          <div className="text-[13px] font-[600] text-newTextColor/55">
            {t('auth_method', 'Authentication')}
          </div>
          <div className="flex gap-[6px]">
            {(['header', 'path'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={clsx(
                  'cursor-pointer px-[14px] h-[36px] text-[13px] font-[500] rounded-[8px] transition-colors',
                  method === m
                    ? 'bg-[rgba(56,189,248,0.16)] text-[#7dd3fc]'
                    : 'bg-btnSimple text-newTextColor/55 hover:bg-boxHover hover:text-textColor'
                )}
                onClick={() => setMethod(m)}
              >
                {m === 'header'
                  ? t('cli_claude_code_codex', 'CLI (Claude Code / Codex)')
                  : t('remote_servers', 'Remote servers (ChatGPT, Claude)')}
              </button>
            ))}
          </div>
        </div>
        {method === 'header' && (
          <div className="flex flex-col gap-[6px]">
            <div className="text-[13px] font-[600] text-newTextColor/55">
              {t('mcp_client', 'Client')}
            </div>
            <div className="flex flex-wrap gap-[6px]">
              {mcpClients.map((client) => (
                <button
                  key={client}
                  type="button"
                  className={clsx(
                    'cursor-pointer px-[14px] h-[36px] text-[13px] font-[500] rounded-[8px] transition-colors',
                    activeClient === client
                      ? 'bg-[rgba(56,189,248,0.16)] text-[#7dd3fc]'
                      : 'bg-btnSimple text-newTextColor/55 hover:bg-boxHover hover:text-textColor'
                  )}
                  onClick={() => setActiveClient(client)}
                >
                  {client}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-[8px]">
          <div className="text-[12px] text-newTextColor/55 font-[500]">
            {method === 'header'
              ? hint
              : t(
                  'remote_server_url_hint',
                  'Paste this URL into your remote MCP client (ChatGPT, Claude, etc.).'
                )}
          </div>
          <pre className="bg-white/[0.03] border border-white/10 rounded-[8px] p-[16px] text-[13px] whitespace-pre-wrap break-all overflow-x-auto leading-[1.6]">
            {method === 'header' ? maskedConfig : maskedRemoteUrl}
          </pre>
          <div className="flex gap-[8px]">
            <button
              type="button"
              onClick={() => setRevealed(!revealed)}
              className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {revealed ? (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
              {revealed ? t('hide', 'Hide') : t('reveal', 'Reveal')}
            </button>
            <CopyButton
              text={method === 'header' ? config : remoteUrl}
              label={t('copy', 'Copy')}
            />
            {method === 'header' && (
              <CopyButton
                text={cliUrl}
                label={t('copy_url', 'Copy URL')}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// The SDK is the published @postra/node package (apps/sdk). There is no
// Postra CLI or agent skill package yet, so nothing here may tell a customer
// to install one: an unclaimed npm name is somebody else's package tomorrow.
const SdkSection = ({ apiKey }: { apiKey: string }) => {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const install = 'npm install @postra/node';
  const usage = (key: string) =>
    `import Postra from '@postra/node';\n\nconst postra = new Postra('${key}');\nconst channels = await postra.integrations();`;

  return (
    <div className="bg-white/[0.03] backdrop-blur-[8px] rounded-[16px] border border-white/10 overflow-hidden">
      <div className="bg-white/[0.03] px-[20px] py-[14px] border-b border-white/10 flex items-start justify-between gap-[12px]">
        <div>
          <div className="text-[15px] font-[600]">
            {t('node_sdk', 'Node.js SDK')}
          </div>
          <div className="text-[13px] text-newTextColor/55 mt-[2px]">
            {t(
              'node_sdk_description',
              'Schedule posts, upload media and list your channels from your own code.'
            )}
          </div>
        </div>
        <div className="flex gap-[6px] shrink-0 pt-[2px]">
          <a
            className="cursor-pointer px-[16px] h-[36px] bg-[#38bdf8] hover:brightness-110 text-[#06222e] transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
            href="https://www.npmjs.com/package/@postra/node"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            {t('npm_package', 'npm package')}
          </a>
        </div>
      </div>
      <div className="p-[20px] flex flex-col gap-[16px]">
        <div className="flex flex-col gap-[6px]">
          <div className="text-[13px] font-[600] text-newTextColor/55">
            1. {t('install_the_sdk', 'Install')}
          </div>
          <pre className="bg-white/[0.03] border border-white/10 rounded-[8px] p-[16px] text-[13px] whitespace-pre-wrap break-all overflow-x-auto leading-[1.6]">
            {install}
          </pre>
        </div>
        <div className="flex flex-col gap-[6px]">
          <div className="text-[13px] font-[600] text-newTextColor/55">
            2. {t('use_your_api_key', 'Use your API key')}
          </div>
          <pre className="bg-white/[0.03] border border-white/10 rounded-[8px] p-[16px] text-[13px] whitespace-pre-wrap break-all overflow-x-auto leading-[1.6]">
            {usage(revealed ? apiKey : '*'.repeat(apiKey.length))}
          </pre>
        </div>
        <div className="flex gap-[8px]">
          <button
            type="button"
            onClick={() => setRevealed(!revealed)}
            className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
          >
            {revealed ? t('hide', 'Hide') : t('reveal', 'Reveal')}
          </button>
          <CopyButton
            text={`${install}\n\n${usage(apiKey)}`}
            label={t('copy_all', 'Copy All')}
          />
        </div>
      </div>
    </div>
  );
};

const PublicApiContent = () => {
  const user = useUser();
  const { backendUrl, frontEndUrl, mcpUrl } = useVariables();
  const toaster = useToaster();
  const fetch = useFetch();
  const decision = useDecisionModal();
  const { mutate } = useSWRConfig();
  const [reveal, setReveal] = useState(false);
  const t = useT();

  const rotateKey = useCallback(async () => {
    const approved = await decision.open({
      title: t('rotate_api_key', 'Rotate API Key?'),
      description: t(
        'rotate_api_key_description',
        'This will generate a new API key and invalidate the current one. Any integrations using the old key will stop working.'
      ),
      approveLabel: t('rotate', 'Rotate'),
      cancelLabel: t('cancel', 'Cancel'),
    });
    if (!approved) return;
    await fetch('/user/api-key/rotate', { method: 'POST' });
    await mutate('/user/self');
    setReveal(false);
    toaster.show(
      t('api_key_rotated', 'API Key rotated successfully'),
      'success'
    );
  }, [decision, fetch, mutate, toaster]);

  if (!user || !user.publicApi) {
    return null;
  }

  const mcpBase = mcpUrl || backendUrl;

  return (
    <div className="flex flex-col gap-[40px]">
      <div className="text-[14px] text-textColor leading-[1.7]">
        {t(
          'api_auth_note_line1',
          'Use your API Key to automate your own account.'
        )}
        <br />
        {t(
          'api_auth_note_line2',
          'If you are building a product that schedules posts on behalf of other Postra users,'
        )}
        <br />
        {t(
          'api_auth_note_line3',
          'create an OAuth App under the "Apps" tab. Your users will authorize your app via OAuth2,'
        )}
        <br />
        {t(
          'api_auth_note_line4',
          'and you will receive a pos_ prefixed token that works with the API, the SDK and MCP — just like an API Key.'
        )}
      </div>
      <div className="bg-white/[0.03] backdrop-blur-[8px] rounded-[16px] border border-white/10 overflow-hidden">
        <div className="bg-white/[0.03] px-[20px] py-[14px] border-b border-white/10 flex items-start justify-between gap-[12px]">
          <div>
            <div className="text-[15px] font-[600]">
              {t('api_key', 'API Key')}
            </div>
            <div className="text-[13px] text-newTextColor/55 mt-[2px]">
              {t(
                'use_postra_api_to_integrate_with_your_tools',
                'Use Postra API to integrate with your tools.'
              )}
            </div>
          </div>
        </div>
        <div className="p-[20px] flex flex-col gap-[16px]">
          <div className="bg-white/[0.03] border border-white/10 rounded-[8px] px-[16px] h-[44px] flex items-center overflow-hidden">
            <code className="text-[14px] flex-1 truncate">
              {reveal ? (
                user.publicApi
              ) : (
                <span className="flex items-center">
                  <span className="blur-sm select-none">
                    {user.publicApi.slice(0, -5)}
                  </span>
                  <span>{user.publicApi.slice(-5)}</span>
                </span>
              )}
            </code>
          </div>
          <div className="flex gap-[8px]">
            <button
              type="button"
              onClick={() => setReveal(!reveal)}
              className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {reveal ? (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
              {reveal ? t('hide', 'Hide') : t('reveal', 'Reveal')}
            </button>
            <CopyButton text={user.publicApi} label={t('copy', 'Copy')} />
            <button
              type="button"
              onClick={rotateKey}
              className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.5 2v6h-6" />
                <path d="M21.34 15.57a10 10 0 11-.57-8.38L21.5 8" />
              </svg>
              {t('rotate_key', 'Rotate Key')}
            </button>
            <button
              type="button"
              data-tooltip-id="tooltip"
              data-tooltip-content={t(
                'payload_wizard_description',
                'Building a POST request to /posts can be complex. Use the wizard to schedule a post with the UI, then copy the generated payload.'
              )}
              onClick={() =>
                window.open(`${frontEndUrl}/modal/dark/all`, '_blank')
              }
              className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              {t('open_wizard', 'Open Wizard')}
            </button>
          </div>
        </div>
      </div>

      <SdkSection apiKey={user.publicApi} />

      <McpSection user={user} mcpBase={mcpBase} />
    </div>
  );
};

export const PublicComponent = () => {
  const t = useT();
  const [subTab, setSubTab] = useState<'api' | 'developer'>('api');

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="flex gap-[6px]">
        {(['api', 'developer'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={clsx(
              'cursor-pointer px-[20px] h-[44px] text-[15px] font-[600] rounded-[8px] transition-colors',
              subTab === tab
                ? 'bg-[rgba(56,189,248,0.16)] text-[#7dd3fc]'
                : 'bg-btnSimple text-newTextColor/55 hover:bg-boxHover hover:text-textColor'
            )}
            onClick={() => setSubTab(tab)}
          >
            {tab === 'api'
              ? t('access', 'Access')
              : t('apps', 'Apps')}
          </button>
        ))}
      </div>
      {subTab === 'api' && <PublicApiContent />}
      {subTab === 'developer' && <DeveloperComponent />}
    </div>
  );
};
