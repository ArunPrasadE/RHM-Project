// Thin wrapper over D1 with a better-sqlite3 style API:
// await db.prepare(sql).get(...), .all(...), .run(...).

// D1 rejects undefined; better-sqlite3 code relies on it binding as NULL.
const clean = (params) => params.map((p) => (p === undefined ? null : p));

export function createDb(d1) {
  return {
    prepare(sql) {
      const bind = (params) => {
        const stmt = d1.prepare(sql);
        return params.length ? stmt.bind(...clean(params)) : stmt;
      };
      return {
        async get(...params) {
          return (await bind(params).first()) ?? undefined;
        },
        async all(...params) {
          return (await bind(params).all()).results;
        },
        async run(...params) {
          const { meta } = await bind(params).run();
          return { lastInsertRowid: meta.last_row_id, changes: meta.changes };
        },
        // For db.batch(): the raw bound D1 statement
        statement(...params) {
          return bind(params);
        },
      };
    },
    // Replaces db.transaction(): runs the statements atomically
    async batch(statements) {
      return d1.batch(statements);
    },
  };
}
