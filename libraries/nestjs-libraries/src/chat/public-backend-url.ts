// NEXT_PUBLIC_BACKEND_URL carries a path (https://app.postra.pl/api), which
// `new URL('/x', base)` throws away (E2E-08-45).
export const publicBackendUrl = (path: string) =>
  `${(process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '')}${path}`;
