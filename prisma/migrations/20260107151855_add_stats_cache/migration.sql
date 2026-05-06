-- CreateTable
CREATE TABLE "StatsCache" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "uniqueDomains" INTEGER NOT NULL DEFAULT 0,
    "uniqueSelectors" INTEGER NOT NULL DEFAULT 0,
    "domainSelectorPairs" INTEGER NOT NULL DEFAULT 0,
    "dkimKeys" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatsCache_pkey" PRIMARY KEY ("id")
);
