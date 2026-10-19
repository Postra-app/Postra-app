import { renderToStaticMarkup } from 'react-dom/server';
import { notificationParts } from './notification.links';

const html = (text: string) =>
  renderToStaticMarkup(<div>{notificationParts(text)}</div>);

describe('notificationParts', () => {
  it('turns a link into an anchor labelled without the scheme', () => {
    const out = html('Published: https://www.example.com/postra/status/1 done');
    expect(out).toContain('href="https://www.example.com/postra/status/1"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('>example.com/postra/status/1</a>');
    expect(out).toContain('Published: ');
    expect(out).toContain(' done');
  });

  it('shows markup in the text as text, never as elements', () => {
    const out = html('Title <img src=x onerror=alert(1)> and <b>bold</b>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('keeps plain text unchanged', () => {
    expect(html('Your post to Bluesky was published.')).toBe(
      '<div>Your post to Bluesky was published.</div>'
    );
  });
});
