import { noImageCredits } from './trial-limit-refusal';

// The 11th AI image of a trial was refused with "No image generation credits
// remaining for this billing cycle", the paid plan's wording, and the app
// offered nothing to do. A trial is told it is the trial's limit, what the
// plan has, and gets "End the trial now".
describe('no AI image credits left', () => {
  it('on a trial: the trial wording, flagged for "End the trial now"', () => {
    const refusal = noImageCredits({ isTrailing: true, subscription: { subscriptionTier: 'PRO' } } as any);
    expect(refusal.getStatus()).toBe(402);
    expect(refusal.getResponse()).toEqual({
      statusCode: 402,
      trial: true,
      message: 'Your free trial includes 10 AI images. Your Pro plan includes 200 AI images a month. End the trial to start your plan now.',
    });
  });

  it('tells the page whether this member can open Billing', () => {
    const member = noImageCredits({ isTrailing: true, subscription: { subscriptionTier: 'PRO' }, users: [{ role: 'USER' }] } as any);
    expect((member.getResponse() as any).canManageBillingUi).toBe(false);
    const owner = noImageCredits({ isTrailing: true, subscription: { subscriptionTier: 'PRO' }, users: [{ role: 'SUPERADMIN' }] } as any);
    expect((owner.getResponse() as any).canManageBillingUi).toBe(true);
  });

  it('on a paid plan: the plan wording, as before', () => {
    const refusal = noImageCredits({ isTrailing: false, subscription: { subscriptionTier: 'PRO' } } as any);
    expect(refusal.getStatus()).toBe(402);
    expect(refusal.getResponse()).toBe('No image generation credits remaining for this billing cycle');
  });
});
