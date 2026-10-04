'use client';

import React, {
  createContext,
  FC,
  useCallback,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import clsx from 'clsx';
import useCookie from 'react-use-cookie';
import useSWR from 'swr';
import { orderBy } from 'lodash';
import { SVGLine } from '@gitroom/frontend/components/launches/launches.component';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useWaitForClass } from '@gitroom/helpers/utils/use.wait.for.class';
import { MultiMediaComponent } from '@gitroom/frontend/components/media/media.component';
import { Integration } from '@prisma/client';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const MediaPortal: FC<{
  media: { path: string; id: string }[];
  value: string;
  setMedia: (event: {
    target: {
      name: string;
      value?: {
        id: string;
        path: string;
        alt?: string;
        thumbnail?: string;
        thumbnailTimestamp?: number;
      }[];
    };
  }) => void;
}> = ({ media, setMedia, value }) => {
  const waitForClass = useWaitForClass('copilotKitMessages');
  const t = useT();
  if (!waitForClass) return null;
  return (
    <div className="pl-[14px] pr-[24px] whitespace-nowrap editor rm-bg">
      <MultiMediaComponent
        allData={[{ content: value }]}
        text={value}
        label={t('attachments', 'Attachments')}
        description=""
        value={media}
        dummy={false}
        name="image"
        onChange={setMedia}
        onOpen={() => {}}
        onClose={() => {}}
      />
    </div>
  );
};

