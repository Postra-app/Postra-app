import { readFileSync } from 'fs';
import { join } from 'path';

// Read as source: importing the manager pulls in every provider.
const manager = readFileSync(join(__dirname, 'integration.manager.ts'), 'utf8');
const controller = readFileSync(
  join(__dirname, '../../../../apps/backend/src/api/routes/integrations.controller.ts'),
  'utf8'
);

// Moltbook was out of the picker but its routes still did its work.
describe('hidden providers', () => {
  it('Moltbook is hidden', () => {
    expect(manager).toMatch(/hiddenProviders = new Set\(\[[^\]]*'moltbook'/);
  });

  it('both Moltbook routes answer 404 while it is hidden', () => {
    for (const route of ['moltbookRegister', 'moltbookStatus']) {
      const body = controller.slice(controller.indexOf(`async ${route}(`)).slice(0, 400);
      expect(body).toMatch(/if \(isHiddenProvider\('moltbook'\)\) \{\s*throw new NotFoundException\(\);/);
    }
  });
});

// LinkedIn Pages wait for LinkedIn's Standard Tier. In preview a super admin
// and the reviewers' organisation can connect one; offering it to customers
// is a separate decision (enabledProviders).
describe('preview providers', () => {
  const list = (name: string) =>
    manager.slice(manager.indexOf(`const ${name} = new Set`)).split(']);')[0];

  it('LinkedIn Pages are in preview and not offered to customers', () => {
    expect(list('previewProviders')).toMatch(/^\s*'linkedin-page',/m);
    expect(list('enabledProviders')).not.toMatch(/^\s*'linkedin-page',/m);
  });
});
