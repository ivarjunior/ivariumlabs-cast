import "server-only";

import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import type {
  CastStore,
  ClipPlatform,
  DistributionJob,
  DistributionJobStatus,
  DistributionState,
  PlatformConnector,
  PodcastEpisode,
  RenderedClip,
  YouTubePrivacyStatus,
} from "@/lib/cast";
import { getConnector } from "@/lib/cast";
import { renderEpisodeClips } from "@/lib/clip-renderer";
import { persistDerivedAsset } from "@/lib/object-storage";

type ConnectorExecutionResult = {
  jobStatus: DistributionJobStatus;
  distributionState: DistributionState;
  note: string;
  externalUrl?: string | null;
  externalId?: string | null;
  renderedClips?: RenderedClip[];
};

type YouTubeRuntimeConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  privacyStatus: YouTubePrivacyStatus;
  categoryId: string;
};

type InstagramRuntimeConfig = {
  accessToken: string;
  igUserId: string;
  shareToFeed: boolean;
  apiVersion: string;
};

type TikTokRuntimeConfig = {
  accessToken: string;
  postMode: "direct" | "inbox";
  privacyLevel: string;
  disableDuet: boolean;
  disableComment: boolean;
  disableStitch: boolean;
};

const siteOriginEnv = ["PUBLIC_SITE_ORIGIN", "NEXT_PUBLIC_SITE_ORIGIN", "SITE_URL"] as const;
const youtubeEnv = {
  clientId: ["YOUTUBE_CLIENT_ID"],
  clientSecret: ["YOUTUBE_CLIENT_SECRET"],
  refreshToken: ["YOUTUBE_REFRESH_TOKEN"],
  privacyStatus: ["YOUTUBE_PRIVACY_STATUS"],
  categoryId: ["YOUTUBE_CATEGORY_ID"],
} as const;
const instagramEnv = {
  accessToken: ["INSTAGRAM_ACCESS_TOKEN"],
  igUserId: ["INSTAGRAM_IG_USER_ID"],
  apiVersion: ["INSTAGRAM_API_VERSION"],
} as const;
const tiktokEnv = {
  accessToken: ["TIKTOK_ACCESS_TOKEN"],
  postMode: ["TIKTOK_POST_MODE"],
  privacyLevel: ["TIKTOK_PRIVACY_LEVEL"],
  disableDuet: ["TIKTOK_DISABLE_DUET"],
  disableComment: ["TIKTOK_DISABLE_COMMENT"],
  disableStitch: ["TIKTOK_DISABLE_STITCH"],
} as const;

