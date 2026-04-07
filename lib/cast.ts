export type DistributionLane = "audio" | "video" | "hybrid" | "clips";
export type DistributionState = "live" | "queued" | "review" | "manual";
export type DistributionJobStatus = "pending" | "processing" | "completed" | "failed";
export type DistributionJobKind =
  | "feed-ingest"
  | "platform-upload"
  | "clip-render"
  | "clip-export";
export type DistributionJobHistoryEvent =
  | "queued"
  | "started"
  | "completed"
  | "failed"
  | "retry-scheduled"
  | "status-updated";
export type EpisodeStatus = "published" | "queued" | "draft";
export type ConnectorMode = "rss" | "api" | "manual";
export type ConnectorReadiness = "ready" | "setup" | "disabled";
export type YouTubePrivacyStatus = "private" | "unlisted" | "public";
export type ClipPlatform = "shorts" | "reels" | "tiktok";
export type ClipRenderTemplateId = "clean" | "bold" | "ticker";

export const defaultDistributionJobMaxAttempts = 3;

export type DistributionTarget = {
  id: string;
  label: string;
  lane: DistributionLane;
  route: string;
};

export type EpisodeDistribution = {
  targetId: string;
  state: DistributionState;
  note: string;
  externalUrl?: string | null;
  externalId?: string | null;
  syncedAt?: string | null;
};

export type DistributionJob = {
  id: string;
  episodeId: string;
  episodeTitle: string;
  targetId: string;
  lane: DistributionLane;
  kind: DistributionJobKind;
  status: DistributionJobStatus;
  createdAt: string;
  updatedAt: string;
  note: string;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt?: string | null;
  lastErrorAt?: string | null;
  nextRetryAt?: string | null;
  externalUrl?: string | null;
  externalId?: string | null;
  history: DistributionJobHistoryEntry[];
};

export type DistributionJobHistoryEntry = {
  id: string;
  at: string;
  event: DistributionJobHistoryEvent;
  note: string;
  fromStatus?: DistributionJobStatus | null;
  toStatus?: DistributionJobStatus | null;
  attemptCount?: number | null;
  nextRetryAt?: string | null;
  externalUrl?: string | null;
  externalId?: string | null;
};

export type PlatformConnector = {
  targetId: string;
  mode: ConnectorMode;
  readiness: ConnectorReadiness;
  accountLabel: string;
  destination: string;
  note: string;
  updatedAt: string;
  youtubeConfig?: {
    clientId: string | null;
    clientSecret: string | null;
    refreshToken: string | null;
    privacyStatus: YouTubePrivacyStatus;
    categoryId: string | null;
  } | null;
  instagramConfig?: {
    accessToken: string | null;
    igUserId: string | null;
    shareToFeed: boolean;
    apiVersion: string | null;
  } | null;
  tiktokConfig?: {
    accessToken: string | null;
    postMode: "direct" | "inbox";
    privacyLevel: string | null;
    disableDuet: boolean;
    disableComment: boolean;
    disableStitch: boolean;
  } | null;
  clipRenderConfig?: {
    defaultTemplateId: ClipRenderTemplateId;
    brandLabel: string | null;
  } | null;
};

export type ClipPlan = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  startSeconds: number;
  endSeconds: number;
  hook: string;
  caption: string;
  platforms: ClipPlatform[];
  templateId: ClipRenderTemplateId;
};

export type RenderedClipExport = {
  platform: ClipPlatform;
  state: "queued" | "completed" | "failed";
  note: string;
  externalUrl?: string | null;
  externalId?: string | null;
  exportedAt?: string | null;
};

export type RenderedClip = {
  id: string;
  sourcePlanId: string;
  title: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  hook: string;
  caption: string;
  platforms: ClipPlatform[];
  templateId: ClipRenderTemplateId;
  assetPath: string;
  assetBytes: number;
  assetMimeType: string;
  renderedAt: string;
  exports: RenderedClipExport[];
};

export type PodcastEpisode = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  publishedAt: string;
  duration: string;
  audioPath: string;
  audioBytes: number;
  audioMimeType: string;
  videoPath?: string | null;
  videoBytes?: number;
  videoMimeType?: string | null;
  artworkPath: string;
  seasonNumber: number;
  episodeNumber: number;
  explicit: boolean;
  status: EpisodeStatus;
  clipPlans: ClipPlan[];
  renderedClips: RenderedClip[];
  distribution: EpisodeDistribution[];
};

export type PodcastShow = {
  title: string;
  tagline: string;
  description: string;
  language: string;
  category: string;
  author: string;
  ownerName: string;
  ownerEmail: string;
  explicit: boolean;
  artworkPath: string;
  sitePath: string;
  feedPath: string;
};

export type QueuedRelease = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  scheduledFor: string;
  createdAt: string;
  duration: string;
  seasonNumber: number;
  episodeNumber: number;
  explicit: boolean;
  status: EpisodeStatus;
  audioMasterName: string | null;
  audioMasterPath: string | null;
  audioBytes: number;
  audioMimeType: string | null;
  videoMasterName: string | null;
  videoMasterPath: string | null;
  videoBytes?: number;
  videoMimeType?: string | null;
  artworkName: string;
  artworkPath: string;
  targetIds: string[];
  clipPlans: ClipPlan[];
};

export type CastStore = {
  show: PodcastShow;
  publishedEpisodes: PodcastEpisode[];
  queuedReleases: QueuedRelease[];
  distributionJobs: DistributionJob[];
  connectors: PlatformConnector[];
};

