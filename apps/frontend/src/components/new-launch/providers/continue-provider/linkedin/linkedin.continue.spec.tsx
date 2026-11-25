/**
 * @jest-environment jsdom
 */
import { render, cleanup, fireEvent } from '@testing-library/react';
import { LinkedinPageItem } from './linkedin.continue';

afterEach(cleanup);

// A LinkedIn Page without a logo comes back from LinkedIn with no picture,
// and the page picker drew a broken-image icon with the word "profile" next
// to the Page's name. Such a Page now shows its initial instead.
describe('a LinkedIn Page in the page picker', () => {
  it('shows the logo when the Page has one', () => {
    const { container, queryByText } = render(
      <LinkedinPageItem name="Postra" picture="https://media.licdn.com/logo.png" />
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://media.licdn.com/logo.png'
    );
    expect(queryByText('Postra')).not.toBeNull();
  });

  it('shows the initial, not a broken image, when the Page has no logo', () => {
    const { container, getByText } = render(
      <LinkedinPageItem name="postra test page" picture={undefined} />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(getByText('P').getAttribute('aria-hidden')).toBe('true');
    expect(getByText('postra test page')).not.toBeNull();
  });

  it('shows the initial when the logo fails to load', () => {
    const { container, getByText } = render(
      <LinkedinPageItem name="Acme" picture="https://media.licdn.com/gone.png" />
    );
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(getByText('A')).not.toBeNull();
  });
});
