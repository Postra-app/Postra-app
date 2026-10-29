import { register } from 'prom-client';
import {
  MASTRA_COLUMNS_METRIC,
  MASTRA_COLUMNS_SQL,
  registerMastraColumnsGauge,
} from './mastra.columns.metric';

// The guard in MastraService resets two known tables at startup; nothing
// watched the others, and the last count by hand was 10-16. This gauge is
// what the Grafana rule alerts on.
describe('mastra columns gauge', () => {
  afterEach(() => register.removeSingleMetric(MASTRA_COLUMNS_METRIC));

  const value = async () =>
    (await register.getSingleMetric(MASTRA_COLUMNS_METRIC)!.get()).values[0]?.value;

  it('reports the widest mastra table on every scrape', async () => {
    let columns = 49;
    const query = jest.fn(async () => [{ table: 'mastra_ai_spans', columns }]);
    registerMastraColumnsGauge(query);

    expect(await value()).toBe(49);
    columns = 1012;
    expect(await value()).toBe(1012);
    expect(query).toHaveBeenCalledWith(MASTRA_COLUMNS_SQL);
  });

  it('keeps the last value when the database does not answer', async () => {
    let fail = false;
    registerMastraColumnsGauge(async () => {
      if (fail) throw new Error('connection refused');
      return [{ table: 'mastra_threads', columns: 12 }];
    });
    expect(await value()).toBe(12);
    fail = true;
    expect(await value()).toBe(12);
  });

  it('registers once however many services ask', () => {
    registerMastraColumnsGauge(async () => []);
    expect(() => registerMastraColumnsGauge(async () => [])).not.toThrow();
  });

  it('counts dropped columns, only mastra tables, in the public schema', () => {
    expect(MASTRA_COLUMNS_SQL).not.toMatch(/attisdropped/);
    expect(MASTRA_COLUMNS_SQL).toMatch(/LIKE 'mastra\\_%'/);
    expect(MASTRA_COLUMNS_SQL).toMatch(/nspname = 'public'/);
  });
});
