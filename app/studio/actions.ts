'use server';

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  appendDistributionJobHistory,
  type CastStore,
  createDistributionJobHistoryEntry,
  type DistributionJobStatus,
  type PlatformConnector,
  type PodcastEpisode,
  type QueuedRelease,
  buildDistributionJobs,
  buildPublishedDistribution,
  distributionTargets,
  getDistributionTarget,
  getNextEpisodeNumber,
  slugify,
} from "@/lib/cast";
import {
  CastTenantAccessError,
  grantTenantAccess,
  requireTenantWorkspaceAccess,
  revokeTenantAccess,
} from "@/lib/cast-access";
import { getTenantWorkspace, saveTenantWorkspace } from "@/lib/cast-store";
import {
  processPendingDistributionJobs,
  runDistributionJobForTenant,
} from "@/lib/distribution-worker";
import {
  ObjectStorageConfigurationError,
  persistUpload,
  type StoredUpload,
} from "@/lib/object-storage";

export type ReleaseDraftState = {
  status: "idle" | "error" | "success";
  message: string;
  issues: string[];
  preview: {
    releaseId: string;
    slug: string;
    title: string;
    episodeNumber: number;
    scheduledFor: string;
    duration: string;
    summary: string;
    files: string[];
    audioTargets: string[];
    videoTargets: string[];
    nextChecks: string[];
  } | null;
};

const knownTargetIds = new Set<string>(distributionTargets.map((target) => target.id));

function readText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function readFileEntry(value: FormDataEntryValue | null) {
  return value instanceof File && value.size > 0 ? value : null;
}

