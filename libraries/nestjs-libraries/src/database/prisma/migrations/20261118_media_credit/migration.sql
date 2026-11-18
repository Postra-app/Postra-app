-- The photographer credit a stock library asks for (Unsplash), carried
-- into the text of a post the photo goes into. Empty for every other file.
ALTER TABLE "Media" ADD COLUMN "credit" TEXT;
