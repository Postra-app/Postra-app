/**
 * @jest-environment jsdom
 */
jest.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ uploadDirectory: 'https://cdn.postra.co.uk' }),
}));

import { renderToStaticMarkup } from 'react-dom/server';
import { isChatMediaAllowed, SafeChatImage } from './agent.safe-media';

// An image in the assistant's answer loads without a click: from anywhere
// but our own media, its address could carry the conversation away.
describe('images in the assistant chat', () => {
  const cdn = 'https://cdn.postra.co.uk';
  const app = 'https://app.postra.co.uk';

  it('shows our own media', () => {
    expect(isChatMediaAllowed(`${cdn}/2026/11/17/a.png`, cdn, app)).toBe(true);
    expect(isChatMediaAllowed(`${app}/uploads/a.png`, cdn, app)).toBe(true);
  });

  it('does not load an image from any other host', () => {
    expect(isChatMediaAllowed('https://evil.example/p.png?d=secret', cdn, app)).toBe(false);
    expect(isChatMediaAllowed('https://cdn.postra.co.uk.evil.example/a.png', cdn, app)).toBe(false);
    expect(isChatMediaAllowed('javascript:alert(1)', cdn, app)).toBe(false);
    expect(isChatMediaAllowed(undefined, cdn, app)).toBe(false);
  });

  it('renders a foreign image as text, not as an <img>', () => {
    const html = renderToStaticMarkup(
      <SafeChatImage src="https://evil.example/p.png?d=secret" alt="chart" />
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('evil.example');
    expect(html).toContain('[chart]');
    expect(
      renderToStaticMarkup(<SafeChatImage src={`${cdn}/a.png`} alt="ok" />)
    ).toContain(`<img src="${cdn}/a.png"`);
  });
});

// The chat itself must use the check: the answers' markdown images and the
// "Image:" / "Video:" lines of the messages.
describe('the assistant chat uses the check', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const src = require('fs').readFileSync(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('path').join(__dirname, 'agent.chat.tsx'),
    'utf8'
  );
  it('renders markdown images with SafeChatImage', () => {
    expect(src).toMatch(/markdownTagRenderers=\{\{\s*img:\s*SafeChatImage\s*\}\}/);
  });
  it('checks Image: and Video: lines before making them media', () => {
    expect(src).toMatch(/Video: [^\n]*\n\s*if \(!own\(/);
    expect(src).toMatch(/Image: [^\n]*\n\s*if \(!own\(/);
  });
});
