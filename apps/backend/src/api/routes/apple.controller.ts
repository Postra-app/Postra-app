import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppleIapService } from '@gitroom/nestjs-libraries/services/apple/apple.iap.service';

/**
 * App Store Server Notifications (version 2). Public, like the Stripe
 * webhook: the body is `{ signedPayload }`, a JWS that only Apple can have
 * signed, and anything else is answered 400.
 *
 * Apple delivers again on any answer but 200, for up to three days.
 */
@ApiTags('Apple')
@Controller('/apple')
export class AppleController {
  constructor(private readonly _appleIapService: AppleIapService) {}

  @Post('/notifications')
  @HttpCode(200)
  notifications(@Body() body: { signedPayload?: unknown }) {
    const signedPayload =
      typeof body?.signedPayload === 'string' ? body.signedPayload : '';
    return this._appleIapService.notify(signedPayload);
  }
}
