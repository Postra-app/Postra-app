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
  NotChargedToday,
  PAYMENT_FORM_ID,
  StartTrialButton,
  TrialLimitsDetails,
  TrialPriceLine,
} from './first.billing.trial';

afterEach(cleanup);

// The plan screen of a new account: two visitors in a row left it within the
// minute. The price read "£19 / month" with the free week said elsewhere, a
// phone showed no next step (the card form sits under the whole feature
// list), and a paragraph of trial limits stood before the plans.
describe('the plan screen says what the free week costs and what to do next', () => {
  it('the price line: nothing today, then the plan price', () => {
    render(<TrialPriceLine price={19} period="MONTHLY" />);
    expect(screen.getByTestId('trial-price-line').textContent).toBe(
      '£0 today. 7 days free, then £19 / month.'
    );
    cleanup();
    render(<TrialPriceLine price={290} period="YEARLY" />);
    expect(screen.getByTestId('trial-price-line').textContent).toBe(
      '£0 today. 7 days free, then £290 / year.'
    );
  });

  it('the button takes the visitor to the card form', () => {
    const form = document.createElement('div');
    form.id = PAYMENT_FORM_ID;
    form.scrollIntoView = jest.fn();
    document.body.appendChild(form);
    render(<StartTrialButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Start 7-day free trial' }));
    expect(form.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    form.remove();
  });

  it('above the card form: no charge today', () => {
    render(<NotChargedToday />);
    expect(screen.getByTestId('not-charged-today').textContent).toBe(
      'You will not be charged today. Cancel any time in Settings before day 7 and you pay nothing.'
    );
  });

  it('the trial limits are kept, folded under a question', () => {
    const { container } = render(<TrialLimitsDetails />);
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('What is included in the trial?');
    expect(details.textContent).toContain('During the 7-day trial you can connect up to');
  });

  it('the screen uses them only where a trial is offered', () => {
    const source = readFileSync(join(__dirname, 'first.billing.component.tsx'), 'utf8');
    for (const piece of ['TrialPriceLine', 'StartTrialButton', 'NotChargedToday', 'TrialLimitsDetails']) {
      expect(source).toMatch(new RegExp(`trialOffered && \\(?\\s*<${piece}`));
    }
    expect(source).toContain('id={PAYMENT_FORM_ID}');
    expect(source).not.toMatch(/<TrialLimitsNote/);
  });
});
