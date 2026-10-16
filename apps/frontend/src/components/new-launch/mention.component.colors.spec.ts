import { readFileSync } from 'fs';
import { join } from 'path';

// Upstream 2775f59ae + 53d796ec8: the @mention list used light-only colours
// (bg-white, text-gray-800). The global .dropdown-menu paints it dark, so the
// labels were nearly invisible, and `.dropdown-menu button` overrode the
// selected row's bg-blue-100, so keyboard selection showed nothing.
const source = readFileSync(join(__dirname, 'mention.component.tsx'), 'utf8');

describe('mention list colours', () => {
  it.each(['bg-white', 'text-gray-800', 'text-gray-500', 'bg-blue-100', 'hover:bg-gray-100'])(
    'uses theme tokens, not %s',
    (cls) => {
      expect(source).not.toMatch(new RegExp(`(^|[\\s"'\`])${cls}([\\s"'\`]|$)`));
    }
  );

  it('the keyboard-selected row wins over the dropdown button style', () => {
    expect(source).toContain("index === selectedIndex ? '!bg-newBgLineColor' : ''");
  });
});
