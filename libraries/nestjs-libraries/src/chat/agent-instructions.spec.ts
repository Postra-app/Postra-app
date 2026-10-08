import { schedulingRule } from '@gitroom/nestjs-libraries/chat/agent-instructions';

// E2E-08-53: through MCP (ask_postra) there is no second turn, so "ask the
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
