export const env = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — see e2e/playwright/README.md`);
  }
  return value;
};

export const STATE_FILE = `${__dirname}/.auth/state.json`;

// Every post the tests create starts with this, so cleanup can find leftovers
// of a run that died half-way.
export const MARKER = '[E2E playwright]';