function readEnvValue(keys: readonly string[]) {
  for (const key of keys) {
    const value = process.env[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readEnvBoolean(keys: readonly string[], fallback: boolean) {
  const value = readEnvValue(keys);

  if (!value) {
    return fallback;
  }

  return value === "1" || value.toLowerCase() === "true";
}

function resolveAbsoluteUrl(origin: string, value: string) {
  return new URL(value, origin).toString();
}

function getFallbackSiteOrigin() {
  return readEnvValue(siteOriginEnv);
}

function readConnectorValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveYouTubePrivacyStatus(
  value: string | null | undefined,
): YouTubePrivacyStatus {
  if (value === "public" || value === "unlisted") {
    return value;
  }

  return "private";
}

function createFailedResult(
  note: string,
  renderedClips: RenderedClip[] = [],
): ConnectorExecutionResult {
  return {
    jobStatus: "failed",
    distributionState: "manual",
    note,
    externalUrl: null,
    externalId: null,
    renderedClips,
  };
}

function getYouTubeRuntimeConfig(args: {
  connector: PlatformConnector | undefined;
  fallbackConnector?: PlatformConnector | undefined;
}): YouTubeRuntimeConfig | null {
  const primaryConfig = args.connector?.youtubeConfig ?? null;
  const fallbackConfig = args.fallbackConnector?.youtubeConfig ?? null;
  const clientId =
    readConnectorValue(primaryConfig?.clientId) ??
    readConnectorValue(fallbackConfig?.clientId) ??
    readEnvValue(youtubeEnv.clientId);
  const clientSecret =
    readConnectorValue(primaryConfig?.clientSecret) ??
    readConnectorValue(fallbackConfig?.clientSecret) ??
    readEnvValue(youtubeEnv.clientSecret);
  const refreshToken =
    readConnectorValue(primaryConfig?.refreshToken) ??
    readConnectorValue(fallbackConfig?.refreshToken) ??
    readEnvValue(youtubeEnv.refreshToken);
  const privacyStatus = resolveYouTubePrivacyStatus(
    readConnectorValue(primaryConfig?.privacyStatus) ??
      readConnectorValue(fallbackConfig?.privacyStatus) ??
      readEnvValue(youtubeEnv.privacyStatus),
  );
  const categoryId =
    readConnectorValue(primaryConfig?.categoryId) ??
    readConnectorValue(fallbackConfig?.categoryId) ??
    readEnvValue(youtubeEnv.categoryId) ??
    "28";

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    refreshToken,
    privacyStatus,
    categoryId,
  };
}

function getInstagramRuntimeConfig(
  connector: PlatformConnector | undefined,
): InstagramRuntimeConfig | null {
  const config = connector?.instagramConfig ?? null;
  const accessToken =
    readConnectorValue(config?.accessToken) ?? readEnvValue(instagramEnv.accessToken);
  const igUserId =
    readConnectorValue(config?.igUserId) ?? readEnvValue(instagramEnv.igUserId);
  const apiVersion =
    readConnectorValue(config?.apiVersion) ??
    readEnvValue(instagramEnv.apiVersion) ??
    "v23.0";

  if (!accessToken || !igUserId) {
    return null;
  }

  return {
    accessToken,
    igUserId,
    shareToFeed: config?.shareToFeed ?? true,
    apiVersion,
  };
}

function getTikTokRuntimeConfig(
  connector: PlatformConnector | undefined,
): TikTokRuntimeConfig | null {
  const config = connector?.tiktokConfig ?? null;
  const accessToken =
    readConnectorValue(config?.accessToken) ?? readEnvValue(tiktokEnv.accessToken);

  if (!accessToken) {
    return null;
  }

  const envPostMode = readEnvValue(tiktokEnv.postMode);

  return {
    accessToken,
    postMode:
      config?.postMode === "inbox" || envPostMode === "inbox" ? "inbox" : "direct",
    privacyLevel:
      readConnectorValue(config?.privacyLevel) ??
      readEnvValue(tiktokEnv.privacyLevel) ??
      "SELF_ONLY",
    disableDuet:
      config?.disableDuet ?? readEnvBoolean(tiktokEnv.disableDuet, false),
    disableComment:
      config?.disableComment ?? readEnvBoolean(tiktokEnv.disableComment, false),
    disableStitch:
      config?.disableStitch ?? readEnvBoolean(tiktokEnv.disableStitch, false),
  };
}

async function getGoogleAccessToken(config: YouTubeRuntimeConfig) {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!tokenResponse.ok) {
    const message = await tokenResponse.text();

    throw new Error(`OAuth token refresh mislukt: ${message || tokenResponse.status}`);
  }

  const payload = (await tokenResponse.json()) as {
    access_token?: string;
  };

  if (!payload.access_token) {
    throw new Error("OAuth token refresh gaf geen access token terug.");
  }

  return payload.access_token;
}

async function verifyFeedReachable(feedUrl: string) {
  const response = await fetch(feedUrl, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Feed gaf status ${response.status} terug.`);
  }

  const feedXml = await response.text();

  if (!feedXml.includes("<rss")) {
    throw new Error("Feedrespons bevat geen geldige RSS-markup.");
  }
}

async function pingOvercast(feedUrl: string) {
  const pingUrl = new URL("https://overcast.fm/ping");
  pingUrl.searchParams.set("url", feedUrl);

  const response = await fetch(pingUrl, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Overcast ping gaf status ${response.status} terug.`);
  }
}

function resolveFeedExternalUrl(
  connector: PlatformConnector,
  feedUrl: string,
) {
  if (connector.destination && /^https?:\/\//.test(connector.destination)) {
    return connector.destination;
  }

  return feedUrl;
}

