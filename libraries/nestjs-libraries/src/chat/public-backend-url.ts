// NEXT_PUBLIC_BACKEND_URL carries a path (https://app.postra.co.uk/api), which
// `new URL('/x', base)` throws away.
export const publicBackendUrl = (path: string) =>
  `${(process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '')}${path}`;
