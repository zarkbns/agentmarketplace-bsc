/**
 * In-memory fake of the Supabase client query builder — the subset used by
 * services under test. Allows integration tests to run without a live
 * Supabase instance while exercising the real service logic.
 */

type Row = Record<string, unknown>;
type QueryResult = { data: Row | Row[] | null; error: { message: string } | null; count?: number | null };

export class FakeQuery {
  private readonly table: string;
  private readonly store: Map<string, Row[]>;
  private filters: Array<{ col: string; op: string; value: unknown }> = [];
  private orderBy: { col: string; dir: "asc" | "desc" } | null = null;
  private limitN: number | null = null;
  private rangeN: [number, number] | null = null;
  private selected = "*";
  private insertRows: Row[] | null = null;
  private updateValues: Row | null = null;
  private head = false;

  constructor(table: string, store: Map<string, Row[]>) {
    this.table = table;
    this.store = store;
  }

  select(columns = "*") {
    this.selected = columns;
    return this;
  }

  eq(col: string, value: unknown) { this.filters.push({ col, op: "eq", value }); return this; }
  neq(col: string, value: unknown) { this.filters.push({ col, op: "neq", value }); return this; }
  gt(col: string, value: unknown) { this.filters.push({ col, op: "gt", value }); return this; }
  gte(col: string, value: unknown) { this.filters.push({ col, op: "gte", value }); return this; }
  lt(col: string, value: unknown) { this.filters.push({ col, op: "lt", value }); return this; }
  lte(col: string, value: unknown) { this.filters.push({ col, op: "lte", value }); return this; }
  in(col: string, values: unknown[]) { this.filters.push({ col, op: "in", value: values }); return this; }
  notIn(col: string, values: unknown[]) { this.filters.push({ col, op: "notIn", value: values }); return this; }
  or(_filter: string) { this.filters.push({ col: "__or__", op: "or", value: _filter }); return this; }

  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy = { col, dir: opts.ascending === false ? "desc" : "asc" };
    return this;
  }

  limit(n: number) { this.limitN = n; return this; }
  range(from: number, to: number) { this.rangeN = [from, to]; return this; }
  headMode() { this.head = true; return this; }

  insert(rows: Row | Row[]) {
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(values: Row) {
    this.updateValues = values;
    return this;
  }

  delete() { this.updateValues = { __delete__: true }; return this; }

  private matches(row: Row): boolean {
    for (const f of this.filters) {
      const actual = row[f.col];
      switch (f.op) {
        case "eq":
          if (!looseEq(actual, f.value)) return false;
          break;
        case "neq":
          if (looseEq(actual, f.value)) return false;
          break;
        case "gt":
          if (!((actual as number) > (f.value as number))) return false;
          break;
        case "gte":
          if (!((actual as number) >= (f.value as number))) return false;
          break;
        case "lt":
          if (!((actual as number) < (f.value as number))) return false;
          break;
        case "lte":
          if (!((actual as number) <= (f.value as number))) return false;
          break;
        case "in":
          if (!(f.value as unknown[]).some((v) => looseEq(actual, v))) return false;
          break;
        case "notIn":
          if ((f.value as unknown[]).some((v) => looseEq(actual, v))) return false;
          break;
        case "or":
          // basic "a.ilike.x,b.ilike.x" support
          return this.matchesOr(row, String(f.value));
        default:
          return true;
      }
    }
    return true;
  }

  private matchesOr(row: Row, filter: string): boolean {
    const parts = filter.split(",");
    for (const part of parts) {
      const m = part.trim().match(/^([a-z_]+)\.ilike\.(.*)$/);
      if (m && String(row[m[1]] ?? "").toLowerCase().includes(m[2].replace(/%/g, "").toLowerCase())) return true;
    }
    return false;
  }

  private sorted(rows: Row[]): Row[] {
    if (!this.orderBy) return rows;
    const { col, dir } = this.orderBy;
    const mult = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[col] as string | number;
      const bv = b[col] as string | number;
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * mult;
    });
  }

  private rows(): Row[] {
    let rows = (this.store.get(this.table) ?? []).filter((r) => this.matches(r));
    rows = this.sorted(rows);
    if (this.rangeN) rows = rows.slice(this.rangeN[0], this.rangeN[1] + 1);
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return rows;
  }

  private async query(): Promise<QueryResult> {
    if (this.insertRows) {
      const rows = this.insertRows;
      for (const row of rows) this.store.get(this.table)!.push({ ...row });
      return { data: rows, error: null };
    }
    if (this.updateValues) {
      const rows = this.store.get(this.table)!.filter((r) => this.matches(r));
      if (this.updateValues.__delete__) {
        for (const row of rows) {
          const idx = this.store.get(this.table)!.indexOf(row);
          if (idx >= 0) this.store.get(this.table)!.splice(idx, 1);
        }
        return { data: [], error: null };
      }
      for (const row of rows) Object.assign(row, this.updateValues);
      return { data: rows, error: null };
    }
    const data = this.rows();
    return { data, error: null, count: data.length };
  }

  async single(): Promise<QueryResult> {
    const result = await this.query();
    const rows = Array.isArray(result.data) ? result.data : [];
    if (rows.length > 1) return { data: null, error: { message: "expected single row, got multiple" } };
    return { data: rows[0] ?? null, error: rows.length ? null : { message: "row not found" } };
  }

  async maybeSingle(): Promise<QueryResult> {
    const result = await this.query();
    const rows = Array.isArray(result.data) ? result.data : [];
    return { data: rows[0] ?? null, error: null };
  }

  async then(resolve: (v: QueryResult) => unknown) {
    const result = await this.query();
    return resolve(result);
  }
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase()) return true;
  return false;
}

export class FakeDb {
  private store = new Map<string, Row[]>();
  constructor(initial: Record<string, Row[]> = {}) {
    for (const [table, rows] of Object.entries(initial)) {
      this.store.set(table, rows.map((r) => ({ ...r })));
    }
  }
  from(table: string) {
    if (!this.store.has(table)) this.store.set(table, []);
    return new FakeQuery(table, this.store);
  }
  /** Direct access for assertions. Creates the table if absent. */
  table(name: string): Row[] {
    if (!this.store.has(name)) this.store.set(name, []);
    return this.store.get(name)!;
  }
}
