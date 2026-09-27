-- Sync current database schema with Prisma migration history

ALTER TABLE "Email"
ADD COLUMN "isStarred" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Email"
ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "User"
ADD COLUMN "passwordHash" TEXT;

ALTER TABLE "User"
ALTER COLUMN "googleId" DROP NOT NULL;
