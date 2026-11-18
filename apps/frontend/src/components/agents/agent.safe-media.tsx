'use client';

import React, { FC } from 'react';
import { isOwnMediaUrl } from '@gitroom/helpers/utils/own.media.url';
import { useVariables } from '@gitroom/react/helpers/variable.context';

// The assistant's answers are markdown, and what it writes can carry text it
// read from a post preview, a file name or a web page. An image from any host
// loads on its own, so its address could carry the conversation out without a
// click. Only our own media (the upload CDN, or this app) are shown; anything
// else stays text.
export const isChatMediaAllowed = (
  src: unknown,
  uploadDirectory: string,
  appOrigin: string
) =>
  typeof src === 'string' &&
  isOwnMediaUrl(src, {
    NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY: uploadDirectory,
    FRONTEND_URL: appOrigin,
  });

const appOrigin = () =>
  typeof window === 'undefined' ? '' : window.location.origin;

export const SafeChatImage: FC<{
  src?: unknown;
  alt?: string;
  children?: React.ReactNode;
}> = ({ src, alt }) => {
  const { uploadDirectory } = useVariables();
  if (!isChatMediaAllowed(src, uploadDirectory, appOrigin())) {
    return <span className="text-textColor/60">[{alt || 'image'}]</span>;
  }
  return (
    <img
      src={src as string}
      alt={alt || ''}
      className="max-w-full rounded-[8px]"
    />
  );
};
