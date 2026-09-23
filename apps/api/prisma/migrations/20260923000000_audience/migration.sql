-- CreateTable
CREATE TABLE "AudienceSegment" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "desires" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "objections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languageTips" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'ia',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudienceSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AudienceSegment_profileId_archivedAt_idx" ON "AudienceSegment"("profileId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AudienceSegment_profileId_name_key" ON "AudienceSegment"("profileId", "name");

-- AddForeignKey
ALTER TABLE "AudienceSegment" ADD CONSTRAINT "AudienceSegment_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