async function executeFeedConnector(args: {
  origin: string;
  store: CastStore;
  job: DistributionJob;
  connector: PlatformConnector;
}): Promise<ConnectorExecutionResult> {
  const feedUrl = resolveAbsoluteUrl(args.origin, args.store.show.feedPath);

  await verifyFeedReachable(feedUrl);

  if (args.job.targetId === "overcast") {
    await pingOvercast(feedUrl);
  }

  const noteByTarget: Record<string, string> = {
    spotify:
      "Feed-first distributie is gevalideerd; de episode staat nu beschikbaar voor RSS-ingest richting Spotify.",
    apple:
      "Feed-first distributie is gevalideerd; Apple Podcasts Connect kan deze feed nu uitlezen of verversen.",
    pocketcasts:
      "Feed-first distributie is gevalideerd; Pocket Casts gebruikt nu dezelfde publieke feed.",
    overcast:
      "Feed-first distributie is gevalideerd en de Overcast ping is verstuurd voor een snellere refresh.",
  };

  return {
    jobStatus: "completed",
    distributionState: "review",
    note:
      noteByTarget[args.job.targetId] ??
      "Feed-first distributie is gevalideerd voor dit kanaal.",
    externalUrl: resolveFeedExternalUrl(args.connector, feedUrl),
    externalId: args.job.targetId === "overcast" ? "overcast-ping" : "feed-first",
  };
}

async function uploadSourceToYouTube(args: {
  sourceUrl: string;
  title: string;
  description: string;
  runtimeConfig: YouTubeRuntimeConfig;
  playlistId?: string | null;
}) {
  const accessToken = await getGoogleAccessToken(args.runtimeConfig);
  const sourceResponse = await fetch(args.sourceUrl);

  if (!sourceResponse.ok || !sourceResponse.body) {
    throw new Error(
      `Videobron kon niet uit de media-opslag worden gelezen (status ${sourceResponse.status}).`,
    );
  }

  const contentType = sourceResponse.headers.get("content-type") || "video/mp4";
  const contentLength = Number.parseInt(
    sourceResponse.headers.get("content-length") ?? "0",
    10,
  );
  const resumableHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json; charset=UTF-8",
    "X-Upload-Content-Type": contentType,
  };

  if (contentLength > 0) {
    resumableHeaders["X-Upload-Content-Length"] = String(contentLength);
  }

  const createUploadResponse = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: resumableHeaders,
      body: JSON.stringify({
        snippet: {
          title: args.title,
          description: args.description,
          categoryId: args.runtimeConfig.categoryId,
        },
        status: {
          privacyStatus: args.runtimeConfig.privacyStatus,
          selfDeclaredMadeForKids: false,
        },
      }),
    },
  );

  const uploadSessionUrl = createUploadResponse.headers.get("location");

  if (!createUploadResponse.ok || !uploadSessionUrl) {
    const message = await createUploadResponse.text();

    throw new Error(
      `YouTube upload-sessie kon niet worden gestart: ${message || createUploadResponse.status}.`,
    );
  }

  const uploadHeaders: Record<string, string> = {
    "Content-Type": contentType,
  };

  if (contentLength > 0) {
    uploadHeaders["Content-Length"] = String(contentLength);
  }

  const uploadResponse = await fetch(uploadSessionUrl, {
    method: "PUT",
    headers: uploadHeaders,
    body: Readable.fromWeb(
      sourceResponse.body as unknown as NodeWebReadableStream<Uint8Array>,
    ) as unknown as BodyInit,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  const uploadPayload = (await uploadResponse.json().catch(() => null)) as
    | {
        id?: string;
      }
    | null;

  if (!uploadResponse.ok || !uploadPayload?.id) {
    throw new Error(`YouTube upload mislukte met status ${uploadResponse.status}.`);
  }

  if (args.playlistId) {
    await fetch("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        snippet: {
          playlistId: args.playlistId,
          resourceId: {
            kind: "youtube#video",
            videoId: uploadPayload.id,
          },
        },
      }),
    });
  }

  return {
    externalId: uploadPayload.id,
    externalUrl: `https://www.youtube.com/watch?v=${uploadPayload.id}`,
  };
}

function getTenantSlugFromStore(store: CastStore) {
  return store.show.sitePath.split("/").filter(Boolean).pop() || "workspace";
}

