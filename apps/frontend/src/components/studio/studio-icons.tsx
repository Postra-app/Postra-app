'use client';

import { FC } from 'react';
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconAspectRatio,
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconKeyboard,
  IconChevronUp,
  IconEye,
  IconEyeOff,
  IconLock,
  IconLockOpen,
  IconStack2,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCopy,
  IconBolt,
  IconBuildingStore,
  IconChartBar,
  IconBulb,
  IconConfetti,
  IconHeartHandshake,
  IconDeviceMobile,
  IconSpeakerphone,
  IconQuote,
  IconHeart,
  IconArrowRight,
  IconPentagon,
  IconHexagon,
  IconPlus,
  IconCircle,
  IconSquare,
  IconBoxMultiple,
  IconTriangle,
  IconLine,
  IconDiamond,
  IconCircleDot,
  IconRectangle,
  IconColorSwatch,
  IconCrop,
  IconEraser,
  IconDeviceFloppy,
  IconDownload,
  IconLayoutCollage,
  IconMessageCircle,
  IconMovie,
  IconPalette,
  IconPhoto,
  IconPhotoPlus,
  IconPencil,
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
  | 'video'
  | 'layers'
  | 'forward'
  | 'backward'
  | 'show'
  | 'hide'
  | 'lock'
  | 'unlock'
  | 'collapse'
  | 'shortcuts'
  | 'crop'
  | 'catPromo'
  | 'catQuote'
  | 'catAnnouncement'
  | 'catStats'
  | 'catTip'
  | 'catEvent'
  | 'catCommunity'
  | 'catReelCover'
  | 'shapeStar'
  | 'shapeHexagon'
  | 'shapeHeart'
  | 'shapeArrow'
  | 'shapeSpeech'
  | 'shapePentagon'
  | 'shapePlus'
  | 'shapeLightning'
  | 'shapeCircle'
  | 'shapeSquare'
  | 'shapeRect'
  | 'shapeTriangle'
  | 'shapeLine'
  | 'shapeDiamond'
  | 'shapeRing'
  | 'shapeParallelogram'
  | 'eraser'
  | 'gradient'
  | 'warning'
  | 'done'
  | 'camera'
  | 'edit'
  | 'moveUp'
  | 'moveDown';

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
  warning: IconAlertTriangle,
  done: IconCheck,
  camera: IconCamera,
  edit: IconPencil,
  moveUp: IconArrowUp,
  moveDown: IconArrowDown,
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
  layers: IconStack2,
  forward: IconChevronUp,
  backward: IconChevronDown,
  show: IconEye,
  hide: IconEyeOff,
  lock: IconLock,
  unlock: IconLockOpen,
  collapse: IconChevronLeft,
  shortcuts: IconKeyboard,
  crop: IconCrop,
  catPromo: IconBuildingStore,
  catQuote: IconQuote,
  catAnnouncement: IconSpeakerphone,
  catStats: IconChartBar,
  catTip: IconBulb,
  catEvent: IconConfetti,
  catCommunity: IconHeartHandshake,
  catReelCover: IconDeviceMobile,
  shapeStar: IconStar,
  shapeHexagon: IconHexagon,
  shapeHeart: IconHeart,
  shapeArrow: IconArrowRight,
  shapeSpeech: IconMessageCircle,
  shapePentagon: IconPentagon,
  shapePlus: IconPlus,
  shapeLightning: IconBolt,
  shapeCircle: IconCircle,
  shapeSquare: IconSquare,
  shapeRect: IconRectangle,
  shapeTriangle: IconTriangle,
  shapeLine: IconLine,
  shapeDiamond: IconDiamond,
  shapeRing: IconCircleDot,
  shapeParallelogram: IconBoxMultiple,
  eraser: IconEraser,
  gradient: IconColorSwatch,
};

export const StudioIcon: FC<{
  name: StudioIconName;
  size?: number;
  className?: string;
}> = ({ name, size = 18, className }) => {
  const Cmp = MAP[name];
  return <Cmp size={size} stroke={1.75} className={className} />;
};
