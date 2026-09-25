/**
 * A tiny in-memory stand-in for the Supabase client — just the query surface the
 * achievements code uses (select/eq/in/lte/not/single/maybeSingle/insert/upsert/
 * delete/rpc), backed by plain arrays. Plain TypeScript with no jest or Node
 * APIs on purpose, so the same helper also runs under Deno.
 *
 * Nested selects (e.g. `profile:profiles(full_name)`) are NOT joined: put the
 * nested object directly on the row, exactly as PostgREST would return it.
 */
export type Row = Record<string, unknown>;

export interface FakeOptions {
  /** Return an error message to make this rpc call fail, or null to succeed. */
  failRpc?: (name: string, args: Record<string, unknown>) => string | null;
  /** Return an error message to make every select on this table fail. */
  failSelect?: (table: string) => string | null;
}

/** Tables whose rows are unique on these columns (insert conflicts, upsert replaces). */
const UNIQUE_KEYS: Record<string, string[]> = {
  member_achievement_notifications: ['group_id', 'user_id', 'badge_id', 'period'],
  member_level_notifications: ['group_id', 'user_id'],
  achievement_check_state: ['group_id'],
};

export interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

type Result = { data: unknown; error: { message: string } | null };

export function createFakeSupabase(initial: Record<string, Row[]>, options: FakeOptions = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((r) => ({ ...r }));
  const rpcCalls: RpcCall[] = [];
  const rows = (table: string): Row[] => (tables[table] ??= []);
  const sameKey = (table: string, a: Row, b: Row) => (UNIQUE_KEYS[table] ?? []).every((k) => a[k] === b[k]);

  class Query {
    private mode: 'select' | 'insert' | 'upsert' | 'delete' = 'select';
    private payload: Row | null = null;
    private filters: ((r: Row) => boolean)[] = [];
    private one: 'single' | 'maybe' | null = null;
    constructor(private table: string) {}

    select() { return this; }
    eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
    in(col: string, vals: unknown[]) { this.filters.push((r) => vals.includes(r[col])); return this; }
    lte(col: string, val: unknown) { this.filters.push((r) => (r[col] as string) <= (val as string)); return this; }
    not(col: string, op: string, val: unknown) {
      if (op === 'is') this.filters.push((r) => (val === null ? r[col] !== null && r[col] !== undefined : r[col] !== val));
      return this;
    }
    single() { this.one = 'single'; return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    insert(row: Row) { this.mode = 'insert'; this.payload = row; return this; }
    upsert(row: Row) { this.mode = 'upsert'; this.payload = row; return this; }
    delete() { this.mode = 'delete'; return this; }

    private run(): Result {
      const table = this.table;
      if (this.mode === 'insert') {
        const row = { ...this.payload! };
        if (rows(table).some((r) => sameKey(table, r, row))) return { data: null, error: { message: `duplicate key on ${table}` } };
        rows(table).push(row);
        return { data: null, error: null };
      }
      if (this.mode === 'upsert') {
        const row = { ...this.payload! };
        const idx = rows(table).findIndex((r) => sameKey(table, r, row));
        if (idx >= 0) rows(table)[idx] = { ...rows(table)[idx], ...row };
        else rows(table).push(row);
        return { data: null, error: null };
      }
      if (this.mode === 'delete') {
        // Mutate in place (don't swap the array) so a test holding a reference to tables[table] keeps seeing the truth.
        const all = rows(table);
        const remaining = all.filter((r) => !this.filters.every((f) => f(r)));
        all.length = 0;
        all.push(...remaining);
        return { data: null, error: null };
      }
      const failure = options.failSelect?.(table) ?? null;
      if (failure) return { data: null, error: { message: failure } };
      const matched = rows(table).filter((r) => this.filters.every((f) => f(r)));
      if (this.one === 'single') return matched.length > 0 ? { data: matched[0], error: null } : { data: null, error: { message: 'no rows' } };
      if (this.one === 'maybe') return { data: matched[0] ?? null, error: null };
      return { data: matched, error: null };
    }

    then<T>(resolve: (r: Result) => T, reject?: (e: unknown) => T) {
      try { return Promise.resolve(this.run()).then(resolve, reject); } catch (e) { return Promise.reject(e).then(resolve, reject); }
    }
  }

  const client = {
    from: (table: string) => new Query(table),
    rpc: (name: string, args: Record<string, unknown>): Promise<Result> => {
      rpcCalls.push({ name, args });
      const failure = options.failRpc?.(name, args) ?? null;
      return Promise.resolve(failure ? { data: null, error: { message: failure } } : { data: null, error: null });
    },
  };

  return { client, tables, rpcCalls };
}