function upsertClipExport(args: {
  clips: RenderedClip[];
  platform: ClipPlatform;
  results: Array<{
    clipId: string;
    state: "completed" | "failed";
    note: string;
    externalUrl?: string | null;
    externalId?: string | null;
  }>;
}) {
  const resultMap = new Map(args.results.map((item) => [item.clipId, item]));
  const exportedAt = new Date().toISOString();

  return args.clips.map((clip) => {
    if (!clip.platforms.includes(args.platform)) {
      return clip;
    }

    const result = resultMap.get(clip.id);

    if (!result) {
      return clip;
    }

    const nextExports = clip.exports.some((item) => item.platform === args.platform)
      ? clip.exports.map((item) =>
          item.platform === args.platform
            ? {
                ...item,
                state: result.state,
                note: result.note,
                externalUrl: result.externalUrl ?? null,
                externalId: result.externalId ?? null,
                exportedAt,
              }
            : item,
        )
      : [
          ...clip.exports,
          {
            platform: args.platform,
            state: result.state,
            note: result.note,
            externalUrl: result.externalUrl ?? null,
            externalId: result.externalId ?? null,
            exportedAt,
          },
        ];

    return {
      ...clip,
      exports: nextExports,
    };
  });
}

async function persistClipExportManifest(args: {
  tenantSlug: string;
  episode: PodcastEpisode;
  platform: ClipPlatform;
  payload: unknown;
}) {
  return persistDerivedAsset({
    tenantSlug: args.tenantSlug,
    slug: args.episode.slug,
    folder: "clip-exports",
    fileName: `${args.episode.slug}-${args.platform}.json`,
    body: JSON.stringify(args.payload, null, 2),
    contentType: "application/json; charset=utf-8",
    cacheControl: "public, max-age=300",
  });
}

async function ensureRenderedClips(args: {
  store: CastStore;
  episode: PodcastEpisode;
  origin: string;
}) {
  if (args.episode.renderedClips.length > 0) {
    return args.episode.renderedClips;
  }

  const renderConnector = getConnector(args.store.connectors, "clips");
  const { clips } = await renderEpisodeClips({
    tenantSlug: getTenantSlugFromStore(args.store),
    episode: args.episode,
    origin: args.origin,
    brandLabel:
      renderConnector?.clipRenderConfig?.brandLabel ??
      args.store.show.title,
    defaultTemplateId: renderConnector?.clipRenderConfig?.defaultTemplateId ?? "clean",
  });

  return clips;
}

async function ensureRenderedClipsForPlatform(args: {
  store: CastStore;
  episode: PodcastEpisode;
  origin: string;
  platform: ClipPlatform;
}) {
  const clips = await ensureRenderedClips(args);
  const platformClips = clips.filter((clip) => clip.platforms.includes(args.platform));

  if (platformClips.length === 0) {
    throw new Error(
      `Er zijn geen gerenderde clips beschikbaar voor ${args.platform}.`,
    );
  }

  return {
    allClips: clips,
    platformClips,
  };
}

async function uploadEpisodeToYouTube(args: {
  origin: string;
  episode: PodcastEpisode;
  connector: PlatformConnector;
  fallbackConnector?: PlatformConnector | undefined;
}): Promise<ConnectorExecutionResult> {
  const { episode, connector } = args;

  if (!episode.videoPath) {
    return createFailedResult(
      "YouTube-upload kan niet starten omdat deze episode geen videomaster in de store heeft.",
    );
  }

  const runtimeConfig = getYouTubeRuntimeConfig({
    connector,
    fallbackConnector: args.fallbackConnector,
  });

  if (!runtimeConfig) {
    return createFailedResult(
      "YouTube API-config ontbreekt. Voeg tenant-credentials toe in de connector of zet de globale YouTube env-variabelen.",
    );
  }

  const upload = await uploadSourceToYouTube({
    sourceUrl: resolveAbsoluteUrl(args.origin, episode.videoPath),
    title: episode.title,
    description: episode.description,
    runtimeConfig,
    playlistId: connector.destination || null,
  });

  return {
    jobStatus: "completed",
    distributionState: "live",
    note:
      connector.destination
        ? "Video is naar YouTube gepusht en aan de ingestelde playlist gekoppeld."
        : "Video is via de connector naar YouTube gepusht.",
    externalUrl: upload.externalUrl,
    externalId: upload.externalId,
  };
}

