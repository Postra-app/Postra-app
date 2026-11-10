-- A still frame of each video for lists: the phone app showed a
-- bare play icon for every video. Filled after upload and by the daily
-- housekeeping run, which also covers the videos already stored. Additive.
ALTER TABLE "Media" ADD COLUMN "poster" TEXT;
