'use client';

import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import React, { FC, useCallback, useMemo } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { isFetchHandledError } from '@gitroom/helpers/utils/fetch.errors';
import { Input } from '@gitroom/react/form/input';
import { FieldValues, FormProvider, useForm } from 'react-hook-form';
import { Button } from '@gitroom/frontend/components/ui/button';
import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import { ApiKeyDto } from '@gitroom/nestjs-libraries/dtos/integrations/api.key.dto';
import { useRouter } from 'next/navigation';
import { TopTitle } from '@gitroom/frontend/components/launches/helpers/top.title.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { object, string } from 'yup';
import { yupResolver } from '@hookform/resolvers/yup';
import { web3List } from '@gitroom/frontend/components/launches/web3/web3.list';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import clsx from 'clsx';
import copy from 'copy-to-clipboard';
import { capitalize } from 'lodash';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import {
  hasMetaChecklist,
  metaChecklists,
  MetaConnectChecklist,
} from '@gitroom/frontend/components/launches/meta.connect.checklist';
import {
  pricing,
  planLabel,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
const resolver = classValidatorResolver(ApiKeyDto);

export const useAddProvider = (update?: () => void, invite?: boolean) => {
  const modal = useModals();
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  return useCallback(async () => {
    // Nothing awaits this handler, so an unhandled rejection here is invisible:
    // the button just stops working. Every failure has to end in a message.
    try {
      const data = await (await fetch('/integrations')).json();
      modal.openModal({
        title: invite
          ? t('invite_client_title', 'Invite a client to connect a channel')
          : t('add_channel', 'Add channel'),
        withCloseButton: true,
        classNames: {
          modal: 'launches-modal-surface text-textColor',
        },
        children: (
          <AddProviderComponent invite={!!invite} update={update} {...data} />
        ),
      });
    } catch (e) {
      // 5xx/429/401 already raised their own message globally.
      if (isFetchHandledError(e)) {
        return;
      }
      toaster.show(
        t(
          'could_not_load_channels',
          'Could not load the channel list — please try again.'
        ),
        'warning'
      );
    }
  }, []);
};
export const AddProviderButton: FC<{
  update?: () => void;
}> = (props) => {
  const { update } = props;
  const add = useAddProvider(update);
  const invite = useAddProvider(update, true);
  const t = useT();

  return (
    <div className="flex group-[.sidebar]:block gap-[8px]">
      <button
        className="flex-1 group-[.sidebar]:w-[100%] group-[.sidebar]:flex-none text-btnText bg-btnSimple h-[44px] pt-[12px] pb-[14px] ps-[16px] pe-[20px] justify-center items-center flex rounded-[8px] gap-[8px]"
        onClick={add}
      >
        <div>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
          >
            <path
              d="M1.66675 10.0417C3.35907 10.2299 4.93698 10.9884 6.14101 12.1924C7.34504 13.3964 8.10353 14.9743 8.29175 16.6667M1.66675 13.4167C2.46749 13.58 3.20253 13.9751 3.7804 14.553C4.35827 15.1309 4.75344 15.8659 4.91675 16.6667M1.66675 16.6667H1.67508M11.6667 17.5H14.3334C15.7335 17.5 16.4336 17.5 16.9684 17.2275C17.4388 16.9878 17.8212 16.6054 18.0609 16.135C18.3334 15.6002 18.3334 14.9001 18.3334 13.5V6.5C18.3334 5.09987 18.3334 4.3998 18.0609 3.86502C17.8212 3.39462 17.4388 3.01217 16.9684 2.77248C16.4336 2.5 15.7335 2.5 14.3334 2.5H5.66675C4.26662 2.5 3.56655 2.5 3.03177 2.77248C2.56137 3.01217 2.17892 3.39462 1.93923 3.86502C1.66675 4.3998 1.66675 5.09987 1.66675 6.5V6.66667"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="text-start text-[14px] group-[.sidebar]:hidden">
          {t('add_channel', 'Add channel')}
        </div>
      </button>
      <button
        type="button"
        onClick={invite}
        aria-label={t(
          'invite_link',
          'Send your client an invite link to add a channel'
        )}
        data-tooltip-id="tooltip"
        data-tooltip-content={t(
          'invite_link',
          'Send your client an invite link to add a channel'
        )}
        className="group-[.sidebar]:hidden min-h-[44px] min-w-[44px] bg-btnSimple justify-center items-center flex rounded-[8px] cursor-pointer"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 16 16"
          fill="none"
        >
          <g clipPath="url(#clip0_2452_193804)">
            <path
              d="M6.6668 8.66599C6.9531 9.04875 7.31837 9.36545 7.73783 9.59462C8.1573 9.82379 8.62114 9.96007 9.0979 9.99422C9.57466 10.0284 10.0532 9.95957 10.501 9.79251C10.9489 9.62546 11.3555 9.36404 11.6935 9.02599L13.6935 7.02599C14.3007 6.39732 14.6366 5.55531 14.629 4.68132C14.6215 3.80733 14.2709 2.97129 13.6529 2.35326C13.0348 1.73524 12.1988 1.38467 11.3248 1.37708C10.4508 1.36948 9.60881 1.70547 8.98013 2.31266L7.83347 3.45266M9.33347 7.33266C9.04716 6.94991 8.68189 6.6332 8.26243 6.40403C7.84297 6.17486 7.37913 6.03858 6.90237 6.00444C6.4256 5.97029 5.94708 6.03908 5.49924 6.20614C5.0514 6.3732 4.64472 6.63461 4.3068 6.97266L2.3068 8.97266C1.69961 9.60133 1.36363 10.4433 1.37122 11.3173C1.37881 12.1913 1.72938 13.0274 2.3474 13.6454C2.96543 14.2634 3.80147 14.614 4.67546 14.6216C5.54945 14.6292 6.39146 14.2932 7.02013 13.686L8.16013 12.546"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            ></path>
          </g>
          <defs>
            <clipPath id="clip0_2452_193804">
              <rect width="16" height="16" fill="textColor"></rect>
            </clipPath>
          </defs>
        </svg>
      </button>
    </div>
  );
};

export const UrlModal: FC<{
  gotoUrl(url: string): void;
}> = (props) => {
  const { gotoUrl } = props;
  const methods = useForm({
    mode: 'onChange',
  });

  const t = useT();

  const submit = useCallback(async (data: FieldValues) => {
    gotoUrl(data.url);
  }, []);
  return (
    <div className="rounded-[4px] border border-customColor6 bg-sixth px-[16px] pb-[16px] relative">
      <TopTitle title={t('instance_url', 'Instance URL')} />
      <button
        onClick={close}
        className="outline-none absolute end-[20px] top-[20px] mantine-UnstyledButton-root mantine-ActionIcon-root hover:bg-tableBorder cursor-pointer mantine-Modal-close mantine-1dcetaa"
        type="button"
      >
        <svg
          viewBox="0 0 15 15"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
        >
          <path
            d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z"
            fill="currentColor"
            fillRule="evenodd"
            clipRule="evenodd"
          ></path>
        </svg>
      </button>
      <FormProvider {...methods}>
        <form
          className="gap-[8px] flex flex-col"
          onSubmit={methods.handleSubmit(submit)}
        >
          <div className="pt-[10px]">
            <Input label="URL" name="url" />
          </div>
          <div>
            <Button type="submit">{t('connect', 'Connect')}</Button>
          </div>
        </form>
      </FormProvider>
    </div>
  );
};
export const CustomVariables: FC<{
  variables: Array<{
    key: string;
    label: string;
    defaultValue?: string;
    validation: string;
    type: 'text' | 'password';
  }>;
  close?: () => void;
  identifier: string;
  gotoUrl(url: string): void;
  onboarding?: boolean;
}> = (props) => {
  const { close, gotoUrl, identifier, variables, onboarding } = props;
  const fetch = useFetch();
  const modals = useModals();
  const schema = useMemo(() => {
    return object({
      ...variables.reduce((aIcc, item) => {
        const splitter = item.validation.split('/');
        const regex = new RegExp(
          splitter.slice(1, -1).join('/'),
          splitter.pop()
        );
        return {
          ...aIcc,
          [item.key]: string()
            .matches(regex, `The "${item.label}" field is invalid`)
            .required(),
        };
      }, {}),
    });
  }, [variables]);
  const methods = useForm({
    mode: 'onChange',
    resolver: yupResolver(schema),
    values: variables.reduce(
      (acc, item) => ({
        ...acc,
        ...(item.defaultValue
          ? {
              [item.key]: item.defaultValue,
            }
          : {}),
      }),
      {}
    ),
  });
  const submit = useCallback(
    async (data: FieldValues) => {
      const response = await fetch(
        `/integrations/social/${identifier}${onboarding ? '?onboarding=true' : ''}`
      );
      // 402: the payment dialog has had its say; stay on Add Channel.
      if (response.status === 402) {
        return;
      }
      const { url } = await response.json();
      modals.closeAll();
      gotoUrl(
        `/integrations/social/${identifier}?state=${url}&code=${Buffer.from(
          JSON.stringify(data)
        ).toString('base64')}${onboarding ? '&onboarding=true' : ''}`
      );
    },
    [variables, onboarding]
  );

  const t = useT();

  return (
    <div className="rounded-[4px] relative">
      <FormProvider {...methods}>
        <form
          className="gap-[8px] flex flex-col pt-[10px]"
          onSubmit={methods.handleSubmit(submit)}
        >
          {variables.map((variable) => (
            <div key={variable.key}>
              <Input
                label={variable.label}
                name={variable.key}
                type={variable.type == 'text' ? 'text' : 'password'}
              />
            </div>
          ))}
          <div>
            <Button type="submit">{t('connect', 'Connect')}</Button>
          </div>
        </form>
      </FormProvider>
    </div>
  );
};
const ExtensionNotFound: FC = () => {
  const modals = useModals();
  const t = useT();
  const { extensionId } = useVariables();
  return (
    <div className="flex flex-col gap-[16px] pt-[8px]">
      <p className="text-[14px] text-textColor/80">
        {t(
          'extension_not_available',
          'The Postra browser extension is not installed. Install it before connecting this channel.'
        )}
      </p>
      <div className="flex gap-[10px]">
        <Button
          type="button"
          className="flex-1"
          onClick={() => {
            window.open(
              `https://chromewebstore.google.com/detail/${extensionId}`,
              '_blank'
            );
            modals.closeCurrent();
          }}
        >
          {t('install_extension', 'Install the extension')}
        </Button>
        <Button
          type="button"
          className="flex-1 !bg-transparent border border-tableBorder text-textColor"
          onClick={() => modals.closeCurrent()}
        >
          {t('cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
};

const ChromeExtensionWarning: FC<{
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ onConfirm, onCancel }) => {
  const modals = useModals();
  const t = useT();
  return (
    <div className="flex flex-col gap-[16px] pt-[8px]">
      <p className="text-[14px] text-textColor/80">
        {t(
          'chrome_extension_warning_intro',
          'This channel connects through a browser extension. Keep the following in mind:'
        )}
      </p>
      <ul className="flex flex-col gap-[8px] list-disc ps-[20px] text-[14px] text-textColor/80">
        <li>
          {t(
            'chrome_extension_warning_tos',
            'Using a browser extension to connect to the platform may violate its terms of service and could result in your account being suspended or banned.'
          )}
        </li>
        <li>
          {t(
            'chrome_extension_warning_unstable',
            'This method is not as stable as native integrations and may cause random disconnections.'
          )}
        </li>
        <li>
          {t(
            'chrome_extension_warning_reconnect',
            'If the session expires, you may need to reconnect.'
          )}
        </li>
        <li>
          We will securely store your cookies to enable this connection.
        </li>
        <li>
          Postra is not responsible for any issues or account closures resulting from using this method.
        </li>
      </ul>
      <div className="flex gap-[10px] mt-[8px]">
        <Button
          type="button"
          className="flex-1"
          onClick={() => {
            modals.closeCurrent();
            onConfirm();
          }}
        >
          {t('i_understand_continue', 'I understand, continue')}
        </Button>
        <Button
          type="button"
          className="flex-1 !bg-transparent border border-tableBorder text-textColor"
          onClick={() => {
            modals.closeCurrent();
            onCancel();
          }}
        >
          {t('cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
};


export const AddProviderComponent: FC<{
  social: Array<{
    identifier: string;
    name: string;
    toolTip?: string;
    enabled?: boolean;
    isExternal: boolean;
    isWeb3: boolean;
    isChromeExtension?: boolean;
    extensionCookies?: Array<{
      name: string;
      domain: string;
    }>;
    customFields?: Array<{
      key: string;
      label: string;
      validation: string;
      type: 'text' | 'password';
    }>;
  }>;
  article: Array<{
    identifier: string;
    name: string;
  }>;
  invite: boolean;
  update?: () => void;
  onboarding?: boolean;
  isMobile?: boolean;
}> = (props) => {
  const { update, social, article, onboarding, isMobile } = props;
  const { isGeneral, extensionId } = useVariables();
  const user = useUser();
  // Platforms the current tier may connect; anything outside the list is shown
  // locked (dimmed + a badge) rather than hidden, so users can see what a higher
  // plan unlocks. Undefined when billing is off / no user ⇒ nothing is locked.
  const allowedProviders = user?.tier?.allowedProviders;
  const unlockTierLabel = useCallback(
    (identifier: string) =>
      pricing.PRO.allowedProviders.includes(identifier)
        ? planLabel('PRO')
        : planLabel('ULTIMATE'),
    []
  );
  const toaster = useToaster();
  const router = useRouter();
  const fetch = useFetch();
  const modal = useModals();
  const getSocialLink = useCallback(
    (
        invite: boolean,
        identifier: string,
        isExternal: boolean,
        isWeb3: boolean,
        isChromeExtension?: boolean,
        customFields?: Array<{
          key: string;
          label: string;
          validation: string;
          defaultValue?: string;
          type: 'text' | 'password';
        }>
      ) =>
      async () => {
        const onboardingParam = onboarding ? 'onboarding=true' : '';
        const openWeb3 = async () => {
          const { component: Web3Providers } = web3List.find(
            (item) => item.identifier === identifier
          )!;
          const response = await fetch(
            `/integrations/social/${identifier}${onboarding ? '?onboarding=true' : ''}`
          );
          if (response.status === 402) {
            return;
          }
          const { url } = await response.json();
          modal.openModal({
            title: t('add_channel_named', 'Add {{name}}', {
              name: capitalize(identifier),
            }),
            withCloseButton: true,
            ...(isMobile ? { removeLayout: true, fullScreen: true } : {}),
            // The surface every other add-channel dialog uses: with
            // bg-transparent the picker's tiles showed through the Telegram
            // instructions.
            classNames: {
              modal: 'launches-modal-surface text-textColor',
            },
            children: (
              <div
                {...(isMobile ? { className: 'h-full bg-black p-[20px]' } : {})}
              >
                <Web3Providers
                  onComplete={(code, newState) => {
                    window.location.href = `/integrations/social/${identifier}?code=${code}&state=${newState}${
                      onboarding ? '&onboarding=true' : ''
                    }`;
                  }}
                  nonce={url}
                />
              </div>
            ),
          });
          return;
        };
        const gotoIntegration = async (externalUrl?: string) => {
          // Mobile WebView: reuse the existing `externalUrl` param to
          // carry the `postra://` deep link so the backend redirects
          // back to the iOS/Android app after OAuth completes, instead
          // of the default web redirect.
          const params = [
            `externalUrl=${encodeURIComponent(externalUrl)}`,
            onboardingParam,
            // Asks the backend for a link to a page of ours rather than the raw
            // provider OAuth URL, so the client following it is told what the
            // platform requires before they meet the platform.
            invite ? 'invite=true' : '',
            // Not for an invite: the client finishes in their own browser,
            // and handing that back to our app would strand them.
            isMobile && !invite
              ? `redirectUrl=${encodeURIComponent('postra://integrations')}`
              : '',
          ]
            .filter(Boolean)
            .join('&');
          // 402 and Cancel in the payment dialog: stay on Add Channel instead
          // of following an empty url (upstream c033aff5).
          const response = await fetch(
            `/integrations/social/${identifier}${params ? `?${params}` : ''}`
          );
          if (response.status === 402) {
            return;
          }
          const { url, err } = await response.json();
          if (err) {
            toaster.show(
              t(
                'could_not_connect_to_platform',
                'Could not connect to the platform'
              ),
              'warning'
            );
            return;
          }

          if (invite) {
            toaster.show(
              'Invite link copied to clipboard. It will be valid for 1 hour.',
              'success'
            );
            modal.closeAll();
            copy(url);
            return;
          }

          if (isMobile) {
            // In the mobile WebView the OAuth provider (Google, Facebook,
            // etc.) typically refuses in-WebView sign-in. Post the URL
            // out to React Native so it can open the system browser;
            // `window.open`/`location.href` aren't reliable here because
            // RN WebView doesn't always route them through the native
            // navigation intercept. The backend redirects back to the
            // app via `postra://` once OAuth completes.
            const rn = (window as any).ReactNativeWebView;
            if (rn && typeof rn.postMessage === 'function') {
              rn.postMessage(JSON.stringify({ type: 'open-external', url }));
              return;
            }
            window.open(url, '_blank');
            return;
          }

          window.location.href = url;
        };
        if (isWeb3) {
          openWeb3();
          return;
        }
        if (isChromeExtension) {
          const confirmed = await new Promise<boolean>((resolve) => {
            modal.openModal({
              title: t('chrome_extension_notice', 'Browser extension notice'),
              withCloseButton: true,
              onClose: () => resolve(false),
              children: (
                <ChromeExtensionWarning
                  onConfirm={() => {
                    resolve(true);
                  }}
                  onCancel={() => {
                    resolve(false);
                  }}
                />
              ),
            });
          });
          if (!confirmed) {
            return;
          }
          if (!extensionId || !chrome?.runtime?.sendMessage) {
            modal.openModal({
              title: t('extension_not_available_title', 'Extension not found'),
              withCloseButton: true,
              children: <ExtensionNotFound />,
            });
            return;
          }
          try {
            await new Promise<void>((resolve, reject) => {
              chrome.runtime.sendMessage(
                extensionId,
                { type: 'PING' },
                (response: any) => {
                  if (chrome.runtime.lastError || !response?.status) {
                    reject(new Error('Extension not reachable'));
                  } else {
                    resolve();
                  }
                }
              );
            });
          } catch {
            toaster.show(
              t(
                'extension_not_installed',
                'Postra browser extension is not installed or not reachable.'
              ),
              'warning'
            );
            return;
          }
          try {
            const cookieResponse = await new Promise<any>((resolve, reject) => {
              chrome.runtime.sendMessage(
                extensionId,
                { type: 'GET_COOKIES', provider: identifier },
                (response: any) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                  } else {
                    resolve(response);
                  }
                }
              );
            });
            if (!cookieResponse.success) {
              toaster.show(
                cookieResponse.error ||
                  t(
                    'extension_cookies_missing',
                    'Could not get cookies. Please log in to the platform first.'
                  ),
                'warning'
              );
              return;
            }
            const { url } = await (
              await fetch(
                `/integrations/social/${identifier}${
                  onboarding ? '?onboarding=true' : ''
                }`
              )
            ).json();
            modal.closeAll();
            window.location.href = `/integrations/social/${identifier}?state=${url}&code=${Buffer.from(
              JSON.stringify(cookieResponse.cookies)
            ).toString('base64')}${onboarding ? '&onboarding=true' : ''}`;
          } catch {
            toaster.show(
              t(
                'extension_communication_error',
                'Failed to communicate with the browser extension.'
              ),
              'warning'
            );
          }
          return;
        }
        if (isExternal) {
          modal.openModal({
            title: t('instance_url', 'Instance URL'),
            withCloseButton: true,
            ...(isMobile ? { removeLayout: true, fullScreen: true } : {}),
            classNames: {
              modal: 'launches-modal-surface text-textColor',
            },
            children: <UrlModal gotoUrl={gotoIntegration} />,
          });
          return;
        }
        if (customFields) {
          modal.openModal({
            title: t('add_provider_title', 'Add channel'),
            withCloseButton: true,
            ...(isMobile ? { removeLayout: true, fullScreen: true } : {}),
            classNames: {
              modal: 'launches-modal-surface text-textColor',
            },
            children: (
              <div
                {...(isMobile ? { className: 'h-full bg-black p-[20px]' } : {})}
              >
                <CustomVariables
                  identifier={identifier}
                  gotoUrl={(url: string) => router.push(url)}
                  variables={customFields}
                  onboarding={onboarding}
                />
              </div>
            ),
          });
          return;
        }
        // Ask before the trip to Meta, not after the picker comes back empty.
        // Invites skip it here and get the same checklist on the page their
        // link now opens (`/connect/:provider/:token`), because the person
        // following that link is not the one standing in front of this modal.
        if (!invite && hasMetaChecklist(identifier)) {
          const checklist = metaChecklists[identifier];
          const acknowledged = await new Promise<boolean>((resolve) => {
            modal.openModal({
              title: t(checklist.title.key, checklist.title.text),
              withCloseButton: true,
              onClose: () => resolve(false),
              // `close` closes this checklist. modal.closeCurrent() closed the
              // modal this hook runs in — the channel picker — so "show me how"
              // left the checklist on screen with its answer already given, and
              // "Done — continue" afterwards did nothing at all. Resolve before
              // closing: closing runs onClose, which answers false.
              children: (close: () => void) => (
                <MetaConnectChecklist
                  provider={identifier}
                  onConfirm={() => {
                    resolve(true);
                    close();
                  }}
                  onCancel={() => {
                    resolve(false);
                    close();
                    window.open(`/help#channel-${identifier}`, '_blank');
                  }}
                />
              ),
            });
          });
          if (!acknowledged) {
            return;
          }
        }
        await gotoIntegration();
      },
    [onboarding]
  );

  const t = useT();

  const sortedSocial = useMemo(
    () =>
      [...social].sort((a, b) => {
        const ae = a.enabled !== false ? 1 : 0;
        const be = b.enabled !== false ? 1 : 0;
        return be - ae;
      }),
    [social]
  );

  return (
    <div className="w-full flex flex-col gap-[20px] rounded-[4px] relative">
      <div className="flex flex-col">
        <div
          className={clsx(
            isMobile && 'gap-[20px] flex flex-col',
            !isMobile &&
              'grid grid-cols-5 gap-[10px] justify-items-center justify-center',
            isMobile ? {} : onboarding ? 'grid-cols-9' : 'grid-cols-5'
          )}
        >
          {sortedSocial
            .filter((item) => {
              if (!props.invite) {
                return true;
              }

              return (
                !item.isExternal &&
                !item.isWeb3 &&
                !item.isChromeExtension &&
                !item.customFields
              );
            })
            .map((item) => {
              const isEnabled = item.enabled !== false;
              const lockedByTier =
                isEnabled &&
                !!allowedProviders &&
                !allowedProviders.includes(item.identifier);
              return (
                <div
                  key={item.identifier}
                  {...(isEnabled
                    ? {
                        onClick: getSocialLink(
                          props.invite,
                          item.identifier,
                          item.isExternal,
                          item.isWeb3,
                          item.isChromeExtension,
                          item.customFields
                        ),
                      }
                    : {})}
                  {...(!isEnabled
                    ? {
                        'data-tooltip-id': 'tooltip',
                        'data-tooltip-content': t(
                          'coming_soon',
                          'Coming soon'
                        ),
                      }
                    : {})}
                  className={clsx(
                    isMobile
                      ? 'flex-row h-[72px] p-[16px]'
                      : 'flex-col p-[10px] h-[100px] justify-center',
                    'launches-provider-card w-full text-[14px] rounded-[14px] border relative items-center flex gap-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200',
                    !isEnabled
                      ? 'border-white/4 bg-[linear-gradient(180deg,rgba(30,41,59,0.2),rgba(15,23,42,0.35))] text-textColor/30 cursor-default'
                      : lockedByTier
                      ? 'border-white/8 bg-[linear-gradient(180deg,rgba(30,41,59,0.28),rgba(15,23,42,0.5))] text-textColor/45 cursor-pointer hover:border-[#a78bfa]/30'
                      : 'border-white/8 bg-[linear-gradient(180deg,rgba(30,41,59,0.46),rgba(15,23,42,0.7))] text-textColor cursor-pointer hover:border-sky-300/20 hover:bg-[linear-gradient(180deg,rgba(30,41,59,0.62),rgba(15,23,42,0.82))]'
                  )}
                >
                  <div
                    className={clsx(
                      !isEnabled && 'opacity-30',
                      lockedByTier && 'opacity-60'
                    )}
                  >
                    {item.identifier === 'youtube' ? (
                      <img alt="" src={`/icons/platforms/youtube.svg`} />
                    ) : (
                      <img
                        alt=""
                        className={clsx(
                          'w-[32px] h-[32px]',
                          item.identifier !== 'google_my_business' &&
                            'rounded-full',
                          (!isEnabled || lockedByTier) && 'grayscale'
                        )}
                        src={`/icons/platforms/${item.identifier}.png`}
                      />
                    )}
                  </div>
                  <div
                    className={clsx(
                      isMobile ? '' : 'whitespace-pre-wrap',
                      'text-center'
                    )}
                  >
                    {item.name}
                    {!isEnabled && !isMobile && (
                      <div className="text-[10px] text-textColor/20 mt-[2px]">
                        {t('coming_soon_short', 'Soon')}
                      </div>
                    )}
                    {lockedByTier && !isMobile && (
                      <div className="text-[10px] text-[#a78bfa] mt-[2px] font-[600] flex items-center justify-center gap-[3px]">
                        <span>🔒</span>
                        {unlockTierLabel(item.identifier)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};