async function exportShorts(args: {
  origin: string;
  episode: PodcastEpisode;
  store: CastStore;
  connector: PlatformConnector;
}) {
  const runtimeConfig = getYouTubeRuntimeConfig({
    connector: args.connector,
    fallbackConnector: getConnector(args.store.connectors, "youtube"),
  });

  if (!runtimeConfig) {
    return createFailedResult(
      "YouTube Shorts mist connector-credentials. Sla tenant YouTube-config op in Shorts of laat Shorts op de YouTube connector meeliften.",
    );
  }

  const { allClips, platformClips } = await ensureRenderedClipsForPlatform({
    store: args.store,
    episode: args.episode,
    origin: args.origin,
    platform: "shorts",
  });
  const results: Array<{
    clipId: string;
    state: "completed" | "failed";
    note: string;
    externalUrl?: string | null;
    externalId?: string | null;
  }> = [];

  for (const clip of platformClips) {
    const upload = await uploadSourceToYouTube({
      sourceUrl: resolveAbsoluteUrl(args.origin, clip.assetPath),
      title: `${args.episode.title} · ${clip.title} #Shorts`,
      description: clip.caption || args.episode.summary,
      runtimeConfig,
      playlistId: args.connector.destination || null,
    });

    results.push({
      clipId: clip.id,
      state: "completed",
      note: "Short is naar YouTube gepusht.",
      externalUrl: upload.externalUrl,
      externalId: upload.externalId,
    });
  }

  const renderedClips = upsertClipExport({
    clips: allClips,
    platform: "shorts",
    results,
  });
  const manifest = await persistClipExportManifest({
    tenantSlug: getTenantSlugFromStore(args.store),
    episode: args.episode,
    platform: "shorts",
    payload: {
      episodeId: args.episode.id,
      platform: "shorts",
      exportedAt: new Date().toISOString(),
      results,
    },
  });

  return {
    jobStatus: "completed",
    distributionState: "live",
    note: `${results.length} Shorts exports zijn via het gekoppelde YouTube-account verstuurd.`,
    externalUrl: manifest.publicPath,
    externalId: `${results.length}-shorts`,
    renderedClips,
  } satisfies ConnectorExecutionResult;
}

async function waitForInstagramContainerReady(args: {
  apiVersion: string;
  accessToken: string;
  creationId: string;
}) {
  const attempts = 6;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(
      `https://graph.facebook.com/${args.apiVersion}/${args.creationId}?fields=status_code,status&access_token=${encodeURIComponent(args.accessToken)}`,
      {
        cache: "no-store",
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | {
          status_code?: string;
          status?: string;
        }
      | null;
    const statusCode = payload?.status_code ?? payload?.status ?? "";

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(
        `Instagram container status kon niet worden gelezen: ${message || response.status}.`,
      );
    }

    if (statusCode === "FINISHED" || statusCode === "PUBLISHED") {
      return;
    }

    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      throw new Error(`Instagram container bleef hangen in status ${statusCode}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
}

async function exportReels(args: {
  origin: string;
  episode: PodcastEpisode;
  store: CastStore;
  connector: PlatformConnector;
}) {
  const runtimeConfig = getInstagramRuntimeConfig(args.connector);

  if (!runtimeConfig) {
    return createFailedResult(
      "Instagram Reels mist connector-credentials. Voeg tenant access token en Instagram user id toe.",
    );
  }

  const { allClips, platformClips } = await ensureRenderedClipsForPlatform({
    store: args.store,
    episode: args.episode,
    origin: args.origin,
    platform: "reels",
  });
  const results: Array<{
    clipId: string;
    state: "completed" | "failed";
    note: string;
    externalUrl?: string | null;
    externalId?: string | null;
  }> = [];

  for (const clip of platformClips) {
    const createResponse = await fetch(
      `https://graph.facebook.com/${runtimeConfig.apiVersion}/${runtimeConfig.igUserId}/media`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          media_type: "REELS",
          video_url: resolveAbsoluteUrl(args.origin, clip.assetPath),
          caption: clip.caption || args.episode.summary,
          share_to_feed: runtimeConfig.shareToFeed ? "true" : "false",
          access_token: runtimeConfig.accessToken,
        }),
      },
    );
    const createPayload = (await createResponse.json().catch(() => null)) as
      | {
          id?: string;
          error?: { message?: string };
        }
      | null;

    if (!createResponse.ok || !createPayload?.id) {
      throw new Error(
        createPayload?.error?.message ||
          `Instagram Reels container kon niet worden aangemaakt (status ${createResponse.status}).`,
      );
    }

    await waitForInstagramContainerReady({
      apiVersion: runtimeConfig.apiVersion,
      accessToken: runtimeConfig.accessToken,
      creationId: createPayload.id,
    });

    const publishResponse = await fetch(
      `https://graph.facebook.com/${runtimeConfig.apiVersion}/${runtimeConfig.igUserId}/media_publish`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          creation_id: createPayload.id,
          access_token: runtimeConfig.accessToken,
        }),
      },
    );
    const publishPayload = (await publishResponse.json().catch(() => null)) as
      | {
          id?: string;
          error?: { message?: string };
        }
      | null;

    if (!publishResponse.ok || !publishPayload?.id) {
      throw new Error(
        publishPayload?.error?.message ||
          `Instagram Reels publish mislukte (status ${publishResponse.status}).`,
      );
    }

    results.push({
      clipId: clip.id,
      state: "completed",
      note: "Reel is naar Instagram gepusht.",
      externalId: publishPayload.id,
      externalUrl: args.connector.destination || null,
    });
  }

  const renderedClips = upsertClipExport({
    clips: allClips,
    platform: "reels",
    results,
  });
  const manifest = await persistClipExportManifest({
    tenantSlug: getTenantSlugFromStore(args.store),
    episode: args.episode,
    platform: "reels",
    payload: {
      episodeId: args.episode.id,
      platform: "reels",
      exportedAt: new Date().toISOString(),
      results,
    },
  });

  return {
    jobStatus: "completed",
    distributionState: "live",
    note: `${results.length} Reels exports zijn via het gekoppelde Instagram-account verstuurd.`,
    externalUrl: manifest.publicPath,
    externalId: `${results.length}-reels`,
    renderedClips,
  } satisfies ConnectorExecutionResult;
}

