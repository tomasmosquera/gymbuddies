import { matchesExerciseQuery } from '@/lib/domain/exerciseSearch';

describe('matchesExerciseQuery', () => {
  it('matches a plain substring, same as before', () => {
    expect(matchesExerciseQuery('Preacher Curl', 'preacher')).toBe(true);
    expect(matchesExerciseQuery('Preacher Curl', 'curl')).toBe(true);
  });

  it('matches regardless of word order — the actual bug report', () => {
    expect(matchesExerciseQuery('Preacher Curl', 'curl preacher')).toBe(true);
    expect(matchesExerciseQuery('Bench Press (Barbell)', 'barbell bench')).toBe(true);
  });

  it('requires every typed word to appear somewhere', () => {
    expect(matchesExerciseQuery('Preacher Curl', 'curl press')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchesExerciseQuery('Preacher Curl', 'PREACHER CURL')).toBe(true);
  });

  it('ignores diacritics on both sides, for when Spanish names/aliases exist', () => {
    expect(matchesExerciseQuery('Sentadilla Búlgara', 'bulgara sentadilla')).toBe(true);
  });

  it('matches a partial word, not just whole words', () => {
    expect(matchesExerciseQuery('Preacher Curl', 'preach')).toBe(true);
  });

  it('is true for a blank query (nothing typed yet)', () => {
    expect(matchesExerciseQuery('Preacher Curl', '')).toBe(true);
    expect(matchesExerciseQuery('Preacher Curl', '   ')).toBe(true);
  });

  it('collapses repeated/extra whitespace between typed words', () => {
    expect(matchesExerciseQuery('Preacher Curl', '  curl   preacher  ')).toBe(true);
  });
});
