'use client';

import { Tooltip } from 'react-tooltip';

// Close on click as well as on leave: a click that opens a dialog on top of
// the anchor never produced a mouseleave, so the tooltip (z-200, above the
// dialogs) hung over the dialog's text — the Instagram tile's hint sat on the
// Meta checklist's heading.
export const ToolTip = () => {
  return (
    <Tooltip
      className="z-[200]"
      id="tooltip"
      closeEvents={{ mouseleave: true, blur: true, click: true }}
      globalCloseEvents={{ escape: true }}
    />
  );
};