async function exportTikTok(args: {
  origin: string;
  episode: PodcastEpisode;
  store: CastStore;
  connector: PlatformConnector;
}) {
  const runtimeConfig = getTikTokRuntimeConfig(args.connector);

  if (!runtimeConfig) {
    return createFailedResult(
      "TikTok export mist connector-credentials. Voeg tenant access token en posting-configuratie toe.",
    );
  }

  const { allClips, platformClips } = await ensureRenderedClipsForPlatform({
    store: args.store,
    episode: args.episode,
    origin: args.origin,
    platform: "tiktok",
  });
  const endpoint =
    runtimeConfig.postMode === "inbox"
      ? "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
      : "https://open.tiktokapis.com/v2/post/publish/video/init/";
  const results: Array<{
    clipId: string;
    state: "completed" | "failed";
    note: string;
    externalUrl?: string | null;
    externalId?: string | null;
  }> = [];

  for (const clip of platformClips) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtimeConfig.accessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        post_info: {
          title: clip.caption || `${args.episode.title} · ${clip.title}`,
          privacy_level: runtimeConfig.privacyLevel,
          disable_duet: runtimeConfig.disableDuet,
          disable_comment: runtimeConfig.disableComment,
          disable_stitch: runtimeConfig.disableStitch,
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: resolveAbsoluteUrl(args.origin, clip.assetPath),
        },
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | {
          data?: {
            publish_id?: string;
            share_id?: string;
          };
          error?: {
            message?: string;
            code?: string;
          };
        }
      | null;
    const publishId = payload?.data?.publish_id ?? payload?.data?.share_id ?? null;

    if (!response.ok || !publishId) {
      throw new Error(
        payload?.error?.message ||
          `TikTok export mislukte tijdens publish init (status ${response.status}).`,
      );
    }

    results.push({
      clipId: clip.id,
      state: "completed",
      note:
        runtimeConfig.postMode === "inbox"
          ? "TikTok export staat in de creator inbox klaar voor afronding."
          : "TikTok export is aan de directe posting flow doorgegeven.",
      externalId: publishId,
      externalUrl: args.connector.destination || null,
    });
  }

  const renderedClips = upsertClipExport({
    clips: allClips,
    platform: "tiktok",
    results,
  });
  const manifest = await persistClipExportManifest({
    tenantSlug: getTenantSlugFromStore(args.store),
    episode: args.episode,
    platform: "tiktok",
    payload: {
      episodeId: args.episode.id,
      platform: "tiktok",
      exportedAt: new Date().toISOString(),
      results,
    },
  });

  return {
    jobStatus: "completed",
    distributionState: "live",
    note:
      runtimeConfig.postMode === "inbox"
        ? `${results.length} TikTok exports staan klaar in de creator inbox.`
        : `${results.length} TikTok exports zijn aan de directe posting flow doorgegeven.`,
    externalUrl: manifest.publicPath,
    externalId: `${results.length}-tiktok`,
    renderedClips,
  } satisfies ConnectorExecutionResult;
}

