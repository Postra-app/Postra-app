import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';

// The campaign fields of a sign-up are cleaned, never refused: a strange
// value in a link must not cost a sign-up.
const signUp = (extra: object) =>
  plainToInstance(CreateOrgUserDto, {
    email: 'owner@example.com',
    password: 'a-long-enough-password-1',
    company: 'Example Ltd',
    provider: 'LOCAL',
    termsAccepted: true,
    ...extra,
  });

describe('campaign fields of a sign-up', () => {
  it('keeps good values, lower-cased', () => {
    const dto = signUp({
      signupSource: 'Facebook',
      signupMedium: 'cpc',
      signupCampaign: 'launch-week',
    });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.signupSource).toBe('facebook');
    expect(dto.signupMedium).toBe('cpc');
    expect(dto.signupCampaign).toBe('launch-week');
  });

  it('drops a bad value and still accepts the sign-up', () => {
    const dto = signUp({
      signupSource: 'https://example.com/?fbclid=abc',
      signupMedium: 'x'.repeat(65),
      signupCampaign: { $gt: '' },
    });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.signupSource).toBeUndefined();
    expect(dto.signupMedium).toBeUndefined();
    expect(dto.signupCampaign).toBeUndefined();
  });

  it('is fine without them', () => {
    expect(validateSync(signUp({}))).toEqual([]);
  });
});
