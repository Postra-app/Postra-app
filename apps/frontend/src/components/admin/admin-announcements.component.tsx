'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Input } from '@gitroom/react/form/input';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import {
  AdminButton as Button,
  adminInput,
  deleteOutcome,
} from './admin-ui';

/**
 * Two states per option, and the text has to stay readable in both.
 *
 * The old version painted a solid fill with white text and dimmed the
 * unchosen options with `opacity-70`, which drags the label down with the
 * background: "Warning (Amber)" measured 3.19:1 on production against the
 * 4.5:1 floor (E2E-09-55, missed by the first pass). White on amber never had
 * the headroom to survive being dimmed, so the chosen option now carries dark
 * text on the solid fill and the unchosen ones use the tinted-fill pattern the
 * rest of the panel already uses — no opacity on text either way.
 */
const colorOptions = [
  {
    value: 'INFO',
    label: 'Info (Blue)',
    selected: 'bg-blue-500 text-[#06121e]',
    idle: 'bg-blue-500/15 text-blue-300 border border-blue-500/40',
  },
  {
    value: 'WARNING',
    label: 'Warning (Amber)',
    selected: 'bg-amber-400 text-[#1c1206]',
    idle: 'bg-amber-500/15 text-amber-300 border border-amber-500/40',
  },
  {
    value: 'ERROR',
    label: 'Error (Red)',
    selected: 'bg-red-500 text-[#1d0707]',
    idle: 'bg-red-500/15 text-red-300 border border-red-500/40',
  },
];

const colorBadges: Record<string, string> = {
  INFO: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  WARNING: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  ERROR: 'bg-red-500/20 text-red-400 border-red-500/30',
};

interface Announcement {
  id: string;
  title: string;
  description: string;
  color: string;
  createdAt: string;
  expiresAt: string | null;
}

