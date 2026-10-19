import { ReactNode } from 'react';

const URL_PATTERN =
  /(\bhttps?:\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/gi;

// Notifications are plain text: anything in them that looks like markup is
// shown as written, never parsed (upstream f1a24b5fa). Links become anchors
// whose label drops the scheme and "www.", so a long post URL reads as
// "x.com/postra/status/…" instead of filling the popup.
export const notificationParts = (text: string): ReactNode[] =>
  text.split(URL_PATTERN).map((part, index) => {
    if (index % 2 === 0) {
      return part;
    }
    return (
      <a
        key={index}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        title={part}
        className="cursor-pointer underline font-bold inline-block max-w-full truncate align-bottom"
      >
        {part.replace(/^https?:\/\/(www\.)?/i, '')}
      </a>
    );
  });
