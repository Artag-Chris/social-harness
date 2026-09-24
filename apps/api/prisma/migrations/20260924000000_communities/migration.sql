-- CreateTable
CREATE TABLE "CommunityTarget" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "size" TEXT,
    "activity" TEXT,
    "audienceFit" INTEGER NOT NULL DEFAULT 0,
    "why" TEXT NOT NULL,
    "segmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "source" TEXT NOT NULL DEFAULT 'ia',
    "notes" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunityTarget_profileId_status_idx" ON "CommunityTarget"("profileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityTarget_profileId_kind_name_key" ON "CommunityTarget"("profileId", "kind", "name");

-- AddForeignKey
ALTER TABLE "CommunityTarget" ADD CONSTRAINT "CommunityTarget_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityTarget" ADD CONSTRAINT "CommunityTarget_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "AudienceSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
