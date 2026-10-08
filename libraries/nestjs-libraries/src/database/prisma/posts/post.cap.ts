import dayjs from 'dayjs';
import { saveTypeOfPost } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';

// A publish date a post can be saved on: a date, within a hundred years. The
// database cannot hold some years, and the monthly count treats a date it
// cannot place as now, while the post would be saved on the far date (Codex).
export const isPostDate = (date: unknown): boolean =>
  (typeof date === 'string' || date instanceof Date) &&
  dayjs(date).isValid() &&
  Math.abs(dayjs(date).year() - dayjs().year()) <= 100;

// A post against the monthly allowance: an id when it already exists (an
// edit), the date it is saved on, and whether the save keeps its state
// (type 'update'), which leaves a draft or a failed post out of the count.
export type CountedPost = { id?: string; date?: string; keepsState?: boolean };

// The allowance of an organisation's plan: posts a month, in billing months
// counted from the anchor.
export type PostCap = { anchor: Date | string; limit: number };

const validDate = (d: unknown): d is string =>
  typeof d === 'string' && !Number.isNaN(Date.parse(d));

// Every channel and every thread part of a save is a post against the cap,
// except the channels kept as drafts. Each counts on the date it is saved on
// ("now" posts on this one); `perPostDate` is off for the public API, which
// keeps one date per request.
export const postsCountedBy = (
  body: any,
  perPostDate: boolean,
  typeOf: (post: any) => unknown = (post) => saveTypeOfPost(body, post)
): CountedPost[] =>
  (Array.isArray(body?.posts) ? body.posts : [])
    .filter((post: any) => typeOf(post) !== 'draft')
    .flatMap((post: any) => {
      const kind = typeOf(post);
      const date =
        kind === 'now'
          ? new Date().toISOString()
          : [perPostDate ? post?.date : undefined, body?.date].find(validDate);
      return (Array.isArray(post?.value) ? post.value : []).map(
        (value: any) => ({
          id: typeof value?.id === 'string' && value.id ? value.id : undefined,
          date,
          keepsState: kind === 'update',
        })
      );
    });

// Existing posts a save keeps as drafts: they leave the count as the save's
// other posts join it, so a save at a full month that swaps one for another
// fits (Codex).
export const postsReleasedBy = (
  body: any,
  typeOf: (post: any) => unknown = (post) => saveTypeOfPost(body, post)
): string[] =>
  (Array.isArray(body?.posts) ? body.posts : [])
    .filter((post: any) => typeOf(post) === 'draft')
    .flatMap((post: any) => (Array.isArray(post?.value) ? post.value : []))
    .map((value: any) => value?.id)
    .filter((id: unknown): id is string => typeof id === 'string' && !!id);
