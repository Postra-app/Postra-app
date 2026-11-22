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
