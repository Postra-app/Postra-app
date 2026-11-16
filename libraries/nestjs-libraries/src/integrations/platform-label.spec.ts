import { IntegrationManager } from './integration.manager';

// Messages people read named the platform by its identifier: "The youtube
// channel isn't included in your plan". They name it as the picker does.
describe('the platform name in a message', () => {
  const manager = new IntegrationManager();

  it('is the name people know, not the identifier', () => {
    expect(manager.label('youtube')).toBe('YouTube');
    expect(manager.label('linkedin-page')).toBe('LinkedIn Page');
    expect(manager.label('x')).toBe('X');
    expect(manager.label('wordpress')).toBe('WordPress');
  });

  it('is one line: both Instagram logins are Instagram', () => {
    expect(manager.label('instagram')).toBe('Instagram');
    expect(manager.label('instagram-standalone')).toBe('Instagram');
  });

  it('falls back to what it was given for a platform it does not know', () => {
    expect(manager.label('nope')).toBe('nope');
  });
});