export type CastTenantProfile = {
  id: string;
  slug: string;
  companyId: string | null;
  companyName: string;
  studioLabel: string;
  accessCode: string;
  createdAt: string;
  updatedAt: string;
};

export type CastWorkspace = CastStore & {
  tenant: CastTenantProfile;
};

export type CastRegistry = {
  tenants: CastWorkspace[];
};

export const distributionTargets: DistributionTarget[] = [
  {
    id: "spotify",
    label: "Spotify",
    lane: "hybrid",
    route: "Audio via RSS-feed, video via aparte creator-flow.",
  },
  {
    id: "apple",
    label: "Apple Podcasts",
    lane: "audio",
    route: "Leest de publieke podcastfeed met iTunes metadata.",
  },
  {
    id: "youtube",
    label: "YouTube",
    lane: "video",
    route: "Vraagt een video-upload, thumbnail en hoofdstukken.",
  },
  {
    id: "shorts",
    label: "YouTube Shorts",
    lane: "clips",
    route: "Uploadt korte vertical masters als aparte YouTube Shorts exports.",
  },
  {
    id: "reels",
    label: "Instagram Reels",
    lane: "clips",
    route: "Publiceert vertical clipmasters via de Instagram publishing flow.",
  },
  {
    id: "tiktok",
    label: "TikTok",
    lane: "clips",
    route: "Publiceert korte vertical clipmasters via de TikTok posting flow.",
  },
  {
    id: "pocketcasts",
    label: "Pocket Casts",
    lane: "audio",
    route: "Synct automatisch vanaf de publieke audiofeed.",
  },
  {
    id: "overcast",
    label: "Overcast",
    lane: "audio",
    route: "Leest dezelfde publieke RSS-feed als andere directories.",
  },
  {
    id: "clips",
    label: "Short-form clips",
    lane: "clips",
    route: "Gebruikt afgeleide vertical renders voor Shorts, Reels en TikTok.",
  },
];

export const clipPlatforms: Array<{
  id: ClipPlatform;
  label: string;
}> = [
  {
    id: "shorts",
    label: "YouTube Shorts",
  },
  {
    id: "reels",
    label: "Instagram Reels",
  },
  {
    id: "tiktok",
    label: "TikTok",
  },
];

export const clipRenderTemplates: Array<{
  id: ClipRenderTemplateId;
  label: string;
  description: string;
}> = [
  {
    id: "clean",
    label: "Clean",
    description: "Rustige lower third met compacte brand-tag en subtitleblok.",
  },
  {
    id: "bold",
    label: "Bold",
    description: "Grote hook bovenin met stevige subtitleband onderin.",
  },
  {
    id: "ticker",
    label: "Ticker",
    description: "Horizontale brandbar bovenin en subtitelstrook in newsroom-stijl.",
  },
];

export const defaultPodcastShow: PodcastShow = {
  title: "IvariumLabs Cast",
  tagline: "Audio en videocasts vanuit één release cockpit.",
  description:
    "Een feed-first podcastsysteem voor gesprekken, behind-the-scenes afleveringen en video-first distributie vanuit één centrale release.",
  language: "nl-nl",
  category: "Technology",
  author: "Ivar van Teijlingen",
  ownerName: "Ivar van Teijlingen",
  ownerEmail: "podcast@ivariumlabs.com",
  explicit: false,
  artworkPath: "/cast-artwork.svg",
  sitePath: "/studio",
  feedPath: "/feed.xml",
};

export const defaultTenantSlug = "ivariumlabs";
export const defaultTenantAccessCode = "ivariumlabs-studio";

export function buildTenantPaths(tenantSlug: string) {
  return {
    sitePath: `/studio/${tenantSlug}`,
    feedPath: `/feed/${tenantSlug}/feed.xml`,
  };
}

export function buildCastWorkspaceDocumentId(tenantSlug: string) {
  const normalizedSlug = slugify(tenantSlug) || defaultTenantSlug;

  return `castWorkspace.${normalizedSlug}`;
}

export function createTenantProfile(args?: Partial<CastTenantProfile>): CastTenantProfile {
  const slug = slugify(args?.slug ?? args?.companyName ?? defaultTenantSlug) || defaultTenantSlug;
  const timestamp = args?.updatedAt ?? args?.createdAt ?? "2026-04-04T09:00:00.000Z";
  const companyId =
    typeof args?.companyId === "string" && args.companyId.trim()
      ? args.companyId.trim()
      : null;

  return {
    id: args?.id ?? `tenant-${slug}`,
    slug,
    companyId,
    companyName: args?.companyName ?? "IvariumLabs",
    studioLabel: args?.studioLabel ?? `${args?.companyName ?? "IvariumLabs"} Cast`,
    accessCode: args?.accessCode ?? `${slug}-studio`,
    createdAt: args?.createdAt ?? timestamp,
    updatedAt: args?.updatedAt ?? timestamp,
  };
}

function sanitizeYouTubePrivacyStatus(value: string | null | undefined): YouTubePrivacyStatus {
  if (value === "public" || value === "unlisted") {
    return value;
  }

  return "private";
}

function sanitizeClipRenderTemplateId(
  value: string | null | undefined,
): ClipRenderTemplateId {
  if (value === "bold" || value === "ticker") {
    return value;
  }

  return "clean";
}

