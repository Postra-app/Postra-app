import { BadRequestException } from '@nestjs/common';

// A page or account id picked in the client goes into a platform API path
// with the user's token. Platform ids are numeric: anything else is refused,
// and the id used is rebuilt from the number, so no path or query characters
// can ride along with it (CodeQL js/request-forgery #73/#74).
export const numericId = (value: unknown): string => {
  const raw = String(value ?? '');
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestException('Invalid page');
  }
  return BigInt(raw).toString();
};
