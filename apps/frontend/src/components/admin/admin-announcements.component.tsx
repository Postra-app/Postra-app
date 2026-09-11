'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Input } from '@gitroom/react/form/input';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { AdminButton as Button } from './admin-ui';

const colorOptions = [
  { value: 'INFO', label: 'Info (Blue)', className: 'bg-blue-600' },
  { value: 'WARNING', label: 'Warning (Amber)', className: 'bg-amber-600' },
  { value: 'ERROR', label: 'Error (Red)', className: 'bg-red-600' },
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
}

export const AdminAnnouncementsComponent = () => {
  const fetch = useFetch();
  const t = useT();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('INFO');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  const {
    data: announcements,
    error: listError,
    isLoading,
    mutate,
  } = useSWR<Announcement[]>(
    '/announcements',
    useCallback(
      async (url: string) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load announcements');
        return res.json();
      },
      [fetch]
    ),
    { revalidateOnFocus: false }
  );

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || !description.trim()) return;
    setSaving(true);
    setSuccess(false);
    setSubmitError(false);
    try {
      const res = await fetch('/announcements', {
        method: 'POST',
        body: JSON.stringify({ title, description, color }),
      });
      if (!res.ok) {
        setSubmitError(true);
        return;
      }
      await mutate();
      setTitle('');
      setDescription('');
      setColor('INFO');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setSubmitError(true);
    } finally {
      setSaving(false);
    }
  }, [title, description, color, mutate]);

  const handleDelete = useCallback(
    async (announcement: Announcement) => {
      if (
        !(await deleteDialog(
          t(
            'delete_announcement_confirm',
            'This will remove the announcement for all users.'
          ),
          t('delete', 'Delete')
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
      if (!res.ok) {
        setDeleteError(true);
        return;
      }
      setDeleteError(false);
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
        label={t('announcement_title', 'Title')}
        name="title"
        disableForm={true}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('announcement_title_placeholder', 'Announcement title')}
      />

      <div className="flex flex-col gap-[6px]">
        <label className="text-[14px]">
          {t('announcement_description', 'Description')}
        </label>
        <textarea
          className="bg-input border border-tableBorder rounded-[8px] p-[10px] text-newTextColor min-h-[120px] outline-none resize-y"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t(
            'announcement_description_placeholder',
            'Announcement description'
          )}
        />
      </div>

      <div className="flex flex-col gap-[6px]">
        <label className="text-[14px]">
          {t('announcement_color', 'Color')}
        </label>
        <div className="flex gap-[8px]">
          {colorOptions.map((opt) => (
            <div
              key={opt.value}
              onClick={() => setColor(opt.value)}
              className={`flex-1 text-center py-[8px] rounded-[8px] text-white text-[13px] cursor-pointer transition-opacity ${opt.className} ${
                color === opt.value
                  ? 'opacity-100 ring-2 ring-white'
                  : 'opacity-40'
              }`}
            >
              {opt.label}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-[12px]">
        <Button
          onClick={handleSubmit}
          loading={saving}
          disabled={!title.trim() || !description.trim()}
          className="rounded-[8px]"
        >
          {t('create_announcement', 'Create Announcement')}
        </Button>
        {success && (
          <span className="text-green-400 text-[13px]">
            {t('announcement_created', 'Announcement created successfully')}
          </span>
        )}
        {submitError && (
          <span className="text-red-400 text-[13px]">
            {t('announcement_create_failed', 'Failed to create announcement')}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-[10px] mt-[10px]">
        <h3 className="text-[15px] font-[600]">
          {t('existing_announcements', 'Existing announcements')}
        </h3>
        {isLoading && (
          <span className="text-[13px] text-newTextColor/40">
            {t('loading', 'Loading...')}
          </span>
        )}
        {listError && (
          <span className="text-[13px] text-red-400">
            {t('announcements_load_failed', 'Failed to load announcements.')}
          </span>
        )}
        {deleteError && (
          <span className="text-[13px] text-red-400" role="alert">
            {t(
              'announcement_delete_failed',
              'Failed to delete announcement — it is still visible to users.'
            )}
          </span>
        )}
        {!isLoading && !listError && announcements?.length === 0 && (
          <span className="text-[13px] text-newTextColor/40">
            {t('no_announcements', 'No announcements yet')}
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
              <span className="text-[11px] text-newTextColor/40">
                {new Date(a.createdAt).toLocaleString()}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(a)}
              className="px-[12px] h-[30px] rounded-[8px] text-[12px] border border-red-500/30 text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors shrink-0"
            >
              {t('delete', 'Delete')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
