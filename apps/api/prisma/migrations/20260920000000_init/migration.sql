-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('INSTAGRAM', 'TIKTOK', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('YOUTUBE_API', 'GOOGLE_TRENDS', 'RSS', 'PUBLIC_WEB', 'MANUAL');

-- CreateEnum
CREATE TYPE "SignalKind" AS ENUM ('TREND', 'VIDEO', 'POST', 'NEWS', 'INSPIRATION');

-- CreateEnum
CREATE TYPE "SignalStatus" AS ENUM ('RAW', 'ANALYZED');

-- CreateEnum
CREATE TYPE "ProfileSignalStatus" AS ENUM ('NEW', 'SEEN', 'USED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "IdeaFormat" AS ENUM ('REEL', 'SHORT', 'CAROUSEL', 'POST', 'STORY');

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('IDEA', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ObjectiveMetric" AS ENUM ('FOLLOWERS', 'ENGAGEMENT_RATE', 'REACH', 'POSTS_PER_WEEK', 'LEADS');

-- CreateEnum
CREATE TYPE "ObjectiveStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'MISSED');

-- CreateEnum
CREATE TYPE "MetricSource" AS ENUM ('MANUAL', 'API');

-- CreateEnum
CREATE TYPE "CollectionRunStatus" AS ENUM ('RUNNING', 'OK', 'FAILED');

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "niche" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audience" TEXT,
    "voice" TEXT,
    "language" TEXT NOT NULL DEFAULT 'es',
    "scheduleHours" INTEGER,
    "nextRunAt" TIMESTAMP(3),
    "ideasPerWeek" INTEGER NOT NULL DEFAULT 3,
    "autoIdeasEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT,
    "businessId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "handle" TEXT NOT NULL,
    "url" TEXT,
    "followersBaseline" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Objective" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "metric" "ObjectiveMetric" NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "currentValue" DOUBLE PRECISION,
    "dueDate" TIMESTAMP(3),
    "status" "ObjectiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Objective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "params" JSONB NOT NULL,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalHours" INTEGER NOT NULL DEFAULT 24,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileSource" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalHours" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" "CollectionRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "itemsFound" INTEGER NOT NULL DEFAULT 0,
    "itemsNew" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "CollectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" "SignalKind" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "platform" "Platform",
    "publishedAt" TIMESTAMP(3),
    "region" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "raw" JSONB NOT NULL DEFAULT '{}',
    "status" "SignalStatus" NOT NULL DEFAULT 'RAW',
    "dupKey" TEXT,
    "duplicateOfId" TEXT,
    "dupDismissed" BOOLEAN NOT NULL DEFAULT false,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileSignal" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "relevanceScore" INTEGER NOT NULL DEFAULT 0,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "status" "ProfileSignalStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentIdea" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "format" "IdeaFormat" NOT NULL,
    "title" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "whyNow" TEXT NOT NULL,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bestTimes" JSONB NOT NULL DEFAULT '[]',
    "status" "IdeaStatus" NOT NULL DEFAULT 'IDEA',
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentIdea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdeaSignal" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "contribution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentDraft" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'es',
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "MetricSource" NOT NULL DEFAULT 'MANUAL',
    "followers" INTEGER,
    "reach" INTEGER,
    "impressions" INTEGER,
    "engagementRate" DOUBLE PRECISION,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceReport" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "whatWorked" JSONB NOT NULL DEFAULT '[]',
    "whatDidnt" JSONB NOT NULL DEFAULT '[]',
    "adjustments" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "profileId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachRun" (
    "id" TEXT NOT NULL,
    "profileId" TEXT,
    "job" TEXT NOT NULL,
    "model" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Profile_ownerId_idx" ON "Profile"("ownerId");

-- CreateIndex
CREATE INDEX "Profile_businessId_idx" ON "Profile"("businessId");

-- CreateIndex
CREATE INDEX "Profile_nextRunAt_idx" ON "Profile"("nextRunAt");

-- CreateIndex
CREATE INDEX "SocialAccount_profileId_idx" ON "SocialAccount"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_profileId_platform_handle_key" ON "SocialAccount"("profileId", "platform", "handle");

-- CreateIndex
CREATE INDEX "Objective_profileId_status_idx" ON "Objective"("profileId", "status");

-- CreateIndex
CREATE INDEX "Source_enabled_nextRunAt_idx" ON "Source"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "Source_kind_idx" ON "Source"("kind");

-- CreateIndex
CREATE INDEX "ProfileSource_sourceId_enabled_idx" ON "ProfileSource"("sourceId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileSource_profileId_sourceId_key" ON "ProfileSource"("profileId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionRun_requestId_key" ON "CollectionRun"("requestId");

-- CreateIndex
CREATE INDEX "CollectionRun_sourceId_idx" ON "CollectionRun"("sourceId");

-- CreateIndex
CREATE INDEX "CollectionRun_status_idx" ON "CollectionRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Signal_fingerprint_key" ON "Signal"("fingerprint");

-- CreateIndex
CREATE INDEX "Signal_sourceId_idx" ON "Signal"("sourceId");

-- CreateIndex
CREATE INDEX "Signal_platform_publishedAt_idx" ON "Signal"("platform", "publishedAt");

-- CreateIndex
CREATE INDEX "Signal_canonicalUrl_idx" ON "Signal"("canonicalUrl");

-- CreateIndex
CREATE INDEX "Signal_dupKey_idx" ON "Signal"("dupKey");

-- CreateIndex
CREATE INDEX "Signal_duplicateOfId_idx" ON "Signal"("duplicateOfId");

-- CreateIndex
CREATE INDEX "Signal_status_idx" ON "Signal"("status");

-- CreateIndex
CREATE INDEX "Signal_createdAt_idx" ON "Signal"("createdAt");

-- CreateIndex
CREATE INDEX "ProfileSignal_profileId_relevanceScore_idx" ON "ProfileSignal"("profileId", "relevanceScore");

-- CreateIndex
CREATE INDEX "ProfileSignal_profileId_status_idx" ON "ProfileSignal"("profileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileSignal_signalId_profileId_key" ON "ProfileSignal"("signalId", "profileId");

-- CreateIndex
CREATE INDEX "ContentIdea_profileId_scheduledFor_idx" ON "ContentIdea"("profileId", "scheduledFor");

-- CreateIndex
CREATE INDEX "ContentIdea_profileId_status_idx" ON "ContentIdea"("profileId", "status");

-- CreateIndex
CREATE INDEX "IdeaSignal_signalId_idx" ON "IdeaSignal"("signalId");

-- CreateIndex
CREATE UNIQUE INDEX "IdeaSignal_ideaId_signalId_key" ON "IdeaSignal"("ideaId", "signalId");

-- CreateIndex
CREATE INDEX "ContentDraft_ideaId_idx" ON "ContentDraft"("ideaId");

-- CreateIndex
CREATE INDEX "MetricSnapshot_socialAccountId_capturedAt_idx" ON "MetricSnapshot"("socialAccountId", "capturedAt");

-- CreateIndex
CREATE INDEX "MetricSnapshot_profileId_capturedAt_idx" ON "MetricSnapshot"("profileId", "capturedAt");

-- CreateIndex
CREATE INDEX "PerformanceReport_profileId_createdAt_idx" ON "PerformanceReport"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_profileId_createdAt_idx" ON "Notification"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_readAt_idx" ON "Notification"("readAt");

-- CreateIndex
CREATE INDEX "CoachRun_profileId_createdAt_idx" ON "CoachRun"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "CoachRun_job_createdAt_idx" ON "CoachRun"("job", "createdAt");

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Objective" ADD CONSTRAINT "Objective_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileSource" ADD CONSTRAINT "ProfileSource_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileSource" ADD CONSTRAINT "ProfileSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionRun" ADD CONSTRAINT "CollectionRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Signal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileSignal" ADD CONSTRAINT "ProfileSignal_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileSignal" ADD CONSTRAINT "ProfileSignal_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentIdea" ADD CONSTRAINT "ContentIdea_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaSignal" ADD CONSTRAINT "IdeaSignal_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ContentIdea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaSignal" ADD CONSTRAINT "IdeaSignal_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentDraft" ADD CONSTRAINT "ContentDraft_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ContentIdea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReport" ADD CONSTRAINT "PerformanceReport_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachRun" ADD CONSTRAINT "CoachRun_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Índice HNSW para la similitud de señales: NO va acá.
--
-- Se creaba en esta migración y en un server con pgvector viejo (o sin soporte HNSW)
-- hacía fallar TODA la migración `init` (P3009), dejando el arranque bloqueado por un
-- índice que es performance, no correctitud. Ahora lo asegura el boot, después de
-- migrar, desde `prisma/ensure-index.ts`: idempotente y tolerante (si no se puede,
-- avisa con la versión de pgvector y la app arranca igual).
--
-- Equivale a: CREATE INDEX IF NOT EXISTS "Signal_embedding_hnsw_idx"
--               ON "Signal" USING hnsw ("embedding" vector_cosine_ops);
