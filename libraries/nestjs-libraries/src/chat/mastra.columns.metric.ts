import { Gauge, register } from 'prom-client';

export const MASTRA_COLUMNS_METRIC = 'postra_mastra_table_columns_max';

// Physical columns, dropped ones included, of the widest mastra_* table.
// Postgres stops a table at 1600 and Mastra adds columns as it migrates its
// schema; MastraService resets the two tables known to churn at 1000 on
// startup, so a value near that on any table means one the reset does not
// cover is growing.
export const MASTRA_COLUMNS_SQL = `SELECT c.relname AS "table", count(*)::int AS columns
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname LIKE 'mastra\\_%' AND a.attnum > 0
    GROUP BY c.relname
    ORDER BY columns DESC
    LIMIT 1`;

type Query = (sql: string) => Promise<Array<{ table: string; columns: number }>>;

// Measured on every scrape (once a minute): Mastra creates and alters its
// tables while the app runs, not only at startup. A failed query leaves the
// last value; one gauge per process, however many services ask for it.
export const registerMastraColumnsGauge = (query: Query) => {
  if (register.getSingleMetric(MASTRA_COLUMNS_METRIC)) {
    return;
  }
  new Gauge({
    name: MASTRA_COLUMNS_METRIC,
    help: 'Physical columns (dropped included) of the widest mastra_* table; Postgres stops at 1600',
    async collect() {
      try {
        const [widest] = await query(MASTRA_COLUMNS_SQL);
        this.set(widest?.columns ?? 0);
      } catch {
        // keep the last value
      }
    },
  });
};
