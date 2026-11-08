/**
 * Captions from Whisper's segments, without the lines it makes up.
 *
 * On a clip with music or noise and no speech, Whisper still returns a line,
 * almost always one of a small set it learned from subtitled videos ("Thanks
 * for watching!", the Amara.org credit). Burned into the clip, that is a
 * caption nobody said. Its own no-speech probability does not tell the two
 * apart (0.41 on such a clip, 0.48 on clear speech), but its confidence does:
 * a made-up line comes back unsure, real speech sure. A line is dropped when it
 * is one of those phrases and unsure, or when Whisper's own rule says silence
 * (likely no speech and low confidence). A sure "thanks for watching" at the
 * end of a vlog stays.
 */
export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  avg_logprob?: number;
  no_speech_prob?: number;
}

// Whisper's documented defaults for treating a window as silence.
const NO_SPEECH_THRESHOLD = 0.6;
const LOGPROB_THRESHOLD = -1;
// Below this a known phrase counts as made up. Clear speech sits near -0.2.
const UNSURE_LOGPROB = -0.5;

const HALLUCINATIONS = [
  /^thanks? (you )?for watching\W*$/i,
  /^thank you\W*$/i,
  /^you\W*$/i,
  /^please subscribe\W*$/i,
  /subtitles? (by|from) the amara\.org community/i,
  /napisy (stworzone|wykonane) przez społeczność amara\.org/i,
  /^dziękuję( za (uwagę|obejrzenie))?\W*$/i,
  /untertitel (der|von der) amara\.org-community/i,
  /sous-titres? réalisés? (par|para) la communauté d'amara\.org/i,
];

export const isMadeUp = (s: WhisperSegment): boolean => {
  const text = s.text.trim();
  if (!text) return true;
  const logprob = s.avg_logprob ?? 0;
  if ((s.no_speech_prob ?? 0) > NO_SPEECH_THRESHOLD && logprob < LOGPROB_THRESHOLD) return true;
  return logprob < UNSURE_LOGPROB && HALLUCINATIONS.some((re) => re.test(text));
};

const timecode = (seconds: number): string => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(
    Math.floor(ms / 1000) % 60
  )},${pad(ms % 1000, 3)}`;
};

/** SRT from the segments that were really said; empty when none were. */
export const segmentsToSrt = (segments: WhisperSegment[]): string =>
  segments
    .filter((s) => !isMadeUp(s))
    .map((s, i) => `${i + 1}\n${timecode(s.start)} --> ${timecode(s.end)}\n${s.text.trim()}\n`)
    .join('\n');
