/**
 * Strips all punctuation, periods, question marks, numbers, brackets, and non-letter symbols,
 * leaving strictly letters and single spaces, while collapsing repetitive Whisper hallucination loops.
 */
export function sanitizeSubtitleLettersOnly(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return '';

  let cleaned = rawText
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, ' ');

  cleaned = cleaned
    .replace(/[^\p{L}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  const words = cleaned.split(' ').filter(Boolean);
  const dedupedWords: string[] = [];
  let repeatCount = 0;
  let prevLower = '';

  for (const w of words) {
    const lower = w.toLowerCase();
    if (lower === prevLower) {
      repeatCount += 1;
      if (repeatCount < 2) {
        dedupedWords.push(w);
      }
    } else {
      repeatCount = 0;
      prevLower = lower;
      dedupedWords.push(w);
    }
  }

  return dedupedWords.join(' ').trim();
}
