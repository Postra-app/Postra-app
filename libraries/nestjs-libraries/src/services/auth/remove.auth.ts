import { Response } from 'express';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';

// Clears the session cookie. Lives in the library because the global
// exception filter calls it; it used to be imported from the backend app,
// which made the library depend on the app (and close a cycle with the auth
// middleware).
export const removeAuth = (res: Response) => {
  res.cookie('auth', '', {
    domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
    ...(!process.env.NOT_SECURED
      ? {
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
        }
      : {}),
    expires: new Date(0),
    maxAge: -1,
  });
  res.header('logout', 'true');
};
