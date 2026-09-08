'use client';

import { FC } from 'react';
import {
  IconAspectRatio,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCopy,
  IconDeviceFloppy,
  IconDownload,
  IconLayoutCollage,
  IconMessageCircle,
  IconMovie,
  IconPalette,
  IconPhoto,
  IconPhotoPlus,
  IconPointer,
  IconScissors,
  IconShape,
  IconSlideshow,
  IconSparkles,
  IconStar,
  IconTarget,
  IconTemplate,
  IconTextSize,
  IconTrash,
  IconTypography,
  IconVideo,
  IconWand,
  IconX,
} from '@tabler/icons-react';

/**
 * Studio's chrome was built out of emoji: the tool rail, the action bar, the
 * video tabs and the goal cards. Emoji render differently on every OS, ignore
 * `currentColor`, cannot be sized reliably, and sat next to typographic glyphs
 * (an arrow, a "T", a hollow square) in the same column - two visual languages
 * in one strip.
 *
 * Tabler is already a dependency (Studio uses it for the icons you can place
 * *on* the canvas). One set, one stroke weight, one size, inheriting colour.
 * Emoji stay where they belong: inside the designs a user makes.
 */
export type StudioIconName =
  | 'aiGenerate'
  | 'aiRefine'
  | 'templates'
  | 'stock'
  | 'brand'
  | 'select'
  | 'text'
  | 'shapes'
  | 'icons'
  | 'images'
  | 'undo'
  | 'redo'
  | 'delete'
  | 'save'
  | 'saveTemplate'
  | 'download'
  | 'formats'
  | 'carousel'
  | 'duplicate'
  | 'close'
  | 'goals'
  | 'trim'
  | 'captions'
  | 'brollStock'
  | 'textOnVideo'
  | 'photosToVideo'
  | 'graphics'
  | 'video';

const MAP: Record<StudioIconName, FC<{ size?: number; stroke?: number; className?: string }>> = {
  aiGenerate: IconSparkles,
  aiRefine: IconWand,
  templates: IconTemplate,
  stock: IconPhoto,
  brand: IconPalette,
  select: IconPointer,
  text: IconTypography,
  shapes: IconShape,
  icons: IconStar,
  images: IconPhotoPlus,
  undo: IconArrowBackUp,
  redo: IconArrowForwardUp,
  delete: IconTrash,
  save: IconDeviceFloppy,
  saveTemplate: IconStar,
  download: IconDownload,
  formats: IconAspectRatio,
  carousel: IconLayoutCollage,
  duplicate: IconCopy,
  close: IconX,
  goals: IconTarget,
  trim: IconScissors,
  captions: IconMessageCircle,
  brollStock: IconMovie,
  textOnVideo: IconTextSize,
  photosToVideo: IconSlideshow,
  graphics: IconPalette,
  video: IconVideo,
};

export const StudioIcon: FC<{
  name: StudioIconName;
  size?: number;
  className?: string;
}> = ({ name, size = 18, className }) => {
  const Cmp = MAP[name];
  return <Cmp size={size} stroke={1.75} className={className} />;
};