function normalizeYouTubeConfig(
  connector: PlatformConnector,
): NonNullable<PlatformConnector["youtubeConfig"]> | null {
  const source = connector.youtubeConfig;

  if (!source && connector.targetId !== "youtube") {
    return null;
  }

  return {
    clientId:
      typeof source?.clientId === "string" && source.clientId.trim()
        ? source.clientId.trim()
        : null,
    clientSecret:
      typeof source?.clientSecret === "string" && source.clientSecret.trim()
        ? source.clientSecret.trim()
        : null,
    refreshToken:
      typeof source?.refreshToken === "string" && source.refreshToken.trim()
        ? source.refreshToken.trim()
        : null,
    privacyStatus: sanitizeYouTubePrivacyStatus(source?.privacyStatus),
    categoryId:
      typeof source?.categoryId === "string" && source.categoryId.trim()
        ? source.categoryId.trim()
        : "28",
  };
}

function normalizeInstagramConfig(
  connector: PlatformConnector,
): NonNullable<PlatformConnector["instagramConfig"]> | null {
  const source = connector.instagramConfig;

  if (!source && connector.targetId !== "reels") {
    return null;
  }

  return {
    accessToken:
      typeof source?.accessToken === "string" && source.accessToken.trim()
        ? source.accessToken.trim()
        : null,
    igUserId:
      typeof source?.igUserId === "string" && source.igUserId.trim()
        ? source.igUserId.trim()
        : null,
    shareToFeed: source?.shareToFeed ?? true,
    apiVersion:
      typeof source?.apiVersion === "string" && source.apiVersion.trim()
        ? source.apiVersion.trim()
        : "v23.0",
  };
}

function normalizeTikTokConfig(
  connector: PlatformConnector,
): NonNullable<PlatformConnector["tiktokConfig"]> | null {
  const source = connector.tiktokConfig;

  if (!source && connector.targetId !== "tiktok") {
    return null;
  }

  return {
    accessToken:
      typeof source?.accessToken === "string" && source.accessToken.trim()
        ? source.accessToken.trim()
        : null,
    postMode: source?.postMode === "inbox" ? "inbox" : "direct",
    privacyLevel:
      typeof source?.privacyLevel === "string" && source.privacyLevel.trim()
        ? source.privacyLevel.trim()
        : "SELF_ONLY",
    disableDuet: source?.disableDuet ?? false,
    disableComment: source?.disableComment ?? false,
    disableStitch: source?.disableStitch ?? false,
  };
}

function normalizeClipRenderConfig(
  connector: PlatformConnector,
): NonNullable<PlatformConnector["clipRenderConfig"]> | null {
  const source = connector.clipRenderConfig;

  if (!source && connector.targetId !== "clips") {
    return null;
  }

  return {
    defaultTemplateId: sanitizeClipRenderTemplateId(source?.defaultTemplateId),
    brandLabel:
      typeof source?.brandLabel === "string" && source.brandLabel.trim()
        ? source.brandLabel.trim()
        : null,
  };
}

function buildDefaultConnector(target: DistributionTarget): PlatformConnector {
  const updatedAt = "2026-04-04T09:00:00.000Z";

  if (target.lane === "audio" || target.lane === "hybrid") {
    return {
      targetId: target.id,
      mode: "rss",
      readiness: "ready",
      accountLabel: "Primary show",
      destination: "feed.xml ingest",
      note: "Audio-publicatie loopt via de feed-first laag.",
      updatedAt,
    };
  }

  if (target.id === "youtube") {
    return {
      targetId: target.id,
      mode: "api",
      readiness: "setup",
      accountLabel: "",
      destination: "",
      note: "YouTube API-connector wacht nog op credentials en optionele playlistroute.",
      updatedAt,
      youtubeConfig: {
        clientId: null,
        clientSecret: null,
        refreshToken: null,
        privacyStatus: "private",
        categoryId: "28",
      },
    };
  }

  if (target.id === "shorts") {
    return {
      targetId: target.id,
      mode: "api",
      readiness: "setup",
      accountLabel: "",
      destination: "",
      note: "YouTube Shorts-export gebruikt dezelfde accountkoppeling als video-uploads of een eigen tenantconfig.",
      updatedAt,
      youtubeConfig: {
        clientId: null,
        clientSecret: null,
        refreshToken: null,
        privacyStatus: "private",
        categoryId: "28",
      },
    };
  }

  if (target.id === "reels") {
    return {
      targetId: target.id,
      mode: "api",
      readiness: "setup",
      accountLabel: "",
      destination: "",
      note: "Instagram Reels-export wacht nog op een tenant access token en Instagram user id.",
      updatedAt,
      instagramConfig: {
        accessToken: null,
        igUserId: null,
        shareToFeed: true,
        apiVersion: "v23.0",
      },
    };
  }

  if (target.id === "tiktok") {
    return {
      targetId: target.id,
      mode: "api",
      readiness: "setup",
      accountLabel: "",
      destination: "",
      note: "TikTok export wacht nog op een tenant access token en posting-configuratie.",
      updatedAt,
      tiktokConfig: {
        accessToken: null,
        postMode: "direct",
        privacyLevel: "SELF_ONLY",
        disableDuet: false,
        disableComment: false,
        disableStitch: false,
      },
    };
  }

  if (target.id === "clips") {
    return {
      targetId: target.id,
      mode: "api",
      readiness: "ready",
      accountLabel: "Render pipeline",
      destination: "vertical-9x16 pack",
      note: "Interne cliprenderer maakt korte verticale masters voor Shorts, Reels en TikTok.",
      updatedAt,
      clipRenderConfig: {
        defaultTemplateId: "clean",
        brandLabel: null,
      },
    };
  }

  return {
    targetId: target.id,
    mode: "manual",
    readiness: "setup",
    accountLabel: "",
    destination: "",
    note: "Connectorconfiguratie ontbreekt nog voor deze route.",
    updatedAt,
  };
}

