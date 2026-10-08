import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import { sanitizePostContent } from '@gitroom/helpers/utils/sanitize.post.content';
import { safeJsonParse } from '@gitroom/helpers/utils/safe.json.parse';
// NOTE: stays force-dynamic — internalFetch reads cookies(), which forbids
// ISR. If a preview link ever goes viral, add Redis caching on the backend
// /public/posts/:id route instead.
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
import SafeImage from '@gitroom/react/helpers/safe.image';
import Link from 'next/link';
import { CommentsComponents } from '@gitroom/frontend/components/preview/comments.components';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { VideoOrImage } from '@gitroom/react/helpers/video.or.image';
import { CopyClient } from '@gitroom/frontend/components/preview/copy.client';
import { ClosePreviewButton } from '@gitroom/frontend/components/preview/close.preview.button';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
import { RenderPreviewDateClient } from '@gitroom/frontend/components/preview/render.preview.date.client';
import { CreationMethodBadge } from '@gitroom/frontend/components/launches/creation.method.badge';

dayjs.extend(utc);
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postra' : 'Gitroom'} Preview`,
  description: '',
};

// The backend is unreachable for a minute or two on every deploy (single EC2,
// no blue-green — a deliberate pre-revenue trade-off), and `internalFetch` has
// no `afterRequest` hook, so the ALB's 502 HTML page reached `.json()` here and
// took down the whole Server Components render: a public preview link answered
// with the generic "Something went wrong" boundary. Degrade to the same message
// the browser-side 5xx handler shows (layout.context.tsx) instead.
// Returns null when the backend could not answer, otherwise the (possibly
// empty) list of posts.
const loadPreview = async (id: string): Promise<any[] | null> => {
  try {
    const response = await internalFetch(`/public/posts/${id}`);
    if (response.status >= 500) {
      // eslint-disable-next-line no-console
      console.error(
        `[Postra:preview] /public/posts/${id} -> ${response.status}`
      );
      return null;
    }
    // A non-5xx answer that isn't a JSON list means "nothing to show" rather
    // than "come back later" — a missing post is an empty array with a 200.
    const body = await response.json().catch(() => null);
    return Array.isArray(body) ? body : [];
  } catch (e) {
    // Connection refused or timed out while the container restarts.
    // eslint-disable-next-line no-console
    console.error(`[Postra:preview] /public/posts/${id} failed`, e);
    return null;
  }
};
export default async function Auth(props: {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    share?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const { id } = params;

  const post = await loadPreview(id);
  const t = await getT();
  if (!post) {
    return (
      <div className="text-white fixed start-0 top-0 w-full h-full flex flex-col gap-[10px] justify-center items-center text-center px-[24px]">
        <div className="text-[20px]">
          {t('preview_unavailable', 'Preview unavailable')}
        </div>
        <div className="text-[14px] text-white/60">
          {t(
            'server_unavailable_try_again',
            'The server is temporarily unavailable — please try again in a moment.'
          )}
        </div>
      </div>
    );
  }
  if (!post.length) {
    return (
      <div className="text-white fixed start-0 top-0 w-full h-full flex justify-center items-center text-[20px]">
        {t('post_not_found', 'Post not found')}
      </div>
    );
  }
  // The channel can be disconnected after a post was published — the calendar
  // still offers a public "Preview" link for it, so integration may be null on
  // this shareable, unauthenticated page. Fall back instead of crashing.
  const integration = post[0].integration ?? {
    name: t('removed_channel', 'Removed channel'),
    picture: '',
    providerIdentifier: '',
    profile: '',
  };
  return (
    <div>
      <div className="mx-auto w-full max-w-[1346px] py-3 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className="min-w-[55px]">
                <Link
                  href="/"
                  className="text-2xl flex items-center justify-center gap-[10px] text-textColor order-1"
                >
                  <div className="max-w-[55px]">
                    <SafeImage
                      src={'/postra-icon.webp'}
                      width={55}
                      height={55}
                      alt="Postra"
                      className="rounded-[14px]"
                    />
                  </div>
                  <div>
                    <SafeImage
                      src={'/postra-logo.webp'}
                      width={120}
                      height={40}
                      alt="Postra"
                      className="h-auto w-[120px]"
                    />
                  </div>
                </Link>
              </div>
            </div>
          </div>
          <div className="text-sm text-gray-400 flex items-center gap-[20px]">
            {!!searchParams?.share && (
              <>
                <div>
                  <CopyClient />
                </div>
                <ClosePreviewButton />
              </>
            )}
            <div className="flex-1">
              {t('publication_date', 'Publication Date:')}{' '}
              <RenderPreviewDateClient date={post[0].publishDate} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row text-white w-full max-w-[1346px] mx-auto">
        <div className="flex-1">
          <div className="gap-[20px] flex flex-col">
            {post.map((p: any, index: number) => (
              <div
                key={String(p.id)}
                className="relative px-4 py-4 bg-third border border-tableBorder"
              >
                <div className="flex space-x-3">
                  <div>
                    <div className="flex shrink-0 rounded-full h-30 w-30 relative">
                      <div className="w-[50px] h-[50px] z-[20]">
                        <img
                          className="w-full h-full relative z-[20] bg-black aspect-square rounded-full border-tableBorder"
                          alt={integration.name}
                          src={integration.picture}
                        />
                      </div>
                      <div className="absolute -end-[5px] -bottom-[5px] w-[30px] h-[30px] z-[20]">
                        <img
                          className="w-full h-full bg-black aspect-square rounded-full border-tableBorder"
                          alt={integration.providerIdentifier}
                          src={`/icons/platforms/${integration.providerIdentifier}.png`}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center space-x-2">
                      <h2 className="text-sm font-semibold">
                        {integration.name}
                      </h2>
                      <span className="text-sm text-gray-500">
                        @{integration.profile}
                      </span>
                      {/* How the post was made is for the team, not the
                          client opening the shared link. */}
                      {index === 0 && !!searchParams?.share && (
                        <CreationMethodBadge
                          creationMethod={p.creationMethod}
                          size="md"
                        />
                      )}
                    </div>
                    <div className="flex flex-col gap-[20px]">
                      <div
                        className="text-sm whitespace-pre-wrap"
                        dangerouslySetInnerHTML={{
                          __html: sanitizePostContent(p.content),
                        }}
                      />
                      <div className="flex w-full gap-[10px]">
                        {safeJsonParse<any[]>(p?.image, []).map((p: any) => (
                          <div
                            key={p.name}
                            className="flex-1 rounded-[10px] max-h-[500px] overflow-hidden"
                          >
                            <VideoOrImage
                              isContain={true}
                              src={p.path}
                              autoplay={true}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="w-full lg:w-96 lg:flex-shrink-0">
          <div className="p-4 pt-0">
            <CommentsComponents postId={id} />
          </div>
        </div>
      </div>
    </div>
  );
}
