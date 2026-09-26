import {
  championsOf,
  congratsHeadline,
  joinNames,
  myPlaceLine,
  relegatedOf,
  toCycleResults,
  type LeagueCycleResults,
} from '@/lib/domain/leagueResults';

const row = (userId: string, fullName: string, place: number, prizeAmount = 0) => ({ userId, fullName, place, score: 10 - place, prizeAmount, relegated: false, descensoAmount: 0 });
const results = (standings: LeagueCycleResults['standings']): LeagueCycleResults => ({
  cycleNumber: 2, startDate: '2026-08-17', endDate: '2026-11-15', closedEarly: false,
  currency: 'COP', poolAmount: 700000, autoRenewed: false, standings,
});

describe('championsOf', () => {
  it('returns every member tied for 1st', () => {
    const s = [row('a', 'Ana Gómez', 1), row('b', 'Beto Ruiz', 1), row('c', 'Caro Paz', 3)];
    expect(championsOf(s).map((r) => r.userId)).toEqual(['a', 'b']);
  });
});

describe('joinNames', () => {
  it('reads naturally for 1, 2 and 3 names', () => {
    expect(joinNames(['Ana'])).toBe('Ana');
    expect(joinNames(['Ana', 'Beto'])).toBe('Ana y Beto');
    expect(joinNames(['Ana', 'Beto', 'Caro'])).toBe('Ana, Beto y Caro');
  });
});

describe('congratsHeadline', () => {
  const solo = results([row('a', 'Ana Gómez', 1), row('b', 'Beto Ruiz', 2), row('c', 'Caro Paz', 3), row('d', 'Dani Sol', 4)]);
  it('celebrates the champion personally', () => {
    expect(congratsHeadline(solo, 'a')).toContain('campeón');
  });
  it('tells a podium finisher they made the podium', () => {
    expect(congratsHeadline(solo, 'c')).toContain('podio');
  });
  it('congratulates the champion by name to everyone else', () => {
    expect(congratsHeadline(solo, 'd')).toBe('Felicitaciones a Ana, campeón del ciclo.');
  });
  it('handles a tie for 1st, from either side', () => {
    const tie = results([row('a', 'Ana Gómez', 1), row('b', 'Beto Ruiz', 1), row('c', 'Caro Paz', 3), row('d', 'Dani Sol', 4)]);
    expect(congratsHeadline(tie, 'a')).toBe('¡Felicitaciones! Compartes la corona con Beto.');
    expect(congratsHeadline(tie, 'd')).toBe('Felicitaciones a Ana y Beto, campeones del ciclo.');
  });
});

describe('myPlaceLine', () => {
  it('states place and field size, or nothing for a non-participant', () => {
    const r = results([row('a', 'Ana', 1), row('b', 'Beto', 2)]);
    expect(myPlaceLine(r, 'b')).toBe('Quedaste 2° de 2');
    expect(myPlaceLine(r, 'zzz')).toBeNull();
  });
});

describe('relegatedOf', () => {
  it('returns only members flagged as relegated', () => {
    const s = [row('a', 'Ana', 1), { ...row('b', 'Beto', 2), relegated: true, descensoAmount: 5000 }];
    expect(relegatedOf(s).map((r) => r.userId)).toEqual(['b']);
  });
});

describe('toCycleResults', () => {
  const input = {
    cycleNumber: 4, startDate: '2026-08-17', endDate: '2026-11-15', closedEarly: false, currency: 'COP', poolAmount: null, partial: false,
  };

  it('orders by place then name and names ex-members', () => {
    const r = toCycleResults({
      ...input,
      rows: [
        { userId: 'b', fullName: 'Beto', place: 2, score: 5, prizeAmount: 0, relegated: true, descensoAmount: 1000 },
        { userId: 'x', fullName: null, place: 1, score: 9, prizeAmount: 100, relegated: false, descensoAmount: 0 },
        { userId: 'a', fullName: 'Ana', place: 1, score: 9, prizeAmount: 100, relegated: false, descensoAmount: 0 },
      ],
    });
    expect(r.standings.map((s) => s.fullName)).toEqual(['Ana', 'Ex miembro', 'Beto']);
    expect(r.poolAmount).toBe(0);
    expect(r.autoRenewed).toBe(false);
  });
});