export function createDefaultConnectors(): PlatformConnector[] {
  return distributionTargets.map((target) => buildDefaultConnector(target));
}

export function createEmptyCastStore(): CastStore {
  return {
    show: defaultPodcastShow,
    publishedEpisodes: [],
    queuedReleases: [],
    distributionJobs: [],
    connectors: createDefaultConnectors(),
  };
}

export function createCastWorkspace(args?: {
  tenant?: Partial<CastTenantProfile>;
  store?: Partial<CastStore>;
}): CastWorkspace {
  const tenant = createTenantProfile(args?.tenant);
  const paths = buildTenantPaths(tenant.slug);
  const baseStore = createEmptyCastStore();
  const store = normalizeCastStore({
    ...baseStore,
    ...args?.store,
    show: {
      ...baseStore.show,
      ...args?.store?.show,
      ...paths,
    },
  });

  return {
    tenant,
    ...store,
  };
}

export function createEmptyCastRegistry(): CastRegistry {
  return {
    tenants: [
      createCastWorkspace({
        tenant: {
          slug: defaultTenantSlug,
          companyName: "IvariumLabs",
          studioLabel: "IvariumLabs Cast",
          accessCode: defaultTenantAccessCode,
        },
      }),
    ],
  };
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

export function getDistributionTarget(targetId: string) {
  return distributionTargets.find((target) => target.id === targetId);
}

export function getTargets(targetIds: readonly string[]): DistributionTarget[] {
  return targetIds
    .map((targetId) => getDistributionTarget(targetId))
    .filter((target): target is DistributionTarget => Boolean(target));
}

export function getConnector(
  connectors: PlatformConnector[],
  targetId: string,
) {
  return connectors.find((connector) => connector.targetId === targetId);
}

function buildDistributionJobHistoryEntryId(args: {
  jobId?: string;
  at: string;
  event: DistributionJobHistoryEvent;
  attemptCount?: number | null;
  toStatus?: DistributionJobStatus | null;
}) {
  const id = slugify(
    [
      args.jobId ?? "job",
      args.event,
      args.at,
      typeof args.attemptCount === "number" ? `attempt-${args.attemptCount}` : "",
      args.toStatus ?? "",
    ]
      .filter(Boolean)
      .join("-"),
  );

  return id || "distribution-job-history-entry";
}

export function createDistributionJobHistoryEntry(args: {
  jobId?: string;
  id?: string;
  at: string;
  event: DistributionJobHistoryEvent;
  note: string;
  fromStatus?: DistributionJobStatus | null;
  toStatus?: DistributionJobStatus | null;
  attemptCount?: number | null;
  nextRetryAt?: string | null;
  externalUrl?: string | null;
  externalId?: string | null;
}): DistributionJobHistoryEntry {
  return {
    id:
      args.id ??
      buildDistributionJobHistoryEntryId({
        jobId: args.jobId,
        at: args.at,
        event: args.event,
        attemptCount: args.attemptCount ?? null,
        toStatus: args.toStatus ?? null,
      }),
    at: args.at,
    event: args.event,
    note: args.note,
    fromStatus: args.fromStatus ?? null,
    toStatus: args.toStatus ?? null,
    attemptCount: args.attemptCount ?? null,
    nextRetryAt: args.nextRetryAt ?? null,
    externalUrl: args.externalUrl ?? null,
    externalId: args.externalId ?? null,
  };
}

function sortDistributionJobHistory(history: DistributionJobHistoryEntry[]) {
  return [...history].sort((left, right) => right.at.localeCompare(left.at));
}

function normalizeDistributionJobHistoryEntry(
  entry: DistributionJobHistoryEntry,
): DistributionJobHistoryEntry {
  return {
    ...entry,
    id:
      typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : buildDistributionJobHistoryEntryId({
            at: entry.at,
            event: entry.event,
            attemptCount: entry.attemptCount ?? null,
            toStatus: entry.toStatus ?? null,
          }),
    fromStatus: entry.fromStatus ?? null,
    toStatus: entry.toStatus ?? null,
    attemptCount: entry.attemptCount ?? null,
    nextRetryAt: entry.nextRetryAt ?? null,
    externalUrl: entry.externalUrl ?? null,
    externalId: entry.externalId ?? null,
  };
}

function buildFallbackDistributionJobHistory(
  job: DistributionJob,
): DistributionJobHistoryEntry[] {
  const fallbackAt = job.lastAttemptAt ?? job.lastErrorAt ?? job.updatedAt ?? job.createdAt;
  const fallbackEvent: DistributionJobHistoryEvent =
    job.status === "pending"
      ? "queued"
      : job.status === "processing"
        ? "started"
        : job.status === "completed"
          ? "completed"
          : "failed";

  return [
    createDistributionJobHistoryEntry({
      id: `${job.id}-legacy-${slugify(fallbackAt) || "event"}`,
      jobId: job.id,
      at: fallbackAt,
      event: fallbackEvent,
      note: job.note || "Legacy distributiejob is aan de audit trail toegevoegd.",
      fromStatus: null,
      toStatus: job.status,
      attemptCount: job.attemptCount ?? 0,
      nextRetryAt: job.nextRetryAt ?? null,
      externalUrl: job.externalUrl ?? null,
      externalId: job.externalId ?? null,
    }),
  ];
}

export function appendDistributionJobHistory(
  job: DistributionJob,
  entry: DistributionJobHistoryEntry,
) {
  return sortDistributionJobHistory([
    ...job.history,
    normalizeDistributionJobHistoryEntry(entry),
  ]);
}

const distributionJobRetryDelaysInMinutes = [5, 15, 60];

function getDistributionJobRetryDelayMinutes(attemptCount: number) {
  if (!Number.isFinite(attemptCount) || attemptCount <= 0) {
    return null;
  }

  const index = Math.min(
    Math.max(Math.trunc(attemptCount) - 1, 0),
    distributionJobRetryDelaysInMinutes.length - 1,
  );

  return distributionJobRetryDelaysInMinutes[index] ?? null;
}

export function getDistributionJobNextRetryAt(args: {
  job: DistributionJob;
  nextAttemptCount: number;
  failedAt: string;
}) {
  const maxAttempts =
    typeof args.job.maxAttempts === "number" && args.job.maxAttempts > 0
      ? Math.trunc(args.job.maxAttempts)
      : defaultDistributionJobMaxAttempts;

  if (args.nextAttemptCount >= maxAttempts) {
    return null;
  }

  const retryDelayMinutes = getDistributionJobRetryDelayMinutes(args.nextAttemptCount);

  if (!retryDelayMinutes) {
    return null;
  }

  return new Date(
    new Date(args.failedAt).getTime() + retryDelayMinutes * 60_000,
  ).toISOString();
}

export function isDistributionJobRetryDue(
  job: DistributionJob,
  at: string = new Date().toISOString(),
) {
  return (
    job.status === "failed" &&
    Boolean(job.nextRetryAt) &&
    Boolean(job.nextRetryAt && job.nextRetryAt <= at) &&
    job.attemptCount < job.maxAttempts
  );
}

function sortPublishedEpisodes(episodes: PodcastEpisode[]) {
  return [...episodes].sort((left, right) =>
    right.publishedAt.localeCompare(left.publishedAt),
  );
}

function normalizeDistributionItem(
  item: EpisodeDistribution,
): EpisodeDistribution {
  return {
    ...item,
    externalUrl: item.externalUrl ?? null,
    externalId: item.externalId ?? null,
    syncedAt: item.syncedAt ?? null,
  };
}

function normalizeClipPlan(plan: ClipPlan): ClipPlan {
  return {
    ...plan,
    hook: plan.hook ?? "",
    caption: plan.caption ?? "",
    platforms: Array.isArray(plan.platforms) ? [...plan.platforms] : [],
    templateId: sanitizeClipRenderTemplateId(plan.templateId),
  };
}

function normalizeRenderedClipExport(
  item: RenderedClipExport,
): RenderedClipExport {
  return {
    ...item,
    state:
      item.state === "completed" || item.state === "failed" ? item.state : "queued",
    note: item.note ?? "",
    externalUrl: item.externalUrl ?? null,
    externalId: item.externalId ?? null,
    exportedAt: item.exportedAt ?? null,
  };
}

function normalizeRenderedClip(clip: RenderedClip): RenderedClip {
  return {
    ...clip,
    hook: clip.hook ?? "",
    caption: clip.caption ?? "",
    platforms: Array.isArray(clip.platforms) ? [...clip.platforms] : [],
    templateId: sanitizeClipRenderTemplateId(clip.templateId),
    assetBytes: clip.assetBytes ?? 0,
    assetMimeType: clip.assetMimeType || "video/mp4",
    exports: Array.isArray(clip.exports)
      ? clip.exports.map((item) => normalizeRenderedClipExport(item))
      : [],
  };
}

function normalizePublishedEpisode(
  episode: PodcastEpisode,
): PodcastEpisode {
  return {
    ...episode,
    videoPath: episode.videoPath ?? null,
    videoBytes: episode.videoBytes ?? 0,
    videoMimeType: episode.videoMimeType ?? null,
    clipPlans: Array.isArray(episode.clipPlans)
      ? episode.clipPlans.map((plan) => normalizeClipPlan(plan))
      : [],
    renderedClips: Array.isArray(episode.renderedClips)
      ? episode.renderedClips.map((clip) => normalizeRenderedClip(clip))
      : [],
    distribution: episode.distribution.map((item) =>
      normalizeDistributionItem(item),
    ),
  };
}

function sortQueuedReleases(releases: QueuedRelease[]) {
  return [...releases].sort((left, right) =>
    left.scheduledFor.localeCompare(right.scheduledFor),
  );
}

function normalizeQueuedRelease(release: QueuedRelease): QueuedRelease {
  return {
    ...release,
    videoBytes: release.videoBytes ?? 0,
    videoMimeType: release.videoMimeType ?? null,
    clipPlans: Array.isArray(release.clipPlans)
      ? release.clipPlans.map((plan) => normalizeClipPlan(plan))
      : [],
  };
}

function sortDistributionJobs(jobs: DistributionJob[]) {
  return [...jobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function normalizeDistributionJob(job: DistributionJob): DistributionJob {
  const history = Array.isArray(job.history)
    ? job.history.map((entry) => normalizeDistributionJobHistoryEntry(entry))
    : buildFallbackDistributionJobHistory(job);

  return {
    ...job,
    attemptCount: job.attemptCount ?? 0,
    maxAttempts:
      typeof job.maxAttempts === "number" && job.maxAttempts > 0
        ? Math.trunc(job.maxAttempts)
        : defaultDistributionJobMaxAttempts,
    lastAttemptAt: job.lastAttemptAt ?? null,
    lastErrorAt: job.lastErrorAt ?? null,
    nextRetryAt: job.nextRetryAt ?? null,
    externalUrl: job.externalUrl ?? null,
    externalId: job.externalId ?? null,
    history: sortDistributionJobHistory(history),
  };
}

function sortConnectors(connectors: PlatformConnector[]) {
  const order = new Map(distributionTargets.map((target, index) => [target.id, index]));

  return [...connectors].sort(
    (left, right) =>
      (order.get(left.targetId) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.targetId) ?? Number.MAX_SAFE_INTEGER),
  );
}

function sortWorkspaces(workspaces: CastWorkspace[]) {
  return [...workspaces].sort((left, right) =>
    left.tenant.companyName.localeCompare(right.tenant.companyName),
  );
}

function normalizeTenantProfile(profile: CastTenantProfile) {
  const normalized = createTenantProfile(profile);

  return {
    ...normalized,
    companyId:
      typeof normalized.companyId === "string" && normalized.companyId.trim()
        ? normalized.companyId.trim()
        : null,
    slug: slugify(normalized.slug) || defaultTenantSlug,
  };
}

function mergeConnectors(connectors: PlatformConnector[] | undefined) {
  const defaults = createDefaultConnectors();

  return defaults.map((defaultConnector) => {
    const existing = connectors?.find(
      (connector) => connector.targetId === defaultConnector.targetId,
    );

    if (
      existing?.targetId === "clips" &&
      existing.mode === "manual" &&
      existing.readiness === "setup" &&
      !existing.accountLabel.trim() &&
      !existing.destination.trim() &&
      existing.note === "Connectorconfiguratie ontbreekt nog voor deze route."
    ) {
      return defaultConnector;
    }

    return existing
      ? {
          ...defaultConnector,
          ...existing,
          youtubeConfig:
            existing.targetId === "youtube" || existing.targetId === "shorts"
              ? normalizeYouTubeConfig({
                  ...defaultConnector,
                  ...existing,
                })
              : null,
          instagramConfig:
            existing.targetId === "reels"
              ? normalizeInstagramConfig({
                  ...defaultConnector,
                  ...existing,
                })
              : null,
          tiktokConfig:
            existing.targetId === "tiktok"
              ? normalizeTikTokConfig({
                  ...defaultConnector,
                  ...existing,
                })
              : null,
          clipRenderConfig:
            existing.targetId === "clips"
              ? normalizeClipRenderConfig({
                  ...defaultConnector,
                  ...existing,
                })
              : null,
        }
      : {
          ...defaultConnector,
          youtubeConfig:
            defaultConnector.targetId === "youtube" || defaultConnector.targetId === "shorts"
              ? normalizeYouTubeConfig(defaultConnector)
              : null,
          instagramConfig:
            defaultConnector.targetId === "reels"
              ? normalizeInstagramConfig(defaultConnector)
              : null,
          tiktokConfig:
            defaultConnector.targetId === "tiktok"
              ? normalizeTikTokConfig(defaultConnector)
              : null,
          clipRenderConfig:
            defaultConnector.targetId === "clips"
              ? normalizeClipRenderConfig(defaultConnector)
              : null,
        };
  });
}

export function normalizeCastStore(store: CastStore): CastStore {
  return {
    show: store.show,
    publishedEpisodes: sortPublishedEpisodes(
      store.publishedEpisodes.map((episode) => normalizePublishedEpisode(episode)),
    ),
    queuedReleases: sortQueuedReleases(
      store.queuedReleases.map((release) => normalizeQueuedRelease(release)),
    ),
    distributionJobs: sortDistributionJobs(
      (store.distributionJobs ?? []).map((job) => normalizeDistributionJob(job)),
    ),
    connectors: sortConnectors(mergeConnectors(store.connectors)),
  };
}

export function normalizeCastWorkspace(workspace: CastWorkspace): CastWorkspace {
  const tenant = normalizeTenantProfile(workspace.tenant);
  const { tenant: _ignored, ...store } = workspace;
  const normalizedStore = normalizeCastStore(store);

  return {
    tenant,
    ...normalizedStore,
    show: {
      ...normalizedStore.show,
      ...buildTenantPaths(tenant.slug),
    },
  };
}

export function normalizeCastRegistry(registry: CastRegistry): CastRegistry {
  return {
    tenants: sortWorkspaces(
      registry.tenants.map((workspace) => normalizeCastWorkspace(workspace)),
    ),
  };
}

export function getCastWorkspaceBySlug(
  registry: CastRegistry,
  tenantSlug: string,
) {
  const normalizedSlug = slugify(tenantSlug);

  return registry.tenants.find((workspace) => workspace.tenant.slug === normalizedSlug);
}

export function getDashboardStats(store: CastStore) {
  const audioTargets = distributionTargets.filter(
    (target) => target.lane === "audio" || target.lane === "hybrid",
  ).length;
  const videoTargets = distributionTargets.filter(
    (target) =>
      target.lane === "video" || target.lane === "hybrid" || target.lane === "clips",
  ).length;
  const queuedTargets = store.queuedReleases.reduce(
    (total, release) => total + release.targetIds.length,
    0,
  );

  return {
    publishedEpisodes: store.publishedEpisodes.length,
    queuedReleases: store.queuedReleases.length,
    distributionJobs: store.distributionJobs.length,
    audioTargets,
    videoTargets,
    queuedTargets,
  };
}

export function getJobBoardStats(store: CastStore) {
  const pending = store.distributionJobs.filter((job) => job.status === "pending").length;
  const processing = store.distributionJobs.filter(
    (job) => job.status === "processing",
  ).length;
  const completed = store.distributionJobs.filter(
    (job) => job.status === "completed",
  ).length;
  const failed = store.distributionJobs.filter((job) => job.status === "failed").length;
  const scheduled = store.distributionJobs.filter(
    (job) => job.status === "failed" && Boolean(job.nextRetryAt),
  ).length;

  return {
    pending,
    processing,
    completed,
    failed,
    scheduled,
  };
}

export function getConnectorBoardStats(store: CastStore) {
  const ready = store.connectors.filter((connector) => connector.readiness === "ready").length;
  const setup = store.connectors.filter((connector) => connector.readiness === "setup").length;
  const disabled = store.connectors.filter(
    (connector) => connector.readiness === "disabled",
  ).length;

  return {
    ready,
    setup,
    disabled,
  };
}

export function getNextEpisodeNumber(store: CastStore) {
  const highestPublished = store.publishedEpisodes.reduce(
    (highest, episode) => Math.max(highest, episode.episodeNumber),
    0,
  );
  const highestQueued = store.queuedReleases.reduce(
    (highest, release) => Math.max(highest, release.episodeNumber),
    0,
  );

  return Math.max(highestPublished, highestQueued) + 1;
}

export function buildPublishedDistribution(
  targetIds: string[],
  connectors: PlatformConnector[],
): EpisodeDistribution[] {
  const distribution: EpisodeDistribution[] = [];

  for (const targetId of targetIds) {
    const target = getDistributionTarget(targetId);
    const connector = getConnector(connectors, targetId);

    if (!target) {
      continue;
    }

    if (!connector || connector.readiness === "disabled") {
      distribution.push({
        targetId,
        state: "manual",
        note: "Connector staat uitgeschakeld voor dit kanaal.",
        externalUrl: null,
        externalId: null,
        syncedAt: null,
      });
      continue;
    }

    if (connector.readiness === "setup") {
      distribution.push({
        targetId,
        state: "manual",
        note: "Connector mist nog bestemming of accountconfiguratie.",
        externalUrl: null,
        externalId: null,
        syncedAt: null,
      });
      continue;
    }

    if (connector.mode === "rss") {
      distribution.push({
        targetId,
        state: "review",
        note: "Feed-first distributie staat klaar; validatie of refresh richting het platform loopt via de feed-handoff.",
        externalUrl: null,
        externalId: null,
        syncedAt: null,
      });
      continue;
    }

    if (connector.mode === "api") {
      distribution.push({
        targetId,
        state: "queued",
        note:
          target.lane === "clips" && target.id !== "clips"
            ? "Short-form exportjob staat klaar en wacht op verticale clipmasters."
            : "API-connector staat klaar om de push-job te draaien.",
        externalUrl: null,
        externalId: null,
        syncedAt: null,
      });
      continue;
    }

    distribution.push({
      targetId,
      state: "manual",
      note: "Handmatige connectorstap is vereist voor dit kanaal.",
      externalUrl: null,
      externalId: null,
      syncedAt: null,
    });
  }

  return distribution;
}

function createDistributionJobRecord(args: {
  episodeId: string;
  episodeTitle: string;
  targetId: string;
  lane: DistributionLane;
  kind: DistributionJobKind;
  status: DistributionJobStatus;
  createdAt: string;
  note: string;
}) {
  const historyEvent: DistributionJobHistoryEvent =
    args.status === "pending"
      ? "queued"
      : args.status === "processing"
        ? "started"
        : args.status === "completed"
          ? "completed"
          : "failed";

  return {
    id: `${args.episodeId}-${args.targetId}-${args.createdAt}`,
    episodeId: args.episodeId,
    episodeTitle: args.episodeTitle,
    targetId: args.targetId,
    lane: args.lane,
    kind: args.kind,
    status: args.status,
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
    note: args.note,
    attemptCount: 0,
    maxAttempts: defaultDistributionJobMaxAttempts,
    lastAttemptAt: null,
    lastErrorAt: args.status === "failed" ? args.createdAt : null,
    nextRetryAt: null,
    externalUrl: null,
    externalId: null,
    history: [
      createDistributionJobHistoryEntry({
        jobId: `${args.episodeId}-${args.targetId}-${args.createdAt}`,
        at: args.createdAt,
        event: historyEvent,
        note: args.note,
        fromStatus: null,
        toStatus: args.status,
        attemptCount: 0,
      }),
    ],
  } satisfies DistributionJob;
}

export function buildDistributionJobs(args: {
  episodeId: string;
  episodeTitle: string;
  targetIds: string[];
  createdAt: string;
  connectors: PlatformConnector[];
}): DistributionJob[] {
  const { episodeId, episodeTitle, targetIds, createdAt, connectors } = args;
  const jobs: DistributionJob[] = [];

  for (const targetId of targetIds) {
    const target = getDistributionTarget(targetId);
    const connector = getConnector(connectors, targetId);

    if (!target) {
      continue;
    }

    if (!connector || connector.readiness === "disabled") {
      jobs.push(
        createDistributionJobRecord({
          episodeId,
          episodeTitle,
          targetId,
          lane: target.lane,
          kind:
            target.id === "clips"
              ? "clip-render"
              : target.lane === "clips"
                ? "clip-export"
                : "platform-upload",
          status: "failed",
          createdAt,
          note: "Connector staat uitgeschakeld voor dit kanaal.",
        }),
      );
      continue;
    }

    if (connector.readiness === "setup") {
      jobs.push(
        createDistributionJobRecord({
          episodeId,
          episodeTitle,
          targetId,
          lane: target.lane,
          kind:
            target.id === "clips"
              ? "clip-render"
              : target.lane === "clips"
                ? "clip-export"
                : "platform-upload",
          status: "failed",
          createdAt,
          note: "Connector mist bestemming of accountconfiguratie.",
        }),
      );
      continue;
    }

    if (connector.mode === "rss") {
      jobs.push(
        createDistributionJobRecord({
          episodeId,
          episodeTitle,
          targetId,
          lane: target.lane,
          kind: "feed-ingest",
          status: "pending",
          createdAt,
          note: "Feed is bijgewerkt; run de connector om de feed-handoff te valideren.",
        }),
      );
      continue;
    }

    if (target.lane === "clips") {
      jobs.push(
        createDistributionJobRecord({
          episodeId,
          episodeTitle,
          targetId,
          lane: target.lane,
          kind: target.id === "clips" ? "clip-render" : "clip-export",
          status: "pending",
          createdAt,
          note:
            target.id === "clips"
              ? connector.mode === "api"
                ? "Clip-render kan via de renderworkflow starten."
                : "Clip-render wacht op een handmatige of semi-automatische stap."
              : connector.mode === "api"
                ? "Platform-export staat klaar en gebruikt de verticale clipmasters uit de renderpipeline."
                : "Clip-export wacht op een handmatige of semi-automatische stap.",
        }),
      );
      continue;
    }

    jobs.push(
      createDistributionJobRecord({
        episodeId,
        episodeTitle,
        targetId,
        lane: target.lane,
        kind: "platform-upload",
        status: "pending",
        createdAt,
        note:
          connector.mode === "api"
            ? "Platform-upload staat klaar om via connector te draaien."
            : "Handmatige platform-upload staat klaar.",
      }),
    );
  }

  return jobs;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function absoluteUrl(origin: string, path: string) {
  return new URL(path, origin).toString();
}

function toRssDate(dateString: string) {
  return new Date(dateString).toUTCString();
}

export function buildPodcastFeedXml(origin: string, store: CastStore) {
  const { show, publishedEpisodes } = normalizeCastStore(store);
  const siteUrl = absoluteUrl(origin, show.sitePath);
  const feedUrl = absoluteUrl(origin, show.feedPath);
  const artworkUrl = absoluteUrl(origin, show.artworkPath);
  const latestBuildDate = publishedEpisodes[0]?.publishedAt ?? new Date().toISOString();

  const items = publishedEpisodes
    .map((episode) => {
      const episodeUrl = `${siteUrl}#${episode.slug}`;
      const audioUrl = absoluteUrl(origin, episode.audioPath);
      const imageUrl = absoluteUrl(origin, episode.artworkPath);

      return [
        "    <item>",
        `      <title>${escapeXml(episode.title)}</title>`,
        `      <description>${escapeXml(episode.description)}</description>`,
        `      <link>${escapeXml(episodeUrl)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(episode.id)}</guid>`,
        `      <pubDate>${toRssDate(episode.publishedAt)}</pubDate>`,
        `      <enclosure url="${escapeXml(audioUrl)}" length="${episode.audioBytes}" type="${escapeXml(
          episode.audioMimeType,
        )}" />`,
        `      <itunes:author>${escapeXml(show.author)}</itunes:author>`,
        `      <itunes:summary>${escapeXml(episode.summary)}</itunes:summary>`,
        `      <itunes:duration>${episode.duration}</itunes:duration>`,
        `      <itunes:season>${episode.seasonNumber}</itunes:season>`,
        `      <itunes:episode>${episode.episodeNumber}</itunes:episode>`,
        "      <itunes:episodeType>full</itunes:episodeType>",
        `      <itunes:explicit>${episode.explicit ? "yes" : "no"}</itunes:explicit>`,
        `      <itunes:image href="${escapeXml(imageUrl)}" />`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0"',
    '  xmlns:atom="http://www.w3.org/2005/Atom"',
    '  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">',
    "  <channel>",
    `    <title>${escapeXml(show.title)}</title>`,
    `    <link>${escapeXml(siteUrl)}</link>`,
    `    <description>${escapeXml(show.description)}</description>`,
    `    <language>${show.language}</language>`,
    `    <lastBuildDate>${toRssDate(latestBuildDate)}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />`,
    "    <itunes:type>episodic</itunes:type>",
    `    <itunes:author>${escapeXml(show.author)}</itunes:author>`,
    `    <itunes:summary>${escapeXml(show.description)}</itunes:summary>`,
    `    <itunes:explicit>${show.explicit ? "yes" : "no"}</itunes:explicit>`,
    `    <itunes:image href="${escapeXml(artworkUrl)}" />`,
    `    <itunes:owner><itunes:name>${escapeXml(show.ownerName)}</itunes:name><itunes:email>${escapeXml(
      show.ownerEmail,
    )}</itunes:email></itunes:owner>`,
    `    <itunes:category text="${escapeXml(show.category)}" />`,
    items,
    "  </channel>",
    "</rss>",
  ].join("\n");
}