function readInteger(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

function readStoredUpload(formData: FormData, prefix: "audio" | "video" | "artwork") {
  const publicPath = readText(formData.get(`${prefix}UploadPublicPath`));

  if (!publicPath) {
    return null;
  }

  const sourceName = readText(formData.get(`${prefix}UploadSourceName`));
  const byteLength = readInteger(formData.get(`${prefix}UploadByteLength`));
  const contentType = readText(formData.get(`${prefix}UploadContentType`));

  return {
    sourceName: sourceName || `${prefix}-upload`,
    publicPath,
    byteLength,
    contentType:
      contentType ||
      (prefix === "audio"
        ? "audio/mpeg"
        : prefix === "video"
          ? "video/mp4"
          : "image/png"),
  } satisfies StoredUpload;
}

function readTenantSlug(formData: FormData) {
  return readText(formData.get("tenantSlug"));
}

async function getActionOrigin() {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const protocol = headerStore.get("x-forwarded-proto") ?? "https";

  if (host) {
    return `${protocol}://${host}`;
  }

  return (
    process.env.PUBLIC_SITE_ORIGIN ??
    process.env.NEXT_PUBLIC_SITE_ORIGIN ??
    process.env.SITE_URL ??
    null
  );
}

function sanitizeTargetIds(entries: FormDataEntryValue[]) {
  return entries
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => knownTargetIds.has(entry));
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function getTargetLabels(targetIds: string[]) {
  return targetIds
    .map((targetId) => getDistributionTarget(targetId)?.label)
    .filter(isDefined);
}

function parseScheduledFor(value: string) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function buildQueuedReleaseId(episodeNumber: number) {
  return `release-${episodeNumber}-${Date.now()}`;
}

function buildEpisodeId(episodeNumber: number) {
  return `episode-${String(episodeNumber).padStart(3, "0")}`;
}

function sanitizeConnectorMode(value: string): PlatformConnector["mode"] {
  if (value === "api" || value === "manual") {
    return value;
  }

  return "rss";
}

function sanitizeConnectorReadiness(value: string): PlatformConnector["readiness"] {
  if (value === "ready" || value === "disabled") {
    return value;
  }

  return "setup";
}

function sanitizeYouTubePrivacyStatus(
  value: string,
): NonNullable<PlatformConnector["youtubeConfig"]>["privacyStatus"] {
  if (value === "public" || value === "unlisted") {
    return value;
  }

  return "private";
}

export async function createReleaseDraft(
  _previousState: ReleaseDraftState,
  formData: FormData,
): Promise<ReleaseDraftState> {
  const tenantSlug = readTenantSlug(formData);
  const title = readText(formData.get("title"));
  const summary = readText(formData.get("summary"));
  const scheduledFor = parseScheduledFor(readText(formData.get("scheduledFor")));
  const duration = readText(formData.get("duration")) || "00:30:00";
  const explicit = formData.get("explicit") === "on";
  const audioMaster = readFileEntry(formData.get("audioMaster"));
  const videoMaster = readFileEntry(formData.get("videoMaster"));
  const artwork = readFileEntry(formData.get("artwork"));
  const audioUploadReference = readStoredUpload(formData, "audio");
  const videoUploadReference = readStoredUpload(formData, "video");
  const artworkUploadReference = readStoredUpload(formData, "artwork");
  const audioTargets = sanitizeTargetIds(formData.getAll("audioTargets"));
  const videoTargets = sanitizeTargetIds(formData.getAll("videoTargets"));

  const issues: string[] = [];

  if (!title) {
    issues.push("Voer een episodetitel in.");
  }

  if (!summary) {
    issues.push("Voer een korte release-samenvatting in.");
  }

  if (!scheduledFor) {
    issues.push("Kies een geldige publicatiedatum en tijd.");
  }

  if (!artwork && !artworkUploadReference) {
    issues.push("Voeg artwork toe voor deze release.");
  }

  if (audioTargets.length > 0 && !audioMaster && !audioUploadReference) {
    issues.push("Kies een audiomaster voor de audio-platformen.");
  }

  if (videoTargets.length > 0 && !videoMaster && !videoUploadReference) {
    issues.push("Kies een videomaster voor YouTube of clips.");
  }

  if (audioTargets.length === 0 && videoTargets.length === 0) {
    issues.push("Selecteer minimaal één distributiedoel.");
  }

  if (issues.length > 0) {
    return {
      status: "error",
      message: "De release is nog niet compleet.",
      issues,
      preview: null,
    };
  }

  let workspace;

  try {
    workspace = await requireTenantWorkspaceAccess(tenantSlug);
  } catch (error) {
    return {
      status: "error",
      message: "Geen toegang tot deze castworkspace.",
      issues: [
        error instanceof Error
          ? error.message
          : "De tenanttoegang kon niet worden bevestigd.",
      ],
      preview: null,
    };
  }

  const store: CastStore = workspace;
  const slug = slugify(title);
  const episodeNumber = getNextEpisodeNumber(store);
  const seasonNumber = 1;
  const targetIds = [...new Set([...audioTargets, ...videoTargets])];

  let audioUpload = audioUploadReference;
  let videoUpload = videoUploadReference;
  let artworkUpload = artworkUploadReference;

  try {
    const [serverAudioUpload, serverVideoUpload, serverArtworkUpload] = await Promise.all([
      audioUpload ? Promise.resolve(null) : persistUpload(audioMaster, "audio", tenantSlug, slug),
      videoUpload ? Promise.resolve(null) : persistUpload(videoMaster, "video", tenantSlug, slug),
      artworkUpload ? Promise.resolve(null) : persistUpload(artwork, "artwork", tenantSlug, slug),
    ]);

    audioUpload = audioUpload ?? serverAudioUpload;
    videoUpload = videoUpload ?? serverVideoUpload;
    artworkUpload = artworkUpload ?? serverArtworkUpload;
  } catch (error) {
    if (error instanceof ObjectStorageConfigurationError) {
      return {
        status: "error",
        message: "Object storage is nog niet volledig geconfigureerd.",
        issues: [
          "Voeg de vereiste storage-variabelen toe voordat je nieuwe releases uploadt.",
          ...error.missing.map((item) => `Ontbreekt: ${item}`),
        ],
        preview: null,
      };
    }

    if (error instanceof CastTenantAccessError) {
      return {
        status: "error",
        message: "Geen toegang tot deze castworkspace.",
        issues: [error.message],
        preview: null,
      };
    }

    return {
      status: "error",
      message: "Uploaden naar de media-opslag is mislukt.",
      issues: [
        "Controleer de storage-configuratie en probeer de release daarna opnieuw op te slaan.",
      ],
      preview: null,
    };
  }

  if (!artworkUpload || !scheduledFor) {
    return {
      status: "error",
      message: "Artwork of planning kon niet worden opgeslagen.",
      issues: ["Controleer het artworkbestand en probeer opnieuw."],
      preview: null,
    };
  }

  const queuedRelease: QueuedRelease = {
    id: buildQueuedReleaseId(episodeNumber),
    slug,
    title,
    summary,
    scheduledFor,
    createdAt: new Date().toISOString(),
    duration,
    seasonNumber,
    episodeNumber,
    explicit,
    status: "queued",
    audioMasterName: audioUpload?.sourceName ?? audioMaster?.name ?? null,
    audioMasterPath: audioUpload?.publicPath ?? null,
    audioBytes: audioUpload?.byteLength ?? 0,
    audioMimeType: audioUpload?.contentType ?? null,
    videoMasterName: videoUpload?.sourceName ?? videoMaster?.name ?? null,
    videoMasterPath: videoUpload?.publicPath ?? null,
    videoBytes: videoUpload?.byteLength ?? 0,
    videoMimeType: videoUpload?.contentType ?? null,
    artworkName: artworkUpload.sourceName,
    artworkPath: artworkUpload.publicPath,
    targetIds,
  };

  const nextWorkspace = {
    ...workspace,
    queuedReleases: [...store.queuedReleases, queuedRelease],
  };

  await saveTenantWorkspace(nextWorkspace);
  revalidatePath("/");
  revalidatePath(`/studio/${workspace.tenant.slug}`);

  return {
    status: "success",
    message:
      "Queued release opgeslagen. Assets staan in de media-opslag en je kunt hem nu vanuit de studio doorzetten naar de feed.",
    issues: [],
    preview: {
      releaseId: queuedRelease.id,
      slug,
      title,
      episodeNumber,
      scheduledFor,
      duration,
      summary,
      files: [
        audioUpload?.publicPath,
        videoUpload?.publicPath,
        artworkUpload.publicPath,
      ].filter(isDefined),
      audioTargets: getTargetLabels(audioTargets),
      videoTargets: getTargetLabels(videoTargets),
      nextChecks: [
        "Controleer de queued releasekaart in de studio.",
        "Gebruik daarna de publish-knop om de episode in de feed te zetten.",
        "Loop daarna de distributiejobs en connectorstatus in de studio na.",
      ],
    },
  };
}

export async function publishQueuedRelease(formData: FormData) {
  const tenantSlug = readTenantSlug(formData);
  const releaseId = readText(formData.get("releaseId"));

  if (!releaseId) {
    return;
  }

  let workspace;

  try {
    workspace = await requireTenantWorkspaceAccess(tenantSlug);
  } catch {
    return;
  }

  const store: CastStore = workspace;
  const release = store.queuedReleases.find((item) => item.id === releaseId);

  if (!release || !release.audioMasterPath) {
    return;
  }

  const publishedAt = new Date().toISOString();
  const episode: PodcastEpisode = {
    id: buildEpisodeId(release.episodeNumber),
    slug: release.slug,
    title: release.title,
    summary: release.summary,
    description: release.summary,
    publishedAt,
    duration: release.duration,
    audioPath: release.audioMasterPath,
    audioBytes: release.audioBytes,
    audioMimeType: release.audioMimeType ?? "audio/mpeg",
    videoPath: release.videoMasterPath ?? null,
    videoBytes: release.videoBytes ?? 0,
    videoMimeType: release.videoMimeType ?? null,
    artworkPath: release.artworkPath,
    seasonNumber: release.seasonNumber,
    episodeNumber: release.episodeNumber,
    explicit: release.explicit,
    status: "published",
    distribution: buildPublishedDistribution(release.targetIds, store.connectors),
  };
  const jobs = buildDistributionJobs({
    episodeId: episode.id,
    episodeTitle: episode.title,
    targetIds: release.targetIds,
    createdAt: publishedAt,
    connectors: store.connectors,
  });

  const nextWorkspace = {
    ...workspace,
    publishedEpisodes: [episode, ...store.publishedEpisodes],
    queuedReleases: store.queuedReleases.filter((item) => item.id !== releaseId),
    distributionJobs: [...jobs, ...store.distributionJobs],
  };

  await saveTenantWorkspace(nextWorkspace);
  revalidatePath("/");
  revalidatePath(`/studio/${workspace.tenant.slug}`);
  revalidatePath(workspace.show.feedPath);
}

export async function saveConnectorConfig(formData: FormData) {
  const tenantSlug = readTenantSlug(formData);
  const targetId = readText(formData.get("targetId"));
  const mode = sanitizeConnectorMode(readText(formData.get("mode")));
  const readiness = sanitizeConnectorReadiness(readText(formData.get("readiness")));
  const accountLabel = readText(formData.get("accountLabel"));
  const destination = readText(formData.get("destination"));
  const note = readText(formData.get("note"));
  const youtubeClientId = readText(formData.get("youtubeClientId"));
  const youtubeClientSecret = readText(formData.get("youtubeClientSecret"));
  const youtubeRefreshToken = readText(formData.get("youtubeRefreshToken"));
  const youtubePrivacyStatus = sanitizeYouTubePrivacyStatus(
    readText(formData.get("youtubePrivacyStatus")),
  );
  const youtubeCategoryId = readText(formData.get("youtubeCategoryId"));

  if (!targetId || !distributionTargets.some((target) => target.id === targetId)) {
    return;
  }

  let workspace;

  try {
    workspace = await requireTenantWorkspaceAccess(tenantSlug);
  } catch {
    return;
  }

  const store: CastStore = workspace;
  const updatedAt = new Date().toISOString();
  const nextConnectors = store.connectors.map((connector) =>
    connector.targetId === targetId
      ? {
          ...connector,
          mode,
          readiness,
          accountLabel,
          destination,
          note,
          updatedAt,
          youtubeConfig:
            targetId === "youtube"
              ? {
                  clientId:
                    youtubeClientId ||
                    connector.youtubeConfig?.clientId ||
                    null,
                  clientSecret:
                    youtubeClientSecret ||
                    connector.youtubeConfig?.clientSecret ||
                    null,
                  refreshToken:
                    youtubeRefreshToken ||
                    connector.youtubeConfig?.refreshToken ||
                    null,
                  privacyStatus:
                    youtubePrivacyStatus ||
                    connector.youtubeConfig?.privacyStatus ||
                    "private",
                  categoryId:
                    youtubeCategoryId ||
                    connector.youtubeConfig?.categoryId ||
                    "28",
                }
              : connector.youtubeConfig ?? null,
        }
      : connector,
  );

  const nextWorkspace = {
    ...workspace,
    connectors: nextConnectors,
  };

  await saveTenantWorkspace(nextWorkspace);
  revalidatePath(`/studio/${workspace.tenant.slug}`);
}

function mapJobStatusToDistributionState(
  status: DistributionJobStatus,
  jobKind?: string,
) {
  if (status === "completed") {
    return {
      state: jobKind === "feed-ingest" ? ("review" as const) : ("live" as const),
      note:
        jobKind === "feed-ingest"
          ? "Feed-handoff is gevalideerd vanuit de studio job board."
          : "Connectorstap afgerond vanuit de studio job board.",
    };
  }

  if (status === "processing") {
    return {
      state: "review" as const,
      note: "Connectorjob wordt nu verwerkt.",
    };
  }

  if (status === "failed") {
    return {
      state: "manual" as const,
      note: "Connectorjob heeft handmatige opvolging nodig.",
    };
  }

  return {
    state: "queued" as const,
    note: "Connectorjob wacht nog in de distributierij.",
  };
}

export async function updateDistributionJobStatus(formData: FormData) {
  const tenantSlug = readTenantSlug(formData);
  const jobId = readText(formData.get("jobId"));
  const status = readText(formData.get("status")) as DistributionJobStatus;

  if (!jobId || !["pending", "processing", "completed", "failed"].includes(status)) {
    return;
  }

  let workspace;

  try {
    workspace = await requireTenantWorkspaceAccess(tenantSlug);
  } catch {
    return;
  }

  const store: CastStore = workspace;
  const timestamp = new Date().toISOString();

  const nextJobs = store.distributionJobs.map((job) =>
    job.id === jobId
      ? (() => {
          const nextNote =
            status === "completed"
              ? "Job afgerond en platformstatus bijgewerkt."
              : status === "processing"
                ? "Job staat nu actief te draaien."
                : status === "failed"
                  ? "Job is gefaald en wacht op handmatige opvolging of retry."
                  : "Job is teruggezet naar de wachtrij.";

          return {
            ...job,
            status,
            updatedAt: timestamp,
            note: nextNote,
            lastErrorAt:
              status === "failed"
                ? timestamp
                : status === "completed"
                  ? null
                  : job.lastErrorAt ?? null,
            nextRetryAt: null,
            history: appendDistributionJobHistory(
              job,
              createDistributionJobHistoryEntry({
                jobId: job.id,
                at: timestamp,
                event: "status-updated",
                note: nextNote,
                fromStatus: job.status,
                toStatus: status,
                attemptCount: job.attemptCount,
                externalUrl: job.externalUrl ?? null,
                externalId: job.externalId ?? null,
              }),
            ),
          };
        })()
      : job,
  );

  const updatedJob = nextJobs.find((job) => job.id === jobId);

  if (!updatedJob) {
    return;
  }

  const distributionUpdate = mapJobStatusToDistributionState(
    status,
    updatedJob.kind,
  );
  const nextEpisodes = store.publishedEpisodes.map((episode) =>
    episode.id === updatedJob.episodeId
      ? {
          ...episode,
          distribution: episode.distribution.map((item) =>
            item.targetId === updatedJob.targetId
              ? {
                  ...item,
                  state: distributionUpdate.state,
                  note: distributionUpdate.note,
                  externalUrl: updatedJob.externalUrl ?? null,
                  externalId: updatedJob.externalId ?? null,
                  syncedAt: timestamp,
                }
              : item,
          ),
        }
      : episode,
  );

  const nextWorkspace = {
    ...workspace,
    publishedEpisodes: nextEpisodes,
    distributionJobs: nextJobs,
  };

  await saveTenantWorkspace(nextWorkspace);
  revalidatePath(`/studio/${workspace.tenant.slug}`);
}

export async function runDistributionJob(formData: FormData) {
  const tenantSlug = readTenantSlug(formData);
  const jobId = readText(formData.get("jobId"));

  if (!tenantSlug || !jobId) {
    return;
  }

  try {
    await requireTenantWorkspaceAccess(tenantSlug);
  } catch {
    return;
  }

  await runDistributionJobForTenant({
    tenantSlug,
    jobId,
    origin: await getActionOrigin(),
  });
  revalidatePath(`/studio/${tenantSlug}`);
}

export async function runPendingDistributionQueue(formData: FormData) {
  const tenantSlug = readTenantSlug(formData);

  if (!tenantSlug) {
    return;
  }

  try {
    await requireTenantWorkspaceAccess(tenantSlug);
  } catch {
    return;
  }

  await processPendingDistributionJobs({
    origin: await getActionOrigin(),
    tenantSlug,
  });

  revalidatePath(`/studio/${tenantSlug}`);
}

export async function unlockTenantStudio(formData: FormData) {
  const tenantSlug = readTenantSlug(formData);
  const accessCode = readText(formData.get("accessCode"));
  const workspace = await getTenantWorkspace(tenantSlug);

  if (!workspace) {
    redirect("/studio");
  }

  if (accessCode !== workspace.tenant.accessCode) {
    redirect(`/studio/${workspace.tenant.slug}?access=invalid`);
  }

  await grantTenantAccess(workspace.tenant);
  redirect(`/studio/${workspace.tenant.slug}`);
}

export async function lockTenantStudio(formData: FormData) {
  const tenantSlug = readTenantSlug(formData);

  if (tenantSlug) {
    await revokeTenantAccess(tenantSlug);
  }

  redirect("/studio");
}
