'use client';

import { FC, MutableRefObject, useCallback, useMemo, useState } from 'react';
import * as fabric from 'fabric';
import { renderToStaticMarkup } from 'react-dom/server';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import {
  ICONS,
  ICON_CATEGORIES,
  IconCategory,
  IconManifestEntry,
} from '../icons-manifest';

interface IconsPanelProps {
  canvas: MutableRefObject<fabric.Canvas | null>;
}

const ICON_PREVIEW_SIZE = 24;
const ICON_CANVAS_SIZE = 120;

export const IconsPanel: FC<IconsPanelProps> = ({ canvas }) => {
  const t = useT();
  const { i18n } = useTranslation();
  const isPl = (i18n.resolvedLanguage ?? i18n.language ?? '')
    .toLowerCase()
    .startsWith('pl');
  const toaster = useToaster();
  const [category, setCategory] = useState<IconCategory>('reactions');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ICONS.filter((icon) => {
      const matchesCategory = q ? true : icon.category === category;
      const matchesQuery = q
        ? `${icon.label} ${icon.labelPl} ${icon.tags} ${icon.key}`
            .toLowerCase()
            .includes(q)
        : true;
      return matchesCategory && matchesQuery;
    });
  }, [category, query]);

  const addIcon = useCallback(
    async (entry: IconManifestEntry) => {
      if (!canvas.current) return;
      try {
        const IconComp = entry.component;
        const markup = renderToStaticMarkup(
          <IconComp
            size={ICON_CANVAS_SIZE}
            stroke={2}
            color="#ffffff"
          />
        );

        const result = await fabric.loadSVGFromString(markup);
        const obj = fabric.util.groupSVGElements(
          result.objects.filter((o): o is fabric.FabricObject => Boolean(o)),
          result.options
        );

        const c = canvas.current;
        const cw = c.getWidth() / c.getZoom();
        const ch = c.getHeight() / c.getZoom();
        obj.set({
          // Fabric v7 anchors objects by their CENTRE, so subtracting half the
          // size (v5 top-left maths) dropped every icon up and to the left of
          // where the user clicked. Anchor explicitly instead of relying on
          // whichever default is in force.
          originX: 'center',
          originY: 'center',
          left: cw / 2,
          top: ch / 2,
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
        });

        c.add(obj);
        c.setActiveObject(obj);
        c.renderAll();
      } catch {
        toaster.show(
          t('icon_add_failed', 'Could not add icon'),
          'warning'
        );
      }
    },
    [canvas, t, toaster]
  );

  return (
    <div className="flex flex-col gap-2 min-h-0 flex-1">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('icon_search_placeholder', 'Search icons…')}
        className="text-xs px-2 py-1.5 rounded bg-newColColor text-textColor border border-newBorder focus:outline-none focus:border-textColor/40"
      />

      {!query.trim() && (
        <div className="flex flex-wrap gap-1">
          {ICON_CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={clsx(
                'text-[11px] px-2 py-1 rounded transition-colors',
                category === c.key
                  ? 'bg-newAccent text-[#06222e] font-[600]'
                  : 'bg-newColColor text-textColor/70 hover:text-textColor'
              )}
            >
              {t(c.labelKey, c.fallback)}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-1 flex-1 overflow-y-auto pr-1">
        {filtered.map((entry) => {
          const IconComp = entry.component;
          return (
            <button
              key={entry.key}
              onClick={() => addIcon(entry)}
              title={isPl ? entry.labelPl : entry.label}
              className="aspect-square flex items-center justify-center rounded bg-newColColor hover:bg-white/[0.08] text-textColor hover:text-white transition-colors"
            >
              <IconComp size={ICON_PREVIEW_SIZE} stroke={2} />
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-4 text-center text-[11px] text-textColor/65 py-4">
            {t('icon_no_results', 'No results')}
          </div>
        )}
      </div>
    </div>
  );
};
