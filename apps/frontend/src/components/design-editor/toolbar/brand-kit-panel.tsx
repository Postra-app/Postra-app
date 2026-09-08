'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/frontend/components/ui/button';
import { STUDIO_FONTS } from '../fonts';

interface BrandKit {
  logoPath: string | null;
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
  font: string;
  tone: string;
}

const DEFAULTS: BrandKit = {
  logoPath: null,
  primaryColor: '#38bdf8',
  secondaryColor: '#0a0e1a',
  textColor: '#ffffff',
  font: 'Geist',
  tone: 'professional',
};

const TONES = ['professional', 'friendly', 'bold', 'playful', 'minimal'];

export const BrandKitPanel: FC = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kit, setKit] = useState<BrandKit>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/brand-kit');
        if (!res.ok) return;
        const text = await res.text();
        if (!text) return;
        const data = JSON.parse(text);
        if (!cancelled && data) {
          setKit({
            logoPath: data.logoPath ?? null,
            primaryColor: data.primaryColor ?? DEFAULTS.primaryColor,
            secondaryColor: data.secondaryColor ?? DEFAULTS.secondaryColor,
            textColor: data.textColor ?? DEFAULTS.textColor,
            font: data.font ?? DEFAULTS.font,
            tone: data.tone ?? DEFAULTS.tone,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetch]);

  const persist = useDebouncedCallback(
    async (next: BrandKit) => {
      try {
        const res = await fetch('/brand-kit', {
          method: 'PUT',
          body: JSON.stringify(next),
        });
        // A rejected value (a half-typed "#38bd", say) came back 400 and
        // nothing said so, while the panel kept showing the new colour as if
        // it had been saved.
        if (res.ok) setSavedAt(Date.now());
        else {
          toaster.show(
            t(
              'brand_kit_save_rejected',
              "That value wasn't saved — colours need to be a full hex code like #38bdf8."
            ),
            'warning'
          );
        }
      } catch {
        toaster.show(t('brand_kit_save_failed', 'Failed to save brand kit'), 'warning');
      }
    },
    600,
    // Closing the panel within the debounce window (switching tools is one
    // click) used to drop the pending write and lose the edit silently.
    { flushOnExit: true }
  );

  const update = useCallback(
    <K extends keyof BrandKit>(key: K, value: BrandKit[K]) => {
      setKit((prev) => {
        const next = { ...prev, [key]: value };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const uploadLogo = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/media/upload-simple', {
          method: 'POST',
          body: formData,
        });
        const { path } = await res.json();
        update('logoPath', path);
      } catch {
        toaster.show(t('logo_upload_failed', 'Logo upload failed'), 'warning');
      } finally {
        setUploading(false);
      }
    },
    [fetch, toaster, t, update]
  );

  if (loading) {
    return (
      <div className="text-[11px] text-textColor/60">
        {t('brand_kit_loading', 'Loading brand kit…')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-textColor/60">
          {t('brand_kit', 'Brand Kit')}
        </span>
        {savedAt && (
          <span className="text-[9px] text-textColor/40">
            {t('saved', 'Saved')}
          </span>
        )}
      </div>

      <div className="rounded-md bg-forth/10 border border-forth/30 p-2.5 text-[11px] leading-relaxed text-textColor/85">
        <div className="font-semibold mb-1">
          {t('brand_kit_intro_title', 'What does Brand Kit do?')}
        </div>
        <p>
          {t(
            'brand_kit_intro_body',
            'Set once — every AI Generate design, template and video text comes out in these colours and font. The logo goes bottom-right on every AI graphic. Tone shapes the wording AI writes.'
          )}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <ColorRow
          label={t('color_primary', 'Primary')}
          hint={t('color_primary_hint', 'Accents: buttons, badges, highlights')}
          value={kit.primaryColor}
          onChange={(v) => update('primaryColor', v)}
        />
        <ColorRow
          label={t('color_secondary', 'Background')}
          hint={t('color_secondary_hint', 'The canvas behind your designs')}
          value={kit.secondaryColor}
          onChange={(v) => update('secondaryColor', v)}
        />
        <ColorRow
          label={t('color_text', 'Text')}
          hint={t('color_text_hint', 'Headlines and body copy')}
          value={kit.textColor}
          onChange={(v) => update('textColor', v)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-textColor/60">{t('font', 'Font')}</label>
        <select
          value={kit.font}
          onChange={(e) => update('font', e.target.value)}
          className="text-xs px-2 py-1.5 rounded bg-newColColor border border-newBorder text-textColor focus:outline-none focus:border-forth"
        >
          {STUDIO_FONTS.map((font) => (
            <option
              key={font.key}
              value={font.label}
              style={{ fontFamily: font.family }}
            >
              {font.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-textColor/60">{t('tone', 'Tone')}</label>
        <select
          value={kit.tone}
          onChange={(e) => update('tone', e.target.value)}
          className="text-xs px-2 py-1 rounded bg-newColColor border border-newBorder text-textColor focus:outline-none focus:border-forth"
        >
          {TONES.map((tone) => (
            <option key={tone} value={tone}>
              {t(`tone_${tone}`, tone)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-textColor/60">{t('logo', 'Logo')}</label>
        {kit.logoPath ? (
          <div className="flex items-center gap-2">
            <img
              src={kit.logoPath}
              alt={t('brand_logo_alt', 'Brand logo')}
              className="w-12 h-12 object-contain rounded bg-black/30 p-1"
            />
            <Button
              onClick={() => update('logoPath', null)}
              className="!h-[28px] !text-[10px]"
              secondary={true}
            >
              {t('remove', 'Remove')}
            </Button>
          </div>
        ) : (
          <>
            <Button
              loading={uploading}
              onClick={() => fileRef.current?.click()}
              className="!h-[30px] !text-xs"
              secondary={true}
            >
              {uploading
                ? t('uploading', 'Uploading…')
                : t('upload_logo', 'Upload logo')}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadLogo(file);
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>

      <p className="text-[10px] text-textColor/40 leading-snug">
        {t(
          'brand_kit_hint',
          'Saved automatically. AI generates designs using these colours, font and tone.'
        )}
      </p>
    </div>
  );
};

const ColorRow: FC<{
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}> = ({ label, hint, value, onChange }) => (
  <div className="flex items-center gap-2">
    <div className="relative w-9 h-9 shrink-0">
      <div
        className="absolute inset-0 rounded-md border border-newBorder shadow-inner pointer-events-none"
        style={{ backgroundColor: value }}
      />
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        aria-label={label}
        title={label}
      />
    </div>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-20 min-w-0 text-xs px-2 py-1 rounded bg-newColColor border border-newBorder text-textColor focus:outline-none focus:border-forth font-mono"
    />
    <div className="flex-1 min-w-0 flex flex-col text-right">
      <span className="text-[10px] text-textColor/80">{label}</span>
      <span className="text-[9px] text-textColor/45 leading-tight">{hint}</span>
    </div>
  </div>
);
