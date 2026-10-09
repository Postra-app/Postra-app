-- E2E-05-85: posting times become local time with an IANA zone, so 09:00
-- stays 09:00 when the clocks change. Every slot so far was stored as minutes
-- after UTC midnight from the browser's offset while the UK was on summer
-- time (+60), so the London wall-clock time is (minutes + 60) mod 1440 - the
-- times customers see today. Run before the clocks go back on 2026-10-25.
-- Data only, no schema change; a slot that already has a zone, or a value
-- that is not a JSON array of slots, is left as it is.
DO $$
DECLARE
  row RECORD;
BEGIN
  FOR row IN SELECT "id", "postingTimes" FROM "Integration" WHERE "postingTimes" NOT LIKE '%"tz"%' LOOP
    BEGIN
      UPDATE "Integration"
      SET "postingTimes" = (
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'time', ((((slot ->> 'time')::numeric)::int + 60) % 1440 + 1440) % 1440,
              'tz', 'Europe/London'
            )
            ORDER BY ord
          )::text,
          '[]'
        )
        FROM json_array_elements(row."postingTimes"::json) WITH ORDINALITY AS t(slot, ord)
      )
      WHERE "id" = row."id";
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'posting times of integration % left as they were: %', row."id", SQLERRM;
    END;
  END LOOP;
END $$;
