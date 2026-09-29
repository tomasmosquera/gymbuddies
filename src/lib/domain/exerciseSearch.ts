/** Lowercased, diacritic-stripped, whitespace-split into tokens — "Preacher Curl" -> ['preacher', 'curl']. Diacritics are stripped even though today's exercise names are all plain English, so this doesn't quietly regress once Spanish names/aliases exist. */
function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Word-order-independent search: true when every word typed in `query`
 * appears somewhere in `name`, in any order — "curl preacher" matches
 * "Preacher Curl" (ExercisePickerModal's search box). A plain substring
 * match would miss that, since the words are reversed. An empty/blank
 * query always matches (no filter typed yet).
 */
export function matchesExerciseQuery(name: string, query: string): boolean {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return true;
  const nameTokens = tokenize(name).join(' ');
  return queryTokens.every((t) => nameTokens.includes(t));
}
