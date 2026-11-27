/**
 * @jest-environment jsdom
 */
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, text: string, values: Record<string, string | number> = {}) =>
    text.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(values[k] ?? '')),
}));
const answers: Record<string, unknown> = {
  '/billing/finish-trial/preview': { amount: 1900, currency: 'gbp', tier: 'STANDARD', period: 'MONTHLY', hasCard: true },
  '/billing/finish-trial': { finish: true },
  '/billing/is-trial-finished': { finished: true },
};
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => async (url: string) => ({ json: async () => answers[url] }),
}));
const mutate = jest.fn();
jest.mock('swr', () => ({ __esModule: true, default: jest.fn(() => ({})), useSWRConfig: () => ({ mutate }) }));

import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { FinishTrial } from './finish.trial';

afterEach(cleanup);

// Ending the trial on production (27 Nov 2026): the page then read "10 of 75
// AI images left" until a reload, and offered a "Close window" that did nothing.
describe('ending the trial now', () => {
  it('refreshes the AI counts and closes one way', async () => {
    const close = jest.fn();
    render(<FinishTrial close={close} />);
    fireEvent.click(await screen.findByRole('button', { name: /End trial and pay/ }));

    await screen.findByText('Your trial has ended and the payment has been charged.');
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith('billing-credits-images');
      expect(mutate).toHaveBeenCalledWith('billing-credits-videos');
    });
    expect(screen.queryByRole('button', { name: 'Close window' })).toBeNull();
    // The corner X and one button under the message, nothing else.
    const buttons = screen.getAllByRole('button', { name: 'Close' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(close).toHaveBeenCalled();
  });
});
