'use client';

import { FC, ReactNode, useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  APP_TABS,
  CHANNEL_GUIDES,
  ChannelConnectType,
  FAQ_ITEMS,
  SETTINGS_SECTIONS,
  STUDIO_GRAPHICS_TOOLS,
  STUDIO_VIDEO_TOOLS,
} from '@gitroom/frontend/components/help/help.data';

const CONNECT_LABELS: Record<ChannelConnectType, string> = {
  oauth: 'One-click connect',
  credentials: 'Connects with login details',
  bot: 'Connects through a bot',
};

const ComingSoon = () => (
  <div className="text-[13px] italic text-newTextColor/40">
    Content coming soon.
  </div>
);

const Section: FC<{ id: string; title: string; children: ReactNode }> = ({
  id,
  title,
  children,
}) => (
  <div id={id} className="flex flex-col gap-[16px]">
    <h2 className="text-[20px] font-[600]">{title}</h2>
    {children}
  </div>
);

export const HelpComponent = () => {
  const t = useT();
  const [filter, setFilter] = useState('');

  const toc = [
    { id: 'getting-started', label: t('help_getting_started', 'Getting started') },
    { id: 'channels', label: t('help_connecting_channels', 'Connecting channels') },
    { id: 'tabs', label: t('help_app_tabs', 'App tabs') },
    { id: 'studio', label: t('help_studio_graphics', 'Studio — Graphics') },
    { id: 'studio-video', label: t('help_studio_video', 'Studio — Video') },
    { id: 'settings', label: t('help_settings_explained', 'Settings explained') },
    { id: 'faq', label: t('help_faq', 'FAQ') },
    { id: 'contact', label: t('help_contact', 'Contact') },
  ];

  // Filtering the contents list, not the page body: the sections are static
  // JSX and the browser's own find already searches those. What the list could
  // not do is answer "is there anything here about captions / Pinterest" for
  // someone who does not know which section owns the topic.
  const query = filter.trim().toLowerCase();
  const matchingChannels = useMemo(
    () =>
      query
        ? CHANNEL_GUIDES.filter((c) => c.name.toLowerCase().includes(query))
        : CHANNEL_GUIDES,
    [query]
  );
  const visibleToc = useMemo(
    () =>
      query
        ? toc.filter(
            (item) =>
              item.label.toLowerCase().includes(query) ||
              (item.id === 'channels' && matchingChannels.length > 0)
          )
        : toc,
    [query, toc, matchingChannels]
  );

  return (
    <>
      <div className="bg-white/[0.03] p-[20px] flex flex-col gap-[12px] w-[260px] phone:w-full">
        <h2 className="text-[20px] font-[500]">{t('help', 'Help')}</h2>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('help_filter_ph', 'Filter topics…')}
          className="h-[36px] px-[10px] rounded-[8px] bg-white/[0.03] border border-newColColor text-[13px] outline-none focus:border-[#38bdf8]"
        />
        <div className="flex flex-col gap-[4px]">
          {visibleToc.length === 0 && (
            <div className="text-[13px] text-newTextColor/50 px-[8px] py-[6px]">
              {t('help_filter_none', 'Nothing matches — scroll the page or ask us.')}
            </div>
          )}
          {visibleToc.map((item) => (
            <div key={item.id} className="flex flex-col">
              <a
                href={`#${item.id}`}
                className="py-[6px] px-[8px] rounded-[8px] text-[14px] hover:bg-white/[0.05] transition-colors"
              >
                {item.label}
              </a>
              {item.id === 'channels' && (
                <div className="flex flex-col ps-[16px]">
                  {matchingChannels.map((channel) => (
                    <a
                      key={channel.identifier}
                      href={`#channel-${channel.identifier}`}
                      className="flex items-center gap-[8px] py-[4px] px-[8px] rounded-[8px] text-[13px] text-newTextColor/70 hover:bg-white/[0.05] hover:text-newTextColor transition-colors"
                    >
                      <img
                        src={`/icons/platforms/${channel.identifier}.png`}
                        alt={channel.name}
                        className="w-[16px] h-[16px] rounded-[4px]"
                      />
                      {channel.name}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="bg-white/[0.03] flex-1 flex flex-col p-[20px] gap-[40px]">
        <Section
          id="getting-started"
          title={t('help_getting_started', 'Getting started')}
        >
          <ol className="flex flex-col gap-[8px] text-[14px] list-decimal ps-[20px]">
            <li>Add a channel from the Calendar page ("Add Channel").</li>
            <li>Create a post yourself, or let the Agent draft one for you.</li>
            <li>Schedule it — it appears on the calendar and publishes automatically.</li>
          </ol>
        </Section>

        <Section
          id="channels"
          title={t('help_connecting_channels', 'Connecting channels')}
        >
          <div className="flex flex-col gap-[12px]">
            {CHANNEL_GUIDES.map((channel) => (
              <div
                key={channel.identifier}
                id={`channel-${channel.identifier}`}
                className="flex flex-col gap-[12px] rounded-[12px] border border-white/10 bg-white/[0.02] p-[16px]"
              >
                <div className="flex items-center gap-[12px] phone:flex-wrap">
                  <img
                    src={`/icons/platforms/${channel.identifier}.png`}
                    alt={channel.name}
                    className="w-[32px] h-[32px] rounded-[8px]"
                  />
                  <div className="flex-1 text-[16px] font-[600]">
                    {channel.name}
                  </div>
                  <div className="text-[11px] px-[10px] py-[3px] rounded-full border border-sky-300/25 text-sky-300 whitespace-nowrap">
                    {CONNECT_LABELS[channel.connectType]}
                  </div>
                </div>
                {channel.steps.length ? (
                  <ol className="flex flex-col gap-[6px] text-[14px] list-decimal ps-[20px]">
                    {channel.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                ) : (
                  <ComingSoon />
                )}
                {!!channel.gotchas.length && (
                  <ul className="flex flex-col gap-[6px] text-[13px] text-newTextColor/70 list-disc ps-[20px]">
                    {channel.gotchas.map((gotcha) => (
                      <li key={gotcha}>{gotcha}</li>
                    ))}
                  </ul>
                )}
                {!!channel.composer?.length && (
                  <div className="flex flex-col gap-[6px]">
                    <div className="text-[13px] font-[600] text-newTextColor/80">
                      {t('help_in_the_composer', 'In the composer')}
                    </div>
                    <ul className="flex flex-col gap-[6px] text-[13px] text-newTextColor/70 list-disc ps-[20px]">
                      {channel.composer.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section id="tabs" title={t('help_app_tabs', 'App tabs')}>
          <div className="grid grid-cols-2 phone:grid-cols-1 gap-[12px]">
            {APP_TABS.map((tab) => (
              <div
                key={tab.id}
                id={`tab-${tab.id}`}
                className="flex flex-col gap-[8px] rounded-[12px] border border-white/10 bg-white/[0.02] p-[16px]"
              >
                <div className="text-[16px] font-[600]">{tab.name}</div>
                {tab.description ? (
                  <div className="text-[14px] text-newTextColor/70">
                    {tab.description}
                  </div>
                ) : (
                  <ComingSoon />
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="studio"
          title={t('help_studio_graphics', 'Studio — Graphics')}
        >
          <div className="text-[13px] text-newTextColor/70">
            {t(
              'help_studio_intro',
              'Studio designs branded graphics for your posts — AI does the first draft, you stay in control of every element. Tool by tool:'
            )}
          </div>
          <div className="flex flex-col gap-[12px]">
            {STUDIO_GRAPHICS_TOOLS.map((tool) => (
              <div
                key={tool.name}
                className="flex flex-col gap-[8px] rounded-[12px] border border-white/10 bg-white/[0.02] p-[16px]"
              >
                <div className="text-[16px] font-[600]">{tool.name}</div>
                <div className="text-[14px] text-newTextColor/70">
                  {tool.description}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="studio-video"
          title={t('help_studio_video', 'Studio — Video')}
        >
          <div className="text-[13px] text-newTextColor/70">
            {t(
              'help_studio_video_intro',
              'Short-form video editing that runs entirely in your browser — trim, reframe, caption and assemble clips without leaving Postra. Tool by tool:'
            )}
          </div>
          <div className="flex flex-col gap-[12px]">
            {STUDIO_VIDEO_TOOLS.map((tool) => (
              <div
                key={tool.name}
                className="flex flex-col gap-[8px] rounded-[12px] border border-white/10 bg-white/[0.02] p-[16px]"
              >
                <div className="text-[16px] font-[600]">{tool.name}</div>
                <div className="text-[14px] text-newTextColor/70">
                  {tool.description}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="settings"
          title={t('help_settings_explained', 'Settings explained')}
        >
          <div className="text-[13px] text-newTextColor/70">
            Which sections you see depends on your plan.
          </div>
          <div className="flex flex-col gap-[12px]">
            {SETTINGS_SECTIONS.map((section) => (
              <div
                key={section.name}
                className="flex flex-col gap-[8px] rounded-[12px] border border-white/10 bg-white/[0.02] p-[16px]"
              >
                <div className="flex items-center gap-[12px] phone:flex-wrap">
                  <div className="flex-1 text-[16px] font-[600]">
                    {section.name}
                  </div>
                  <div className="text-[11px] px-[10px] py-[3px] rounded-full border border-white/15 text-newTextColor/70 whitespace-nowrap">
                    {section.availability}
                  </div>
                </div>
                {section.description ? (
                  <div className="text-[14px] text-newTextColor/70">
                    {section.description}
                  </div>
                ) : (
                  <ComingSoon />
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section id="faq" title={t('help_faq', 'FAQ')}>
          <div className="flex flex-col gap-[12px]">
            {FAQ_ITEMS.map((item) => (
              <div
                key={item.question}
                className="flex flex-col gap-[8px] rounded-[12px] border border-white/10 bg-white/[0.02] p-[16px]"
              >
                <div className="text-[16px] font-[600]">{item.question}</div>
                {item.answer ? (
                  <div className="text-[14px] text-newTextColor/70">
                    {item.answer}
                  </div>
                ) : (
                  <ComingSoon />
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section id="contact" title={t('help_contact', 'Contact')}>
          <div className="flex flex-col gap-[8px] text-[14px]">
            <div>
              Can't find what you need? Email us at{' '}
              <a
                href="mailto:hello@postra.co.uk"
                className="text-sky-300 hover:underline"
              >
                hello@postra.co.uk
              </a>{' '}
              — we usually reply within one business day.
            </div>
            <div>
              Service status:{' '}
              <a
                href="https://status.postra.pl"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                status.postra.pl
              </a>
            </div>
          </div>
        </Section>
      </div>
    </>
  );
};
