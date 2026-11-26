/**
 * @jest-environment jsdom
 */
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, text: string, values: Record<string, string | number> = {}) =>
    text.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(values[k] ?? '')),
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import {
  StartTrialButton,
  TrialEndedHeadline,
  TrialLimitsBox,
  TrialPriceLine,
} from './first.billing.trial';

afterEach(cleanup);

// The trial starts without a card (sign-ups stopped at the card form), and
// its smaller limits are said plainly before it starts.
describe('the plan screen of a new account', () => {
  it('the price line: free for 5 days without a card, then the plan price', () => {
    render(<TrialPriceLine price={19} period="MONTHLY" plan="Starter" />);
    expect(screen.getByTestId('trial-price-line').textContent).toBe(
      '5 days free, no card needed. After the trial, Starter is £19 / month.'
    );
    cleanup();
    render(<TrialPriceLine price={290} period="YEARLY" plan="Pro" />);
    expect(screen.getByTestId('trial-price-line').textContent).toBe(
      '5 days free, no card needed. After the trial, Pro is £290 / year.'
    );
  });

  it('one button starts the trial, without a card form', () => {
    const start = jest.fn();
    render(<StartTrialButton onStart={start} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start 5-day free trial' }));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('the button cannot be clicked twice while the trial starts', () => {
    const start = jest.fn();
    render(<StartTrialButton onStart={start} loading={true} />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('the trial limits are shown open, every one with its number', () => {
    const { container } = render(<TrialLimitsBox />);
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).toContain('Your 5-day free trial includes');
    for (const limit of ['2 channels', '15 posts', '10 AI images', '1 AI video', '50 questions to the AI assistant']) {
      expect(container.textContent).toContain(limit);
    }
    expect(container.textContent).toContain("Your plan's full limits start with your first payment.");
  });

  it('after the trial: it has ended, and everything is saved', () => {
    render(<TrialEndedHeadline />);
    expect(screen.getByRole('heading').textContent).toBe('Your free trial has ended');
    expect(screen.getByTestId('trial-ended').textContent).toContain(
      'Your channels, posts and media are saved. Choose a plan and add a card to carry on - publishing starts again straight away.'
    );
  });

  it('the screen starts the trial with no card form, and keeps paying now as a choice', () => {
    const source = readFileSync(join(__dirname, 'first.billing.component.tsx'), 'utf8');
    expect(source).toContain("'/billing/start-trial'");
    expect(source).toMatch(/trialOffered && \(?\s*<TrialLimitsBox/);
    expect(source).toMatch(/trialOffered && \(?\s*<TrialPriceLine/);
    // The card form is loaded only when the customer asks to pay now.
    expect(source).toMatch(/showCheckout \? `\/billing-/);
    expect(source).not.toContain('NotChargedToday');
  });
});