export const AgentList: FC<{ onChange: (arr: any[]) => void }> = ({
  onChange,
}) => {
  const t = useT();
  const [selected, setSelected] = useState([]);

  const [collapseMenu, setCollapseMenu] = useCookie('collapseMenu', '0');

  // Shared hook (same SWR key as the calendar). The previous bespoke
  // useSWR('integrations', ...) shared its key with autopost/webhooks whose
  // fetchers cache the RAW {integrations} response — after an SPA navigation
  // the colliding cache shape left this panel permanently empty.
  const { data } = useIntegrationList();

  const setIntegration = useCallback(
    (integration: Integration) => () => {
      if (selected.some((p) => p.id === integration.id)) {
        onChange(selected.filter((p) => p.id !== integration.id));
        setSelected(selected.filter((p) => p.id !== integration.id));
      } else {
        onChange([...selected, integration]);
        setSelected([...selected, integration]);
      }
    },
    [selected]
  );

  const sortedIntegrations = useMemo(() => {
    return orderBy(
      data || [],
      ['type', 'disabled', 'identifier'],
      ['desc', 'asc', 'asc']
    );
  }, [data]);

  return (
    <div
      className={clsx(
        'agent-side-panel trz flex flex-col gap-[15px] transition-all relative border-e border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.88),rgba(8,14,28,0.96))] backdrop-blur-xl phone:hidden',
        collapseMenu === '1' ? 'group sidebar w-[100px]' : 'w-[280px]'
      )}
    >
      <div tabIndex={0} className="absolute top-0 start-0 w-full h-full phone:static phone:h-auto phone:max-h-[40vh] p-[20px] overflow-auto scrollbar scrollbar-thumb-fifth scrollbar-track-transparent">
        <div className="flex items-center">
          <h2 className="group-[.sidebar]:hidden flex-1 text-[20px] font-[500] mb-[15px]">
            {t('select_channels', 'Select Channels')}
          </h2>
          <div
            onClick={() => setCollapseMenu(collapseMenu === '1' ? '0' : '1')}
            className="-mt-3 group-[.sidebar]:rotate-[180deg] group-[.sidebar]:mx-auto text-btnText bg-btnSimple rounded-[6px] w-[24px] h-[24px] flex items-center justify-center cursor-pointer select-none"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="7"
              height="13"
              viewBox="0 0 7 13"
              fill="none"
            >
              <path
                d="M6 11.5L1 6.5L6 1.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
        <div className={clsx('flex flex-col gap-[15px]')}>
          {sortedIntegrations.map((integration, index) => (
            <div
              onClick={setIntegration(integration)}
              key={`${integration.id ?? 'agent'}-${index}`}
              className={clsx(
                'flex gap-[12px] items-center group/profile justify-center rounded-[12px] px-[10px] py-[8px] cursor-pointer transition-all duration-200',
                selected.some((p) => p.id === integration.id)
                  ? 'agent-side-item-selected bg-white/[0.05] border border-white/10 shadow-[0_8px_30px_rgba(2,6,23,0.25)]'
                  : 'agent-side-item opacity-35 border border-transparent hover:opacity-100 hover:bg-white/[0.04] hover:border-white/8'
              )}
            >
              <div
                className={clsx(
                  'relative rounded-full flex justify-center items-center gap-[6px]',
                  integration.disabled && 'opacity-50'
                )}
              >
                {(integration.inBetweenSteps || integration.refreshNeeded) && (
                  <div className="absolute start-0 top-0 w-[39px] h-[46px] cursor-pointer">
                    <div className="bg-red-500 w-[15px] h-[15px] rounded-full start-0 -top-[5px] absolute z-[200] text-[10px] flex justify-center items-center">
                      !
                    </div>
                    <div className="bg-primary/60 w-[39px] h-[46px] start-0 top-0 absolute rounded-full z-[199]" />
                  </div>
                )}
                <div className="h-full w-[4px] -ms-[12px] rounded-s-[3px] opacity-0 group-hover/profile:opacity-100 transition-opacity">
                  <SVGLine />
                </div>
                <ImageWithFallback
                  fallbackSrc={`/icons/platforms/${integration.identifier}.png`}
                  src={integration.picture}
                  className="rounded-[8px]"
                  alt={integration.identifier}
                  width={36}
                  height={36}
                />
                <SafeImage
                  src={`/icons/platforms/${integration.identifier}.png`}
                  className="rounded-[8px] absolute z-10 bottom-[5px] -end-[5px] border border-fifth"
                  alt={integration.identifier}
                  width={18.41}
                  height={18.41}
                />
              </div>
              <div
                className={clsx(
                  'flex-1 whitespace-nowrap text-ellipsis overflow-hidden group-[.sidebar]:hidden',
                  integration.disabled && 'opacity-50'
                )}
              >
                {integration.name}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const PropertiesContext = createContext({ properties: [] });
export const Agent: FC<{ children: ReactNode }> = ({ children }) => {
  const [properties, setProperties] = useState([]);

  return (
    <PropertiesContext.Provider value={{ properties }}>
      <AgentList onChange={setProperties} />
      <div className="agent-main-shell flex flex-1 phone:min-h-[55vh] bg-[linear-gradient(180deg,rgba(10,14,26,0.94),rgba(8,14,28,0.98))]">
        {children}
      </div>
      <Threads />
    </PropertiesContext.Provider>
  );
};

const Threads: FC = () => {
  const fetch = useFetch();
  const pathname = usePathname();
  const t = useT();
  const threads = useCallback(async () => {
    return (await fetch('/copilot/list')).json();
  }, []);
  const { id } = useParams<{ id: string }>();

  const { data, mutate } = useSWR('threads', threads);

  // A thread only exists server-side once the user sends their first message,
  // so a chat started in this session is missing from the list that was fetched
  // when the panel mounted. Re-fetch whenever the active chat changes — by then
  // the previous one has been persisted and titled.
  useEffect(() => {
    mutate();
  }, [pathname]);

  return (
    <div
      className={clsx(
        'agent-side-panel trz flex flex-col gap-[15px] transition-all relative border-s border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.88),rgba(8,14,28,0.96))] backdrop-blur-xl phone:hidden',
        'w-[280px]'
      )}
    >
      <div tabIndex={0} className="absolute top-0 start-0 w-full h-full phone:static phone:h-auto phone:max-h-[40vh] p-[20px] overflow-auto scrollbar scrollbar-thumb-fifth scrollbar-track-transparent">
        <div className="mb-[15px] justify-center flex group-[.sidebar]:pb-[15px]">
          <Link
            href={`/agents`}
            className="whitespace-nowrap flex-1 pt-[12px] pb-[14px] ps-[16px] pe-[20px] group-[.sidebar]:p-0 min-h-[44px] max-h-[44px] rounded-[12px] bg-[linear-gradient(135deg,#38bdf8,#a78bfa)] text-slate-950 shadow-[0_16px_40px_rgba(56,189,248,0.28)] flex justify-center items-center gap-[5px] outline-none font-[700]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="21"
              height="20"
              viewBox="0 0 21 20"
              fill="none"
              className="min-w-[21px] min-h-[20px]"
            >
              <path
                d="M10.5001 4.16699V15.8337M4.66675 10.0003H16.3334"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="flex-1 text-start text-[16px] group-[.sidebar]:hidden">
              {t('start_a_new_chat', 'Start a new chat')}
            </div>
          </Link>
        </div>
        <div className="flex flex-col gap-[1px]">
          {data?.threads?.map((p: any) => (
            <Link
              className={clsx(
                'overflow-ellipsis overflow-hidden whitespace-nowrap px-[12px] py-[10px] rounded-[12px] cursor-pointer border transition-all duration-200',
                p.id === id
                  ? 'agent-thread-selected bg-white/[0.06] border-sky-300/15 text-textColor shadow-[0_10px_28px_rgba(2,6,23,0.24)]'
                  : 'agent-thread-item border-transparent text-textColor/75 hover:text-textColor hover:bg-white/[0.04] hover:border-white/8'
              )}
              href={`/agents/${p.id}`}
              key={p.id}
            >
              {p.title}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};
