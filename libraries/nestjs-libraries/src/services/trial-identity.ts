import { createHash } from 'crypto';

// The mark a trial leaves on its Stripe customer for the email it was started
// with: a hash, so the mark does not repeat the address, and the same for every
// spelling of one inbox, so `Name+2@` or a Gmail address with dots added does
// not count as new.
export const trialEmailKey = (email?: string | null) => {
  const address = (email || '').trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at < 1 || at === address.length - 1) {
    return null;
  }
  let local = address.slice(0, at).split('+')[0];
  let domain = address.slice(at + 1);
  if (domain === 'googlemail.com') {
    domain = 'gmail.com';
  }
  if (domain === 'gmail.com') {
    local = local.replace(/\./g, '');
  }
  if (!local) {
    return null;
  }
  return createHash('sha256').update(`${local}@${domain}`).digest('hex');
};
