/**
 * @jest-environment jsdom
 */
// A member who opens /autopost by its address saw every feed with Edit,
// Delete and the switch, though the server refuses a member's changes.
let role = 'USER';
const replace = jest.fn();
const fetchMock = jest.fn(async () => ({ json: async (): Promise<unknown[]> => [] }));

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: jest.fn() }) }));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => ({ role, tier: { current: 'ULTIMATE' } }),
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => fetchMock }));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, text: string) => text,
}));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: jest.fn(), closeAll: jest.fn() }),
}));
jest.mock('@gitroom/react/toaster/toaster', () => ({ useToaster: () => ({ show: jest.fn() }) }));
jest.mock('@gitroom/frontend/components/launches/helpers/pick.platform.component', () => ({
  PickPlatforms: () => null,
}));

import { render, cleanup, waitFor } from '@testing-library/react';
import { Autopost } from './autopost';

afterEach(() => {
  cleanup();
  replace.mockReset();
  fetchMock.mockClear();
});

describe('the Auto Post page', () => {
  it('sends a member back to the calendar and loads no feeds', async () => {
    role = 'USER';
    const { container } = render(<Autopost />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/launches'));
    expect(container.textContent).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens for an admin', async () => {
    role = 'ADMIN';
    const { container } = render(<Autopost />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Auto Post');
  });
});
