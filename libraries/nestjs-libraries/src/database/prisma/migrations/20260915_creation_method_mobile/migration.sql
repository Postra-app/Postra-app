-- Posts made in the native app were filed as WEB: the controller passed the
-- literal 'WEB' regardless of the `x-client: mobile` header the app already
-- sends. Nothing broke, but after the app ships there would be no way to tell
-- how much posting actually happens on a phone.
--
-- Additive: existing rows keep their value, and WEB stays the default for
-- anything that does not identify itself.

ALTER TYPE "CreationMethod" ADD VALUE IF NOT EXISTS 'MOBILE';
