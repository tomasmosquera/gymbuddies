import { ALL_DRAWABLE_BODY_PARTS, bodyPartsToHighlight } from '@/lib/domain/muscleBodyParts';

describe('bodyPartsToHighlight', () => {
  it('maps a muscle group to its body-map parts', () => {
    expect(bodyPartsToHighlight(['chest'])).toEqual(new Set(['chest', 'serratus']));
  });

  it('unions parts across several muscle groups, deduped', () => {
    expect(bodyPartsToHighlight(['chest', 'core'])).toEqual(new Set(['chest', 'serratus', 'abs', 'obliques']));
  });

  it('back covers trapezius and upper/lower back at once', () => {
    expect(bodyPartsToHighlight(['back'])).toEqual(new Set(['trapezius', 'upper-back', 'lower-back']));
  });

  it('full_body highlights every drawable part, regardless of what else is passed', () => {
    expect(bodyPartsToHighlight(['full_body'])).toEqual(new Set(ALL_DRAWABLE_BODY_PARTS));
    expect(bodyPartsToHighlight(['chest', 'full_body'])).toEqual(new Set(ALL_DRAWABLE_BODY_PARTS));
  });

  it('cardio highlights nothing — chip-only', () => {
    expect(bodyPartsToHighlight(['cardio'])).toEqual(new Set());
  });

  it('returns an empty set for no muscle groups', () => {
    expect(bodyPartsToHighlight([])).toEqual(new Set());
  });
});
