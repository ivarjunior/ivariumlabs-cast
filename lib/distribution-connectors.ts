import "server-only";

import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import type {
  CastStore,
  DistributionJob,
  DistributionJobStatus,
  DistributionState,
  PlatformConnector,
  PodcastEpisode,
  YouTubePrivacyStatus,
} from "@/lib/cast";

type ConnectorExecutionResult = {
  jobStatus: DistributionJobStatus;
  distributionState: DistributionState;
  note: string;
  externalUrl?: string | null;
  externalId?: string | null;
};

type YouTubeRuntimeConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  privacyStatus: YouTubePrivacyStatus;
  categoryId: string;
};

const siteOriginEnv = ["PUBLIC_SITE_ORIGIN", "NEXT_PUBLIC_SITE_ORIGIN", "SITE_URL"] as const;
const youtubeEnv = {
  clientId: ["YOUTUBE_CLIENT_ID"],
  clientSecret: ["YOUTUBE_CLIENT_SECRET"],
  refreshToken: ["YOUTUBE_REFRESH_TOKEN"],
  privacyStatus: ["YOUTUBE_PRIVACY_STATUS"],
  categoryId: ["YOUTUBE_CATEGORY_ID"],
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

function resolveAbsoluteUrl(origin: string, value: string) {
  return new URL(value, origin).toString();
}

function getFallbackSiteOrigin() {
  return readEnvValue(siteOriginEnv);
}

function resolveYouTubePrivacyStatus(
  value: string | null | undefined,
): YouTubePrivacyStatus {
  if (value === "public" || value === "unlisted") {
    return value;
  }

  return "private";
}

function createFailedResult(note: string): ConnectorExecutionResult {
  return {
    jobStatus: "failed",
    distributionState: "manual",
    note,
    externalUrl: null,
    externalId: null,
  };
}

function readConnectorValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getYouTubeRuntimeConfig(
  connector: PlatformConnector | undefined,
): YouTubeRuntimeConfig | null {
  const connectorConfig =
    connector?.targetId === "youtube" ? connector.youtubeConfig : null;
  const clientId =
    readConnectorValue(connectorConfig?.clientId) ??
    readEnvValue(youtubeEnv.clientId);
  const clientSecret =
    readConnectorValue(connectorConfig?.clientSecret) ??
    readEnvValue(youtubeEnv.clientSecret);
  const refreshToken =
    readConnectorValue(connectorConfig?.refreshToken) ??
    readEnvValue(youtubeEnv.refreshToken);
  const privacyStatus = resolveYouTubePrivacyStatus(
    readConnectorValue(connectorConfig?.privacyStatus) ??
      readEnvValue(youtubeEnv.privacyStatus),
  );
  const categoryId =
    readConnectorValue(connectorConfig?.categoryId) ??
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

async function executeFeedConnector(args: {
  origin: string;
  store: CastStore;
  job: DistributionJob;
}): Promise<ConnectorExecutionResult> {
  const feedUrl = resolveAbsoluteUrl(args.origin, args.store.show.feedPath);

  await verifyFeedReachable(feedUrl);

  const noteByTarget: Record<string, string> = {
    spotify:
      "Feed is bereikbaar en gepubliceerd; de audio-release staat nu in de feed-handoff richting Spotify.",
    apple:
      "Feed is bereikbaar en gepubliceerd; Apple kan deze feed nu uitlezen of verversen.",
    pocketcasts:
      "Feed is bereikbaar en gepubliceerd; directory-ingest gebruikt nu dezelfde feed.",
    overcast:
      "Feed is bereikbaar en gepubliceerd; Overcast kan dezelfde feed nu uitlezen.",
  };

  return {
    jobStatus: "completed",
    distributionState: "review",
    note: noteByTarget[args.job.targetId] ?? "Feed is bereikbaar en gepubliceerd.",
    externalUrl: feedUrl,
    externalId: null,
  };
}

async function uploadToYouTube(args: {
  origin: string;
  episode: PodcastEpisode;
  connector: PlatformConnector;
}): Promise<ConnectorExecutionResult> {
  const { episode, connector, origin } = args;

  if (!episode.videoPath) {
    return createFailedResult(
      "YouTube-upload kan niet starten omdat deze episode geen videomaster in de store heeft.",
    );
  }

  const runtimeConfig = getYouTubeRuntimeConfig(connector);

  if (!runtimeConfig) {
    return createFailedResult(
      "YouTube API-config ontbreekt. Voeg tenant-credentials toe in de connector of zet de globale YouTube env-variabelen.",
    );
  }

  const accessToken = await getGoogleAccessToken(runtimeConfig);
  const sourceVideoUrl = resolveAbsoluteUrl(origin, episode.videoPath);
  const sourceVideoResponse = await fetch(sourceVideoUrl);

  if (!sourceVideoResponse.ok || !sourceVideoResponse.body) {
    return createFailedResult(
      `Videomaster kon niet uit de media-opslag worden gelezen (status ${sourceVideoResponse.status}).`,
    );
  }

  const contentType =
    episode.videoMimeType ||
    sourceVideoResponse.headers.get("content-type") ||
    "video/mp4";
  const contentLength =
    episode.videoBytes && episode.videoBytes > 0
      ? episode.videoBytes
      : Number.parseInt(sourceVideoResponse.headers.get("content-length") ?? "0", 10);
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
          title: episode.title,
          description: episode.description,
          categoryId: runtimeConfig.categoryId,
        },
        status: {
          privacyStatus: runtimeConfig.privacyStatus,
          selfDeclaredMadeForKids: false,
        },
      }),
    },
  );

  const uploadSessionUrl = createUploadResponse.headers.get("location");

  if (!createUploadResponse.ok || !uploadSessionUrl) {
    const message = await createUploadResponse.text();

    return createFailedResult(
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
      sourceVideoResponse.body as unknown as NodeWebReadableStream<Uint8Array>,
    ) as unknown as BodyInit,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  const uploadPayload = (await uploadResponse.json().catch(() => null)) as
    | {
        id?: string;
      }
    | null;

  if (!uploadResponse.ok || !uploadPayload?.id) {
    return createFailedResult(
      `YouTube upload mislukte met status ${uploadResponse.status}.`,
    );
  }

  const videoUrl = `https://www.youtube.com/watch?v=${uploadPayload.id}`;
  let note = "Video is via de connector naar YouTube gepusht.";

  if (connector.destination) {
    const playlistResponse = await fetch(
      "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          snippet: {
            playlistId: connector.destination,
            resourceId: {
              kind: "youtube#video",
              videoId: uploadPayload.id,
            },
          },
        }),
      },
    );

    if (playlistResponse.ok) {
      note = "Video is naar YouTube gepusht en aan de ingestelde playlist gekoppeld.";
    } else {
      note =
        "Video is naar YouTube gepusht, maar de playlist-koppeling vanuit Destination kon niet worden afgerond.";
    }
  }

  return {
    jobStatus: "completed",
    distributionState: "live",
    note,
    externalUrl: videoUrl,
    externalId: uploadPayload.id,
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

  if (job.targetId === "youtube" && connector.mode === "api") {
    return uploadToYouTube({
      origin,
      episode,
      connector,
    });
  }

  if (connector.mode === "rss") {
    return executeFeedConnector({
      origin,
      store,
      job,
    });
  }

  if (job.targetId === "clips") {
    return createFailedResult(
      "Clips hebben nog geen renderconnector; deze job vraagt nog een aparte exportworkflow.",
    );
  }

  return createFailedResult(
    "Deze connector kan nog niet automatisch pushen met de huidige configuratie.",
  );
}
