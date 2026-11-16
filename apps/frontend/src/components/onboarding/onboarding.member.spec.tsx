/**
 * @jest-environment jsdom
 */
// Someone who signs up through a team invitation lands in the inviting
// organisation as a member, with ?onboarding=true. They were shown "Connect
// your channels", where every tile answered "you do not have permission":
// adding a channel is an admin's.
let role = 'USER';
const openModal = jest.fn();
const replace = jest.fn();

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('onboarding=true'),
  useRouter: () => ({ push: jest.fn(), replace }),
}));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal, closeAll: jest.fn() }),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, text: string) => text,
}));
jest.mock('@gitroom/frontend/components/onboarding/onboarding.modal', () => ({
  OnboardingModal: () => null,
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => ({ role }),
}));

import { render, cleanup } from '@testing-library/react';
import { Onboarding } from './onboarding';

afterEach(() => {
  cleanup();
  openModal.mockReset();
  replace.mockReset();
});

describe('the welcome window after sign-up', () => {
  it('is not shown to a member of someone else\'s organisation', () => {
    role = 'USER';
    render(<Onboarding />);
    expect(openModal).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/launches');
  });

  it.each(['ADMIN', 'SUPERADMIN'])('is shown to %s', (r) => {
    role = r;
    render(<Onboarding />);
    expect(openModal).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });
});
