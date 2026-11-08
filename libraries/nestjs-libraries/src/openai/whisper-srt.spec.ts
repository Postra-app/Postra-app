import { isMadeUp, segmentsToSrt } from './whisper-srt';

// Values measured from Whisper: a 20 s clip of a tone and noise, and clear
// Polish speech.
const madeUp = { start: 0, end: 20, text: ' Thanks for watching!', avg_logprob: -0.76, no_speech_prob: 0.41 };
const speech = {
  start: 0,
  end: 6.4,
  text: ' W naszej kawiarni na rogu ulicy Długiej każdy poranek zaczyna się od kawy.',
  avg_logprob: -0.15,
  no_speech_prob: 0.48,
};

describe('Whisper captions', () => {
  it('drops the line Whisper makes up for a clip without speech', () => {
    expect(isMadeUp(madeUp)).toBe(true);
    expect(segmentsToSrt([madeUp])).toBe('');
  });

  it('keeps speech, even with a high no-speech probability', () => {
    expect(segmentsToSrt([speech])).toBe(
      '1\n00:00:00,000 --> 00:00:06,400\nW naszej kawiarni na rogu ulicy Długiej każdy poranek zaczyna się od kawy.\n'
    );
  });

  it('keeps a "thanks for watching" that was really said', () => {
    expect(isMadeUp({ start: 60, end: 62, text: 'Thanks for watching!', avg_logprob: -0.2, no_speech_prob: 0.1 })).toBe(false);
  });

  it("drops what Whisper's own rule calls silence, and numbers what is left", () => {
    const silence = { start: 6.4, end: 9, text: ' Hmm', avg_logprob: -1.3, no_speech_prob: 0.8 };
    const amara = { start: 9, end: 12, text: 'Napisy stworzone przez społeczność Amara.org', avg_logprob: -0.9, no_speech_prob: 0.5 };
    const later = { ...speech, start: 3661.5, end: 3663 };
    expect(segmentsToSrt([speech, silence, amara, later]).split('\n\n')[1]).toBe(
      `2\n01:01:01,500 --> 01:01:03,000\n${speech.text.trim()}\n`
    );
  });
});