async function renderClips(args: {
  origin: string;
  episode: PodcastEpisode;
  store: CastStore;
}): Promise<ConnectorExecutionResult> {
  const renderConnector = getConnector(args.store.connectors, "clips");
  const { clips, manifestUrl } = await renderEpisodeClips({
    tenantSlug: getTenantSlugFromStore(args.store),
    episode: args.episode,
    origin: args.origin,
    brandLabel:
      renderConnector?.clipRenderConfig?.brandLabel ??
      args.store.show.title,
    defaultTemplateId: renderConnector?.clipRenderConfig?.defaultTemplateId ?? "clean",
  });

  return {
    jobStatus: "completed",
    distributionState: "live",
    note: `${clips.length} verticale clips zijn gerenderd met subtitle- en brandingtemplates.`,
    externalUrl: manifestUrl,
    externalId: `${clips.length}-clips`,
    renderedClips: clips,
  };
}

export async function executeDistributionConnector(args: {
  origin: string | null;
  store: CastStore;
  job: DistributionJob;
  episode: PodcastEpisode;
  connector: PlatformConnector | undefined;
}): Promise<ConnectorExecutionResult> {
  const { store, job, episode, connector } = args;
  const origin = args.origin ?? getFallbackSiteOrigin();

  if (!connector || connector.readiness === "disabled") {
    return createFailedResult("Connector staat uitgeschakeld voor dit kanaal.");
  }

  if (connector.readiness === "setup") {
    return createFailedResult("Connector mist nog bestemming of accountconfiguratie.");
  }

  if (!origin) {
    return createFailedResult(
      "De publieke site-origin ontbreekt. Zet PUBLIC_SITE_ORIGIN of draai de connector vanuit een geldige request-context.",
    );
  }

  if (connector.mode === "rss") {
    return executeFeedConnector({
      origin,
      store,
      job,
      connector,
    }).catch((error) =>
      createFailedResult(
        error instanceof Error
          ? error.message
          : "Feed-handoff is onverwacht afgebroken.",
      ),
    );
  }

  if (job.targetId === "youtube" && connector.mode === "api") {
    return uploadEpisodeToYouTube({
      origin,
      episode,
      connector,
    }).catch((error) =>
      createFailedResult(
        error instanceof Error
          ? error.message
          : "YouTube connector is onverwacht afgebroken.",
      ),
    );
  }

  if (job.targetId === "shorts" && connector.mode === "api") {
    return exportShorts({
      origin,
      episode,
      store,
      connector,
    }).catch((error) =>
      createFailedResult(
        error instanceof Error
          ? error.message
          : "Shorts connector is onverwacht afgebroken.",
      ),
    );
  }

  if (job.targetId === "reels" && connector.mode === "api") {
    return exportReels({
      origin,
      episode,
      store,
      connector,
    }).catch((error) =>
      createFailedResult(
        error instanceof Error
          ? error.message
          : "Reels connector is onverwacht afgebroken.",
      ),
    );
  }

  if (job.targetId === "tiktok" && connector.mode === "api") {
    return exportTikTok({
      origin,
      episode,
      store,
      connector,
    }).catch((error) =>
      createFailedResult(
        error instanceof Error
          ? error.message
          : "TikTok connector is onverwacht afgebroken.",
      ),
    );
  }

  if (job.targetId === "clips") {
    return renderClips({
      origin,
      episode,
      store,
    }).catch((error) =>
      createFailedResult(
        error instanceof Error
          ? error.message
          : "Cliprenderer is onverwacht afgebroken.",
      ),
    );
  }

  return createFailedResult(
    "Deze connector kan nog niet automatisch pushen met de huidige configuratie.",
  );
}
