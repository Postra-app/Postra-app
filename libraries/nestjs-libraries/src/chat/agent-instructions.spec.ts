import {
  confirmationCardRule,
  schedulingRule,
} from '@gitroom/nestjs-libraries/chat/agent-instructions';

// Through MCP (ask_postra) there is no second turn, so "ask the
// user to confirm" meant nothing could ever be scheduled that way.
describe('the scheduling rule of the assistant', () => {
  it('in the app chat, asks the person to confirm before scheduling', () => {
    const rule = schedulingRule(true);
    expect(rule).toContain('ask the user confirmation');
    expect(rule).not.toContain('MCP');
  });

  it('through MCP, schedules a complete request and names what is missing otherwise', () => {
    const rule = schedulingRule(false);
    expect(rule).toContain('MCP');
    expect(rule).toContain('schedule it without asking for confirmation');
    expect(rule).toContain('channel, the date and time, and the text');
    expect(rule).toContain('say exactly what is missing');
    // Moving and deleting need the Approve card, which only the app chat
    // shows: through MCP there is nowhere to approve, so the assistant must
    // not offer it and must say where it can be done.
    expect(rule).toContain('cannot move or delete a post through MCP');
    expect(rule).toContain('Postra calendar');
    expect(rule).not.toContain('approve it in Postra');
  });
});

// Nightly canary 2026-10-15/16: after Decline, asking again got "the card is
// already open" because the rule said not to call the tool while a card was
// open, and the model cannot see a click.
describe('the confirmation card rule of the assistant', () => {
  it('asks for a new card every time the user asks again', () => {
    const rule = confirmationCardRule(true);
    expect(rule).toContain('call the tool again and show a new card');
    expect(rule).toContain('never answer that a card is already open');
    expect(rule).not.toMatch(/do not call the tool again/i);
  });

  it('through MCP, leaves moving and deleting to the scheduling rule', () => {
    expect(confirmationCardRule(false)).toBe('');
  });
});
