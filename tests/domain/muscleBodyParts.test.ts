import { ALL_DRAWABLE_BODY_PARTS, bodyPartsToHighlight } from '@/lib/domain/muscleBodyParts';

describe('bodyPartsToHighlight', () => {
  it('maps a primary muscle group to its body-map parts, at full intensity', () => {
    const { primary, secondary } = bodyPartsToHighlight([{ muscleGroup: 'chest' }]);
    expect(primary).toEqual(new Set(['chest', 'serratus']));
    expect(secondary).toEqual(new Set());
  });

  it('unions primary parts across several exercises, deduped', () => {
    const { primary } = bodyPartsToHighlight([{ muscleGroup: 'chest' }, { muscleGroup: 'core' }]);
    expect(primary).toEqual(new Set(['chest', 'serratus', 'abs', 'obliques']));
  });

  it('back covers trapezius and upper/lower back at once', () => {
    const { primary } = bodyPartsToHighlight([{ muscleGroup: 'back' }]);
    expect(primary).toEqual(new Set(['trapezius', 'upper-back', 'lower-back']));
  });

  it('full_body highlights every drawable part at full intensity, and no secondary muscles', () => {
    const { primary, secondary } = bodyPartsToHighlight([
      { muscleGroup: 'full_body', secondaryMuscles: ['Biceps'] },
    ]);
    expect(primary).toEqual(new Set(ALL_DRAWABLE_BODY_PARTS));
    expect(secondary).toEqual(new Set());
  });

  it('cardio highlights nothing — chip-only', () => {
    expect(bodyPartsToHighlight([{ muscleGroup: 'cardio' }]).primary).toEqual(new Set());
  });

  it('returns empty sets for no exercises', () => {
    expect(bodyPartsToHighlight([])).toEqual({ primary: new Set(), secondary: new Set() });
  });

  it('maps secondary_muscles free text to body parts, at half intensity', () => {
    const { secondary } = bodyPartsToHighlight([{ muscleGroup: 'chest', secondaryMuscles: ['Shoulders', 'Triceps'] }]);
    expect(secondary).toEqual(new Set(['deltoids', 'triceps']));
  });

  it('a secondary term that maps to more than one part lights up all of them', () => {
    const { secondary } = bodyPartsToHighlight([{ muscleGroup: 'biceps', secondaryMuscles: ['Core'] }]);
    expect(secondary).toEqual(new Set(['abs', 'obliques']));
  });

  it('never demotes a part to secondary when it is already primary (including via another exercise)', () => {
    const { primary, secondary } = bodyPartsToHighlight([
      { muscleGroup: 'chest', secondaryMuscles: ['Shoulders'] },
      { muscleGroup: 'shoulders' },
    ]);
    expect(primary).toEqual(new Set(['chest', 'serratus', 'deltoids']));
    expect(secondary).toEqual(new Set());
  });

  it('ignores unmapped/undrawable secondary terms (Ankles, Ankle Stabilizers, Cardiovascular System)', () => {
    const { secondary } = bodyPartsToHighlight([
      { muscleGroup: 'quads', secondaryMuscles: ['Ankles', 'Ankle Stabilizers', 'Cardiovascular System'] },
    ]);
    expect(secondary).toEqual(new Set());
  });
});
