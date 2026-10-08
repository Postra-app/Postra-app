'use client';

import {
  FC,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { TikTokDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Select } from '@gitroom/react/form/select';
import { Checkbox } from '@gitroom/react/form/checkbox';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { Input } from '@gitroom/react/form/input';
import { TiktokPreview } from '@gitroom/frontend/components/new-launch/providers/tiktok/tiktok.preview';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';

// Render a duration in seconds as M:SS for the TikTok length indicator.
const formatSeconds = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const TikTokSettings: FC<{
  values?: any;
}> = (props) => {
  const { watch, register, setValue } = useSettings();
  const { value, integration } = useIntegration();
  const t = useT();
  const customFunc = useCustomProviderFunction();
  const mediaDir = useMediaDirectory();

  // TikTok Content Posting API compliance: the privacy selector and the
  // comment/duet/stitch toggles must reflect the creator's actual permissions
  // returned by /v2/post/publish/creator_info/query/ — they cannot be hardcoded.
  const [creatorInfo, setCreatorInfo] = useState<{
    privacyOptions: string[];
    commentDisabled: boolean;
    duetDisabled: boolean;
    stitchDisabled: boolean;
    maxDurationSeconds?: number;
    nickname?: string;
    avatarUrl?: string;
  } | null>(null);
  // The backend answers `false` when TikTok refused even after a token refresh;
  // without this the selector said "Loading…" forever (E2E-08-63).
  const [creatorInfoFailed, setCreatorInfoFailed] = useState(false);

  // Detected duration (seconds) of the attached video, used to enforce the
  // creator's TikTok max_video_post_duration_sec client-side before posting.
  const [videoDuration, setVideoDuration] = useState<number | null>(null);

  useEffect(() => {
    customFunc
      .get('creatorInfo')
      .then((data) => {
        if (!Array.isArray(data?.privacyOptions)) {
          setCreatorInfoFailed(true);
          return;
        }
        setCreatorInfo(data);
        // Force-off any interaction the creator has disabled so we never send an
        // "allow" that TikTok would reject server-side.
        if (data?.commentDisabled) setValue('comment', false);
        if (data?.duetDisabled) setValue('duet', false);
        if (data?.stitchDisabled) setValue('stitch', false);
      })
      .catch(() => {
        setCreatorInfo(null);
        setCreatorInfoFailed(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isTitle = useMemo(() => {
    return value?.[0]?.image?.some((p) => (p?.path?.indexOf?.('mp4') ?? -1) === -1);
  }, [value]);

  const hasMedia = (value?.[0]?.image?.length ?? 0) > 0;
  const isVideo = hasMedia && !isTitle;

  const videoPath = useMemo(() => {
    const videoItem = value?.[0]?.image?.find(
      (p) => (p?.path?.indexOf?.('mp4') ?? -1) !== -1
    );
    return videoItem?.path ? mediaDir.set(videoItem.path) : null;
  }, [value, mediaDir]);

  // Read the attached video's duration from its metadata so we can warn before
  // a post that exceeds the creator's TikTok-enforced limit (creator_info).
  useEffect(() => {
    if (!videoPath) {
      setVideoDuration(null);
      return;
    }
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    const onLoaded = () => {
      setVideoDuration(
        Number.isFinite(probe.duration) ? probe.duration : null
      );
    };
    const onError = () => setVideoDuration(null);
    probe.addEventListener('loadedmetadata', onLoaded);
    probe.addEventListener('error', onError);
    probe.src = videoPath;
    return () => {
      probe.removeEventListener('loadedmetadata', onLoaded);
      probe.removeEventListener('error', onError);
      probe.src = '';
    };
  }, [videoPath]);

  const maxDurationSeconds = creatorInfo?.maxDurationSeconds;

  const disclose = watch('disclose');
  const brand_organic_toggle = watch('brand_organic_toggle');
  const brand_content_toggle = watch('brand_content_toggle');
  const content_posting_method = watch('content_posting_method');
  const privacy_level = watch('privacy_level');
  const isUploadMode = content_posting_method === 'UPLOAD';

  // Direct Post must honour the creator's max video length (creator_info).
  // Upload-only finishes inside the TikTok app, so the limit doesn't apply here.
  const durationExceeded =
    isVideo &&
    !isUploadMode &&
    typeof maxDurationSeconds === 'number' &&
    videoDuration !== null &&
    videoDuration > maxDurationSeconds;

  const tiktokRestrictionNotice = useMemo(() => {
    if (!hasMedia || !isVideo) return null;
    if (!isUploadMode) {
      return t(
        'tiktok_restriction_direct_video',
        'TikTok restriction: For direct post with video, your post content is used as the title. A separate title field is not available.'
      );
    }
    return t(
      'tiktok_restriction_upload_video',
      'TikTok restriction: For upload-only video, TikTok does not accept a title or message. You can edit the content inside the TikTok app before publishing.'
    );
  }, [hasMedia, isUploadMode, isVideo, t]);

  const allPrivacyLevels = [
    {
      value: 'PUBLIC_TO_EVERYONE',
      label: t('public_to_everyone', 'Public to everyone'),
    },
    {
      value: 'MUTUAL_FOLLOW_FRIENDS',
      label: t('mutual_follow_friends', 'Mutual follow friends'),
    },
    {
      value: 'FOLLOWER_OF_CREATOR',
      label: t('follower_of_creator', 'Follower of creator'),
    },
    {
      value: 'SELF_ONLY',
      label: t('self_only', 'Self only'),
    },
  ];
  // Show only the privacy options the creator is actually allowed to use.
  // Unaudited apps get SELF_ONLY only; audited apps get the full set — both
  // come straight from creator_info, never hardcoded.
  const privacyLevel = creatorInfo
    ? allPrivacyLevels.filter((p) => creatorInfo.privacyOptions.includes(p.value))
    : [];
  const contentPostingMethod = [
    {
      value: 'DIRECT_POST',
      label: t(
        'post_content_directly_to_tiktok',
        'Post content directly to TikTok'
      ),
    },
    {
      value: 'UPLOAD',
      label: t(
        'upload_content_to_tiktok_without_posting',
        'Upload content to TikTok without posting it'
      ),
    },
  ];
  const yesNo = [
    {
      value: 'yes',
      label: t('yes', 'Yes'),
    },
    {
      value: 'no',
      label: t('no', 'No'),
    },
  ];

  return (
    <div className="flex flex-col">
      {/*<CheckTikTokValidity picture={props?.values?.[0]?.image?.[0]?.path} />*/}
      {/* TikTok UX compliance: show the connected creator (nickname + avatar)
          so the user always knows which account the post will be published to. */}
      <div className="bg-tableBorder p-[10px] mb-[18px] rounded-[10px] flex gap-[10px] items-center">
        <img
          src={creatorInfo?.avatarUrl || integration?.picture || '/no-picture.jpg'}
          alt="TikTok creator"
          className="rounded-full w-[36px] h-[36px] object-cover shrink-0"
        />
        <div className="flex flex-col">
          <div className="text-[11px] opacity-70">
            {t('tiktok_posting_to', 'Posting to')}
          </div>
          <div className="text-[14px] font-[500]">
            {creatorInfo?.nickname || integration?.name || '—'}
          </div>
        </div>
      </div>
      {tiktokRestrictionNotice && (
        <div className="bg-tableBorder p-[10px] mb-[18px] rounded-[10px] flex gap-[10px] items-start text-[13px] text-balance">
          <div className="shrink-0 mt-[2px]">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M22.201 17.6335L14.0026 3.39569C13.7977 3.04687 13.5052 2.75764 13.1541 2.55668C12.803 2.35572 12.4055 2.25 12.001 2.25C11.5965 2.25 11.199 2.35572 10.8479 2.55668C10.4968 2.75764 10.2043 3.04687 9.99944 3.39569L1.80101 17.6335C1.60388 17.9709 1.5 18.3546 1.5 18.7454C1.5 19.1361 1.60388 19.5199 1.80101 19.8572C2.00325 20.2082 2.29523 20.499 2.64697 20.6998C2.99871 20.9006 3.39755 21.0043 3.80257 21.0001H20.1994C20.6041 21.0039 21.0026 20.9001 21.354 20.6993C21.7054 20.4985 21.997 20.2079 22.1991 19.8572C22.3965 19.52 22.5007 19.1364 22.5011 18.7456C22.5014 18.3549 22.3978 17.9711 22.201 17.6335ZM11.251 9.75006C11.251 9.55115 11.33 9.36038 11.4707 9.21973C11.6113 9.07908 11.8021 9.00006 12.001 9.00006C12.1999 9.00006 12.3907 9.07908 12.5313 9.21973C12.672 9.36038 12.751 9.55115 12.751 9.75006V13.5001C12.751 13.699 12.672 13.8897 12.5313 14.0304C12.3907 14.171 12.1999 14.2501 12.001 14.2501C11.8021 14.2501 11.6113 14.171 11.4707 14.0304C11.33 13.8897 11.251 13.699 11.251 13.5001V9.75006ZM12.001 18.0001C11.7785 18.0001 11.561 17.9341 11.376 17.8105C11.191 17.6868 11.0468 17.5111 10.9616 17.3056C10.8765 17.1 10.8542 16.8738 10.8976 16.6556C10.941 16.4374 11.0482 16.2369 11.2055 16.0796C11.3628 15.9222 11.5633 15.8151 11.7815 15.7717C11.9998 15.7283 12.226 15.7505 12.4315 15.8357C12.6371 15.9208 12.8128 16.065 12.9364 16.25C13.06 16.4351 13.126 16.6526 13.126 16.8751C13.126 17.1734 13.0075 17.4596 12.7965 17.6706C12.5855 17.8815 12.2994 18.0001 12.001 18.0001Z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div>{tiktokRestrictionNotice}</div>
        </div>
      )}
      {isTitle && <Input label="Title" {...register('title')} maxLength={89} />}
      <Select
        label={t('label_who_can_see_this_video', 'Who can see this video?')}
        disabled={isUploadMode || !creatorInfo}
        {...register('privacy_level', {
          value: '',
        })}
      >
        <option value="">
          {creatorInfo
            ? t('select', 'Select')
            : creatorInfoFailed
            ? t(
                'tiktok_settings_failed',
                "Couldn't load your TikTok settings - reconnect the channel and try again"
              )
            : t('loading_tiktok_settings', 'Loading your TikTok settings…')}
        </option>
        {privacyLevel.map((item) => (
          <option
            key={item.value}
            value={item.value}
            // TikTok: branded content can't be private.
            disabled={item.value === 'SELF_ONLY' && !!brand_content_toggle}
          >
            {item.label}
          </option>
        ))}
      </Select>
      {/* Always surface the attached video's length next to the creator's
          TikTok-enforced max (from creator_info, never hardcoded) — green when
          within the limit, red + actionable when it exceeds it. Previously this
          only rendered when exceeded, so a within-limit video showed nothing
          and the user couldn't see the length or the account's limit at all. */}
      {isVideo && !isUploadMode && videoDuration !== null && (
        <div
          className={clsx(
            'mt-[10px] text-[13px] text-balance',
            durationExceeded ? 'text-red-600' : 'opacity-70'
          )}
        >
          {t('tiktok_video_length', 'Video length')}:{' '}
          {formatSeconds(videoDuration)}
          {typeof maxDurationSeconds === 'number' &&
            (durationExceeded
              ? ' — ' +
                t(
                  'tiktok_video_over_limit',
                  'longer than your TikTok limit ({{max}}). Shorten the video or use "Upload without posting".'
                ).replace('{{max}}', formatSeconds(maxDurationSeconds))
              : ' — ' +
                t(
                  'tiktok_video_within_limit',
                  'within your TikTok limit ({{max}}).'
                ).replace('{{max}}', formatSeconds(maxDurationSeconds)))}
        </div>
      )}
      <div className="text-[14px] mt-[10px] mb-[18px] text-balance">
        {t(
          'choose_upload_without_posting_description',
          `Choose upload without posting if you want to review and edit your content within TikTok's app before publishing.
        This gives you access to TikTok's built-in editing tools and lets you make final adjustments before posting.`
        )}
      </div>
      <Select
        label={t('label_content_posting_method', 'Content posting method')}
        {...register('content_posting_method', {
          value: 'DIRECT_POST',
        })}
      >
        <option value="">{t('select', 'Select')}</option>
        {contentPostingMethod.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>
      {isUploadMode && <div className="-mt-[23px] mb-[23px] text-red-600">After posting you will find a notification inside your Inbox about your post (not content studio)</div>}
      <Select
        label={t('label_auto_add_music', 'Auto add music')}
        {...register('autoAddMusic', {
          value: 'no',
        })}
      >
        <option value="">{t('select', 'Select')}</option>
        {yesNo.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>
      <div className="text-[14px] mt-[10px] mb-[24px] text-balance">
        {t(
          'this_feature_available_only_for_photos',
          'This feature available only for photos, it will add a default music that\n        you can change later.'
        )}
      </div>
      <hr className="mb-[15px] border-tableBorder" />
      <div className="text-[14px] mb-[10px]">
        {t('allow_user_to', 'Allow User To:')}
      </div>
      <div className="flex gap-[40px]">
        <Checkbox
          label={t('label_comments', 'Comments')}
          variant="hollow"
          disabled={isUploadMode || !!creatorInfo?.commentDisabled}
          {...register('comment', {
            value: false,
          })}
        />
        <Checkbox
          variant="hollow"
          label={t('label_duet', 'Duet')}
          disabled={isUploadMode || !!creatorInfo?.duetDisabled}
          {...register('duet', {
            value: false,
          })}
        />
        <Checkbox
          label={t('label_stitch', 'Stitch')}
          variant="hollow"
          disabled={isUploadMode || !!creatorInfo?.stitchDisabled}
          {...register('stitch', {
            value: false,
          })}
        />
      </div>
      <hr className="my-[15px] mb-[25px] border-tableBorder" />
      <div className="flex flex-col gap-[20px]">
        <Checkbox
          label={t('video_made_with_ai', 'Video made with AI')}
          variant="hollow"
          {...register('video_made_with_ai', {
            value: false,
          })}
        />
        <Checkbox
          variant="hollow"
          label={t('label_disclose_video_content', 'Disclose Video Content')}
          disabled={isUploadMode}
          {...register('disclose', {
            value: false,
          })}
        />
        {disclose && (
          <div className="bg-tableBorder p-[10px] mt-[10px] rounded-[10px] flex gap-[20px] items-center">
            <div>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M22.201 17.6335L14.0026 3.39569C13.7977 3.04687 13.5052 2.75764 13.1541 2.55668C12.803 2.35572 12.4055 2.25 12.001 2.25C11.5965 2.25 11.199 2.35572 10.8479 2.55668C10.4968 2.75764 10.2043 3.04687 9.99944 3.39569L1.80101 17.6335C1.60388 17.9709 1.5 18.3546 1.5 18.7454C1.5 19.1361 1.60388 19.5199 1.80101 19.8572C2.00325 20.2082 2.29523 20.499 2.64697 20.6998C2.99871 20.9006 3.39755 21.0043 3.80257 21.0001H20.1994C20.6041 21.0039 21.0026 20.9001 21.354 20.6993C21.7054 20.4985 21.997 20.2079 22.1991 19.8572C22.3965 19.52 22.5007 19.1364 22.5011 18.7456C22.5014 18.3549 22.3978 17.9711 22.201 17.6335ZM11.251 9.75006C11.251 9.55115 11.33 9.36038 11.4707 9.21973C11.6113 9.07908 11.8021 9.00006 12.001 9.00006C12.1999 9.00006 12.3907 9.07908 12.5313 9.21973C12.672 9.36038 12.751 9.55115 12.751 9.75006V13.5001C12.751 13.699 12.672 13.8897 12.5313 14.0304C12.3907 14.171 12.1999 14.2501 12.001 14.2501C11.8021 14.2501 11.6113 14.171 11.4707 14.0304C11.33 13.8897 11.251 13.699 11.251 13.5001V9.75006ZM12.001 18.0001C11.7785 18.0001 11.561 17.9341 11.376 17.8105C11.191 17.6868 11.0468 17.5111 10.9616 17.3056C10.8765 17.1 10.8542 16.8738 10.8976 16.6556C10.941 16.4374 11.0482 16.2369 11.2055 16.0796C11.3628 15.9222 11.5633 15.8151 11.7815 15.7717C11.9998 15.7283 12.226 15.7505 12.4315 15.8357C12.6371 15.9208 12.8128 16.065 12.9364 16.25C13.06 16.4351 13.126 16.6526 13.126 16.8751C13.126 17.1734 13.0075 17.4596 12.7965 17.6706C12.5855 17.8815 12.2994 18.0001 12.001 18.0001Z"
                  fill="white"
                />
              </svg>
            </div>
            <div>
              {brand_content_toggle
                ? t(
                    'your_video_will_be_labeled_paid_partnership',
                    'Your video will be labeled "Paid partnership".'
                  )
                : t(
                    'your_video_will_be_labeled_promotional',
                    'Your video will be labeled "Promotional Content".'
                  )}
              <br />
              {t(
                'this_cannot_be_changed_once_posted',
                'This cannot be changed once your video is posted.'
              )}
            </div>
          </div>
        )}
        <div className="text-[14px] my-[10px] text-balance">
          {t(
            'turn_on_to_disclose_video_promotes',
            'Turn on to disclose that this video promotes goods or services in\n          exchange for something of value. You video could promote yourself, a\n          third party, or both.'
          )}
        </div>
      </div>
      <div className={clsx(!disclose && 'invisible h-0 overflow-hidden', 'mt-[20px]')}>
        <Checkbox
          variant="hollow"
          label={t('label_your_brand', 'Your brand')}
          disabled={isUploadMode}
          {...register('brand_organic_toggle', {
            value: false,
          })}
        />
        <div className="text-balance my-[10px] text-[14px]">
          {t(
            'you_are_promoting_yourself',
            'You are promoting yourself or your own brand.'
          )}
          <br />
          {t(
            'this_video_will_be_classified_brand_organic',
            'This video will be classified as Brand Organic.'
          )}
        </div>
        <Checkbox
          variant="hollow"
          label={t('label_branded_content', 'Branded content')}
          disabled={isUploadMode || privacy_level === 'SELF_ONLY'}
          {...register('brand_content_toggle', {
            value: false,
          })}
        />
        <div className="text-balance my-[10px] text-[14px]">
          {t(
            'you_are_promoting_another_brand',
            'You are promoting another brand or a third party.'
          )}
          <br />
          {t(
            'this_video_will_be_classified_branded_content',
            'This video will be classified as Branded Content.'
          )}
        </div>
        {disclose && !brand_organic_toggle && !brand_content_toggle && (
          <div className="my-[10px] text-[14px] text-balance text-red-600">
            {t(
              'tiktok_disclosure_choice_required',
              'You need to indicate if your content promotes yourself, a third party, or both.'
            )}
          </div>
        )}
        {privacy_level === 'SELF_ONLY' && (
          <div className="my-[10px] text-[14px] text-balance opacity-70">
            {t(
              'tiktok_branded_content_not_private',
              'Branded content visibility cannot be set to private.'
            )}
          </div>
        )}
      </div>
      {!isUploadMode && (
        <div className="mt-[20px] text-[14px] text-balance">
          {t('by_posting_you_agree_to_tiktoks', "By posting, you agree to TikTok's")}{' '}
          <a
            target="_blank"
            className="text-[#B69DEC] hover:underline"
            href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
          >
            {t('music_usage_confirmation', 'Music Usage Confirmation')}
          </a>
          {brand_content_toggle && (
            <>
              {' '}
              {t('and', 'and')}{' '}
              <a
                target="_blank"
                className="text-[#B69DEC] hover:underline"
                href="https://www.tiktok.com/legal/page/global/bc-policy/en"
              >
                {t('branded_content_policy', 'Branded Content Policy')}
              </a>
            </>
          )}
          .
        </div>
      )}
    </div>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: TikTokSettings,
  comments: false,
  CustomPreviewComponent: TiktokPreview,
  dto: TikTokDto,
  maximumCharacters: 2000,
});
