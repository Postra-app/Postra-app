import { EventEmitter } from 'events';
import { setAiUsageSink } from './ai-usage.record';
import { meterCopilotAdapter } from './ai-usage.copilot';

// Checked once against the real OpenAI API through @copilotkit/runtime's
// OpenAIAdapter (2026-10-02: 13 input / 12 output tokens recorded). This spec
// keeps the contract in CI without a network call.
describe('meterCopilotAdapter', () => {
  it('asks OpenAI for usage and records it once per stream', () => {
    const events: any[] = [];
    setAiUsageSink((e) => events.push(e));
    let sentBody: any;
    const running = new EventEmitter();
    const adapter = {
      openai: {
        beta: { chat: { completions: { stream: (body: any) => ((sentBody = body), running) } } },
      },
    };

    meterCopilotAdapter(adapter, 'org-1', 'autocomplete');
    (adapter.openai.beta.chat.completions.stream as any)({ model: 'gpt-4.1', messages: [] });
    running.emit('chunk', { choices: [{ delta: { content: 'Hi' } }] });
    running.emit('chunk', { choices: [], usage: { prompt_tokens: 13, completion_tokens: 12 } });

    expect(sentBody.stream_options).toEqual({ include_usage: true });
    expect(events).toEqual([
      {
        organizationId: 'org-1',
        engine: 'autocomplete',
        model: 'gpt-4.1',
        unit: 'tokens',
        inputAmount: 13,
        outputAmount: 12,
      },
    ]);
  });

  it('leaves an adapter it does not recognise alone', () => {
    const adapter = { something: true };
    expect(meterCopilotAdapter(adapter, 'org-1', 'autocomplete')).toBe(adapter);
  });
});
