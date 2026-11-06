import { readFileSync } from 'fs';
import { join } from 'path';

// The channel menu mixed "Rename channel" with "Disable Channel" and "Edit
// Time Slots". Its items are sentence case: only the first word and proper
// names (ID) start with a capital. "Create Post" shares its key with the main
// button next to "Add Channel" and is left to that button.
const en = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../../libraries/react-shared-libraries/src/translation/locales/en/translation.json'),
    'utf8'
  )
);
const menu = readFileSync(join(__dirname, 'menu.tsx'), 'utf8');

const ITEMS = {
  copy_id: 'Copy channel ID',
  update_credentials: 'Update credentials',
  additional_settings: 'Additional settings',
  move_add_to_customer: 'Move / add to customer',
  rename_channel: 'Rename channel',
  edit_time_slots: 'Edit time slots',
  enable_channel: 'Enable channel',
  disable_channel: 'Disable channel',
  change_bot: 'Change bot',
  reconnect_channel: 'Reconnect channel',
};

describe('channel menu labels', () => {
  it.each(Object.entries(ITEMS))('%s is sentence case in English', (key, text) => {
    expect(en[key]).toBe(text);
  });

  it.each(Object.entries(ITEMS))('%s has the same default in the menu', (key, text) => {
    expect(menu).toContain(`t('${key}', '${text}')`);
  });
});
