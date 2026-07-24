import { REACTION_EMOJIS, aggregateReactionCounts, isValidReactionEmoji } from '@/lib/domain/reactions';

describe('isValidReactionEmoji', () => {
  it.each(REACTION_EMOJIS)('accepts %s as a valid reaction', (emoji) => {
    expect(isValidReactionEmoji(emoji)).toBe(true);
  });

  it('rejects anything outside the fixed set', () => {
    expect(isValidReactionEmoji('👍')).toBe(false);
    expect(isValidReactionEmoji('')).toBe(false);
    expect(isValidReactionEmoji('not an emoji')).toBe(false);
  });
});

describe('aggregateReactionCounts', () => {
  it('returns an empty object for no reactions', () => {
    expect(aggregateReactionCounts([])).toEqual({});
  });

  it('tallies a single reaction', () => {
    expect(aggregateReactionCounts([{ emoji: '🔥' }])).toEqual({ '🔥': 1 });
  });

  it('tallies multiple users on the same emoji and keeps different emojis separate', () => {
    const reactions = [{ emoji: '🔥' }, { emoji: '🔥' }, { emoji: '💪🏼' }, { emoji: '🫃' }, { emoji: '🔥' }];
    expect(aggregateReactionCounts(reactions)).toEqual({ '🔥': 3, '💪🏼': 1, '🫃': 1 });
  });
});
