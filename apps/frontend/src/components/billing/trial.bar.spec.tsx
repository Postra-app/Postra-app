/**
 * @jest-environment jsdom
 */
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, text: string, values: Record<string, string | number> = {}) =>
    text.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(values[k] ?? '')),
}));

import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TrialBarView, TrialDateWarningView, afterCardlessTrial } from './trial.bar';

afterEach(cleanup);

// During the trial the customer sees, on every page, how many days
// are left and how much of the trial is used, and how to keep the plan.
const status = {
  trial: true,
  endsAt: Date.UTC(2026, 11, 1, 15, 0),
  hasCard: false,
  channels: { used: 1, limit: 2 },
  posts: { used: 4, limit: 15 },
  images: { used: 3, limit: 10 },
};
const now = Date.UTC(2026, 10, 28, 9, 0);

describe('the trial bar', () => {
  it('days left and every counter, in numbers', () => {
    render(<TrialBarView status={status} now={now} canAddCard={true} onAddCard={jest.fn()} />);
    const bar = screen.getByTestId('trial-bar');
    expect(bar.textContent).toContain('Free trial: 4 days left');
    expect(bar.textContent).toContain('Channels 1 / 2');
    expect(bar.textContent).toContain('Posts 4 / 15');
    expect(bar.textContent).toContain('AI images 3 / 10');
  });

  it('without a card: a card keeps the plan', () => {
    const add = jest.fn();
    render(<TrialBarView status={status} now={now} canAddCard={true} onAddCard={add} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a card to keep your plan' }));
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('with a card: says the plan starts when the trial ends', () => {
    render(<TrialBarView status={{ ...status, hasCard: true }} now={now} canAddCard={true} onAddCard={jest.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('trial-bar').textContent).toContain('Card added: your plan starts when the trial ends.');
  });

  // Cancelled from Billing, the plan ends with the trial even with a card:
  // the bar says so and points at Billing instead of asking for a card.
  it('a cancelled trial: says the plan ends with it and links to Billing', () => {
    for (const hasCard of [false, true]) {
      render(<TrialBarView status={{ ...status, hasCard, cancelled: true }} now={now} canAddCard={true} onAddCard={jest.fn()} />);
      const bar = screen.getByTestId('trial-bar');
      expect(bar.textContent).toContain('Your plan is cancelled and ends with the trial.');
      expect(bar.textContent).not.toContain('Add a card to keep your plan');
      expect(bar.textContent).not.toContain('Card added');
      expect(screen.getByRole('link', { name: 'Reactivate in Billing' }).getAttribute('href')).toBe('/billing');
      cleanup();
    }
  });

  it('a cancelled trial: a member who cannot open Billing gets no link', () => {
    render(<TrialBarView status={{ ...status, cancelled: true }} now={now} canAddCard={false} onAddCard={jest.fn()} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('a member who cannot open Billing is not offered the card', () => {
    render(<TrialBarView status={status} now={now} canAddCard={false} onAddCard={jest.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('the last day says so', () => {
    render(<TrialBarView status={status} now={status.endsAt - 3 * 3600_000} canAddCard={true} onAddCard={jest.fn()} />);
    expect(screen.getByTestId('trial-bar').textContent).toContain('Free trial: ends today');
  });
});

// A post scheduled after a trial without a card is not sent; the
// composer says so when the date is picked.
describe('the composer date during the trial', () => {
  it('warns only for a date after a trial that has no card', () => {
    expect(afterCardlessTrial(status, status.endsAt + 1)).toBe(true);
    expect(afterCardlessTrial(status, status.endsAt - 1)).toBe(false);
    expect(afterCardlessTrial({ ...status, hasCard: true }, status.endsAt + 1)).toBe(false);
    expect(afterCardlessTrial({ ...status, hasCard: true, cancelled: true }, status.endsAt + 1)).toBe(true);
    expect(afterCardlessTrial({ trial: false }, status.endsAt + 1)).toBe(false);
    expect(afterCardlessTrial(undefined, status.endsAt + 1)).toBe(false);
  });

  it('a cancelled trial is told to reactivate, not to add a card', () => {
    render(<TrialDateWarningView show={true} cancelled={true} />);
    expect(screen.getByTestId('trial-date-warning').textContent).toBe(
      'This date is after your free trial ends, and your plan is cancelled. Reactivate it in Billing, or the post will not be sent.'
    );
  });

  it('says the post will not be sent without a card', () => {
    render(<TrialDateWarningView show={true} />);
    expect(screen.getByTestId('trial-date-warning').textContent).toBe(
      'This date is after your free trial ends. Add a card to keep your plan, or the post will not be sent.'
    );
  });
});