interface AnnouncementList {
  items: Announcement[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

const PAGE_SIZE = 20;

export const AdminAnnouncementsComponent = () => {
  const fetch = useFetch();
  const t = useT();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('INFO');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [deleteError, setDeleteError] = useState<
    'failed' | 'already-gone' | null
  >(null);
  const [expiresAt, setExpiresAt] = useState('');
  const [page, setPage] = useState(0);

  // The panel reads its own paged route, not the banner's. GET /announcements
  // answers what a session should be shown — live entries only, capped — so
  // using it here hid expired entries from the one person who needs to see
  // them (E2E-09-26).
  const {
    data: list,
    error: listError,
    isLoading,
    mutate,
  } = useSWR<AnnouncementList>(
    `/announcements/list-${page}`,
    useCallback(async () => {
      const res = await fetch(
        `/announcements/list?page=${page}&limit=${PAGE_SIZE}`
      );
      if (!res.ok) throw new Error('Failed to load announcements');
      return res.json();
    }, [fetch, page]),
    { revalidateOnFocus: false }
  );

  const announcements = list?.items;
  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.limit)) : 1;

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || !description.trim()) return;
    setSaving(true);
    setSuccess(false);
    setSubmitError(false);
    try {
      const res = await fetch('/announcements', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          color,
          // Sent as an instant, not a day: the input is local time and the
          // banner compares against now on the server.
          ...(expiresAt
            ? { expiresAt: new Date(expiresAt).toISOString() }
            : {}),
        }),
      });
      if (!res.ok) {
        setSubmitError(true);
        return;
      }
      await mutate();
      setTitle('');
      setDescription('');
      setColor('INFO');
      setExpiresAt('');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setSubmitError(true);
    } finally {
      setSaving(false);
    }
  }, [title, description, color, expiresAt, mutate]);

  const handleDelete = useCallback(
    async (announcement: Announcement) => {
      if (
        !(await deleteDialog(
          t(
            'admin_delete_announcement_confirm',
            'This will remove the announcement for all users.'
          ),
          t('admin_delete', 'Delete')
        ))
      ) {
        return;
      }
      const res = await fetch(`/announcements/${announcement.id}`, {
        method: 'DELETE',
      });
      // A failed delete used to do nothing at all — no refresh, no message —
      // so the announcement stayed on screen and the operator could not tell
      // whether it had gone (E2E-09-14).
      const body = await res.json().catch(() => null);
      const outcome = deleteOutcome(res.ok, body);
      if (outcome === 'failed') {
        setDeleteError('failed');
        return;
      }
      setDeleteError(outcome === 'already-gone' ? 'already-gone' : null);
      await mutate();
    },
    [mutate, t]
  );

  return (
    <div className="flex flex-col gap-[20px] max-w-[640px]">
      <h2 className="text-[20px] font-[600]">
        {t('admin_announcements', 'Announcements')}
      </h2>

      <Input
        label={t('admin_announcement_title', 'Title')}
        name="title"
        disableForm={true}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('admin_announcement_title_placeholder', 'Announcement title')}
      />

      <div className="flex flex-col gap-[6px]">
        <label className="text-[14px]">
          {t('admin_announcement_description', 'Description')}
        </label>
        <textarea
          className="bg-input border border-tableBorder rounded-[8px] p-[10px] text-newTextColor min-h-[120px] outline-none resize-y"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t(
            'admin_announcement_description_placeholder',
            'Announcement description'
          )}
        />
      </div>

      <div className="flex flex-col gap-[6px]">
        <span id="admin-announcement-color" className="text-[14px]">
          {t('admin_announcement_color', 'Color')}
        </span>
        {/* A radio group, not three divs with onClick: as divs they took no
            focus, answered no keyboard, and said nothing about which one was
            chosen (E2E-09-13). */}
        <div
          role="radiogroup"
          aria-labelledby="admin-announcement-color"
          className="flex gap-[8px]"
        >
          {colorOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={color === opt.value}
              onClick={() => setColor(opt.value)}
              className={`flex-1 text-center py-[8px] rounded-[8px] text-[13px] font-[500] cursor-pointer transition-colors ${
                color === opt.value
                  ? `${opt.selected} ring-2 ring-white/70`
                  : opt.idle
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-[6px]">
        <span className="text-[14px]">
          {t('admin_announcement_expires', 'Stops showing (optional)')}
        </span>
        <input
          type="datetime-local"
          className={adminInput}
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
        <span className="text-[12px] text-newTextColor/60">
          {t(
            'admin_announcement_expires_note',
            'Leave empty and it shows until somebody deletes it.'
          )}
        </span>
      </label>

      <div className="flex items-center gap-[12px]">
        <Button
          onClick={handleSubmit}
          loading={saving}
          disabled={!title.trim() || !description.trim()}
          className="rounded-[8px]"
        >
          {t('admin_create_announcement', 'Create Announcement')}
        </Button>
        {success && (
          <span className="text-green-400 text-[13px]">
            {t('admin_announcement_created', 'Announcement created successfully')}
          </span>
        )}
        {submitError && (
          <span className="text-red-400 text-[13px]">
            {t('admin_announcement_create_failed', 'Failed to create announcement')}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-[10px] mt-[10px]">
        <h3 className="text-[15px] font-[600]">
          {t('admin_existing_announcements', 'Existing announcements')}
        </h3>
        {isLoading && (
          <span className="text-[13px] text-newTextColor/70">
            {t('admin_loading', 'Loading...')}
          </span>
        )}
        {listError && (
          <span className="text-[13px] text-red-400">
            {t('admin_announcements_load_failed', 'Failed to load announcements.')}
          </span>
        )}
        {deleteError === 'failed' && (
          <span className="text-[13px] text-red-400" role="alert">
            {t(
              'admin_announcement_delete_failed',
              'Failed to delete announcement — it is still visible to users.'
            )}
          </span>
        )}
        {deleteError === 'already-gone' && (
          <span className="text-[13px] text-amber-300" role="alert">
            {t(
              'admin_announcement_delete_already_gone',
              'That announcement was already gone. The list is up to date.'
            )}
          </span>
        )}
        {!isLoading && !listError && announcements?.length === 0 && (
          <span className="text-[13px] text-newTextColor/70">
            {t('admin_no_announcements', 'No announcements yet')}
          </span>
        )}
        {announcements?.map((a) => (
          <div
            key={a.id}
            className="flex items-start gap-[12px] rounded-[8px] border border-white/10 bg-white/[0.03] p-[12px]"
          >
            <div className="flex flex-col gap-[4px] flex-1 min-w-0">
              <div className="flex items-center gap-[8px]">
                <span
                  className={`inline-block px-[8px] py-[2px] rounded-[6px] text-[11px] font-[500] border ${
                    colorBadges[a.color] ?? colorBadges.INFO
                  }`}
                >
                  {a.color}
                </span>
                <span className="text-[14px] font-[500] truncate">
                  {a.title}
                </span>
              </div>
              <span className="text-[13px] text-newTextColor/60 break-words">
                {a.description}
              </span>
              <span className="text-[11px] text-newTextColor/70">
                {new Date(a.createdAt).toLocaleString()}
                {a.expiresAt &&
                  ` · ${
                    new Date(a.expiresAt) <= new Date()
                      ? t('admin_announcement_expired', 'expired')
                      : t('admin_announcement_expires_at', 'stops')
                  } ${new Date(a.expiresAt).toLocaleString()}`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(a)}
              className="px-[12px] h-[30px] rounded-[8px] text-[12px] border border-red-500/30 text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors shrink-0"
            >
              {t('admin_delete', 'Delete')}
            </button>
          </div>
        ))}

        {!!list && totalPages > 1 && (
          <div className="flex items-center justify-between text-[13px] pt-[4px]">
            <span className="text-newTextColor/60">
              {t('admin_page', 'Page')} {page + 1} / {totalPages} ({list.total}{' '}
              {t('admin_total', 'total')})
            </span>
            <div className="flex gap-[8px]">
              <button
                type="button"
                disabled={page <= 0}
                onClick={() => setPage((p) => p - 1)}
                className="px-[14px] h-[34px] rounded-[10px] text-[13px] border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                {t('admin_prev', 'Prev')}
              </button>
              <button
                type="button"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="px-[14px] h-[34px] rounded-[10px] text-[13px] border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                {t('admin_next', 'Next')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
