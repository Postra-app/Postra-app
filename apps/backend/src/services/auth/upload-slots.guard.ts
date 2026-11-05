import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

// upload-simple (and the other routes that take the file in the request)
// hold the whole body in memory: multer's memory storage, up to the 220 MB
// nginx lets through for Studio's video exports. A few accounts sending
// several such bodies at once could take the app instance down. A guard
// runs before the file interceptor, so a refused request is never read.
//
// Small bodies (a photo, a design export) pass freely; a large one needs a
// slot: two at a time per organisation, four on the instance.
export const SMALL_BODY_BYTES = 12 * 1024 * 1024;
export const SLOTS_PER_ORG = 2;
export const SLOTS_PER_INSTANCE = 4;

const inFlight = new Map<string, number>();
let total = 0;

export const uploadSlotsInUse = () => ({ total, perOrg: new Map(inFlight) });
// For tests: every slot free.
export const resetUploadSlots = () => {
  inFlight.clear();
  total = 0;
};

@Injectable()
export class UploadSlotsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const length = Number(request.headers?.['content-length']);
    // No length (a chunked body) counts as large.
    if (Number.isFinite(length) && length > 0 && length <= SMALL_BODY_BYTES) {
      return true;
    }
    const org: string = request.org?.id || 'unknown';
    const mine = inFlight.get(org) || 0;
    if (mine >= SLOTS_PER_ORG || total >= SLOTS_PER_INSTANCE) {
      response.setHeader?.('Retry-After', '10');
      throw new HttpException(
        'Another large upload is still in progress. Try again in a moment.',
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    inFlight.set(org, mine + 1);
    total++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      total = Math.max(0, total - 1);
      const left = (inFlight.get(org) || 1) - 1;
      if (left > 0) inFlight.set(org, left);
      else inFlight.delete(org);
    };
    // 'close' fires when the response ends or the client goes away.
    response.once?.('close', release);
    response.once?.('finish', release);
    return true;
  }
}
