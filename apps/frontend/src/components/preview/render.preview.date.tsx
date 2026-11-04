'use client';

import { FC } from 'react';
import { fromUtc } from '@gitroom/frontend/components/layout/set.timezone';

export const RenderPreviewDate: FC<{ date: string }> = ({ date }) => {
  return <>{fromUtc(date).format('MMMM D, YYYY h:mm A')}</>;
};
