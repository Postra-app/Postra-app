/**
 * @jest-environment jsdom
 */
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, text: string) => text,
}));
jest.mock('@gitroom/react/toaster/toaster', () => ({ useToaster: () => ({ show: jest.fn() }) }));
jest.mock('@gitroom/frontend/components/new-launch/store', () => ({
  useLaunchStore: (pick: any) => pick({ setCurrent: jest.fn() }),
}));
jest.mock('@gitroom/frontend/components/ui/icons', () => ({
  UserIcon: () => null,
  DropdownArrowIcon: () => null,
}));

import { render, cleanup, fireEvent } from '@testing-library/react';
import { SelectCustomer } from './select.customer';

afterEach(cleanup);

// Once a customer was picked in the calendar, nothing took the filter off
// (no "All", F5 and the Calendar link kept it) and the button did not say
// which customer it was: "my posts disappeared" after one click.
const integrations: any[] = [
  { id: '1', customer: { id: 'c-acme', name: 'Acme' } },
  { id: '2', customer: { id: 'c-bolt', name: 'Bolt' } },
  { id: '3', customer: null },
];

describe('the calendar customer filter', () => {
  it('names the customer it filters by', () => {
    const { getByTestId } = render(
      <SelectCustomer allowAll customer="c-acme" integrations={integrations} onChange={jest.fn()} />
    );
    expect(getByTestId('selected-customer').textContent).toBe('Acme');
  });

  it('can be taken off with All customers', () => {
    const onChange = jest.fn();
    const { container, getByText } = render(
      <SelectCustomer allowAll customer="c-acme" integrations={integrations} onChange={onChange} />
    );
    fireEvent.click(container.querySelector('[data-tooltip-content]')!);
    fireEvent.click(getByText('All customers'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('the composer picker has no All option (it selects a customer\'s channels)', () => {
    const { container, queryByText } = render(
      <SelectCustomer integrations={integrations} onChange={jest.fn()} />
    );
    fireEvent.click(container.querySelector('[data-tooltip-content]')!);
    expect(queryByText('All customers')).toBeNull();
  });
});
