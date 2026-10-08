// The name a file had before upload, for the library search. Storage gives
// every file a random name, and the search looks at `originalName` only.
const MAX = 200;

const clean = (name: string) =>
  name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX);

export const originalNameFromUrl = (url: string, ext: string) => {
  let last = '';
  try {
    last = new URL(url).pathname.split('/').pop() || '';
  } catch {
    return `upload.${ext}`;
  }
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    // A bad escape: keep the name as written.
  }
  return clean(decoded) || `upload.${ext}`;
};

export const originalNameOfFile = (name?: string) => clean(name || '') || undefined;
