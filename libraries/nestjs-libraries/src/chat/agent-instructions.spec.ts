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
    // Moving and deleting keep their Approve card in the app.
    expect(rule).toContain('reschedulePost and deletePost');
  });
});
