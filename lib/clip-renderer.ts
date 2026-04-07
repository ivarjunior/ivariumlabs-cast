import "server-only";

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import type {
  ClipPlan,
  ClipRenderTemplateId,
  PodcastEpisode,
  RenderedClip,
  RenderedClipExport,
} from "@/lib/cast";
import { persistDerivedAsset } from "@/lib/object-storage";

const execFileAsync = promisify(execFile);
const maxClipDurationSeconds = 90;
const maxClipCount = 3;
const defaultFontCandidates = [
  process.env.FFMPEG_FONT_FILE?.trim() || "",
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
].filter(Boolean);

export class ClipRenderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClipRenderConfigurationError";
  }
}

function getRendererBinaryPath() {
  const configuredPath = process.env.FFMPEG_PATH?.trim();

  if (configuredPath) {
    return configuredPath;
  }

  if (typeof ffmpegPath === "string" && ffmpegPath.trim()) {
    return ffmpegPath;
  }

  return null;
}

function buildClipFileName(episode: PodcastEpisode, plan: ClipPlan) {
  return `${episode.slug}-${plan.id}.mp4`;
}

async function resolveFontPath() {
  for (const candidate of defaultFontCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function escapeDrawTextValue(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'")
    .replaceAll("%", "\\%")
    .replaceAll(",", "\\,")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll(";", "\\;")
    .replaceAll("\n", "\\n");
}

function wrapOverlayText(value: string, maxCharsPerLine: number, maxLines: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return "";
  }

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (candidate.length <= maxCharsPerLine) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    currentLine = word;

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  return lines.slice(0, maxLines).join("\n");
}

function buildDrawtextFilter(args: {
  text: string;
  x: string;
  y: string;
  fontSize: number;
  fontColor?: string;
  lineSpacing?: number;
  borderWidth?: number;
  borderColor?: string;
  boxColor?: string;
  boxBorderWidth?: number;
  fontPath: string | null;
}) {
  const parts = ["drawtext"];

  if (args.fontPath) {
    parts.push(`fontfile='${escapeDrawTextValue(args.fontPath)}'`);
  }

  parts.push(`text='${escapeDrawTextValue(args.text)}'`);
  parts.push(`x=${args.x}`);
  parts.push(`y=${args.y}`);
  parts.push(`fontsize=${args.fontSize}`);
  parts.push(`fontcolor=${args.fontColor ?? "white"}`);
  parts.push(`line_spacing=${args.lineSpacing ?? 10}`);
  parts.push(`borderw=${args.borderWidth ?? 0}`);
  parts.push(`bordercolor=${args.borderColor ?? "black@0.35"}`);

  if (args.boxColor) {
    parts.push("box=1");
    parts.push(`boxcolor=${args.boxColor}`);
    parts.push(`boxborderw=${args.boxBorderWidth ?? 18}`);
  }

  return parts.join(":");
}

function buildTemplateFilters(args: {
  plan: ClipPlan;
  brandLabel: string;
  templateId: ClipRenderTemplateId;
  fontPath: string | null;
}) {
  const { plan, brandLabel, templateId, fontPath } = args;
  const headline = wrapOverlayText(plan.hook || plan.title, 18, 3);
  const subtitle = wrapOverlayText(plan.caption || plan.title, 28, 3);
  const filters = [
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920",
    "format=yuv420p",
  ];

  if (templateId === "bold") {
    filters.push("drawbox=x=0:y=0:w=1080:h=320:color=0x07111f@0.82:t=fill");
    filters.push("drawbox=x=0:y=1530:w=1080:h=320:color=0x07111f@0.78:t=fill");
  } else if (templateId === "ticker") {
    filters.push("drawbox=x=0:y=0:w=1080:h=124:color=0x111827@0.86:t=fill");
    filters.push("drawbox=x=0:y=1680:w=1080:h=180:color=0x0f172a@0.82:t=fill");
  } else {
    filters.push("drawbox=x=40:y=56:w=380:h=92:color=0x0f172a@0.72:t=fill");
    filters.push("drawbox=x=40:y=1490:w=1000:h=270:color=0x020617@0.68:t=fill");
  }

  filters.push(
    buildDrawtextFilter({
      text: brandLabel,
      x: templateId === "ticker" ? "56" : "64",
      y: templateId === "ticker" ? "34" : "84",
      fontSize: templateId === "ticker" ? 34 : 32,
      fontColor: "white",
      boxColor: templateId === "clean" ? "0x22c55e@0.25" : undefined,
      boxBorderWidth: 12,
      borderWidth: 1,
      fontPath,
    }),
  );

  if (headline) {
    filters.push(
      buildDrawtextFilter({
        text: headline,
        x: "64",
        y:
          templateId === "bold"
            ? "120"
            : templateId === "ticker"
              ? "640"
              : "220",
        fontSize:
          templateId === "bold" ? 74 : templateId === "ticker" ? 68 : 62,
        fontColor: "white",
        borderWidth: 2,
        borderColor: "black@0.45",
        lineSpacing: 12,
        fontPath,
      }),
    );
  }

  if (subtitle) {
    filters.push(
      buildDrawtextFilter({
        text: subtitle,
        x: "64",
        y:
          templateId === "bold"
            ? "1600"
            : templateId === "ticker"
              ? "1718"
              : "1540",
        fontSize:
          templateId === "bold" ? 44 : templateId === "ticker" ? 40 : 42,
        fontColor: "white",
        borderWidth: 1,
        borderColor: "black@0.4",
        lineSpacing: 10,
        fontPath,
      }),
    );
  }

  return filters.join(",");
}

async function downloadEpisodeVideoToFile(args: {
  videoUrl: string;
  outputPath: string;
}) {
  const response = await fetch(args.videoUrl, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Videomaster kon niet worden gedownload voor cliprender (status ${response.status}).`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(args.outputPath, Buffer.from(arrayBuffer));
}

async function renderSingleClip(args: {
  inputPath: string;
  outputPath: string;
  plan: ClipPlan;
  templateId: ClipRenderTemplateId;
  brandLabel: string;
  fontPath: string | null;
}) {
  const rendererBinaryPath = getRendererBinaryPath();

  if (!rendererBinaryPath) {
    throw new ClipRenderConfigurationError(
      "FFmpeg ontbreekt. Voeg ffmpeg-static toe of zet FFMPEG_PATH in de runtime.",
    );
  }

  const videoFilters = buildTemplateFilters({
    plan: args.plan,
    brandLabel: args.brandLabel,
    templateId: args.templateId,
    fontPath: args.fontPath,
  });

  await execFileAsync(rendererBinaryPath, [
    "-y",
    "-ss",
    String(args.plan.startSeconds),
    "-to",
    String(args.plan.endSeconds),
    "-i",
    args.inputPath,
    "-vf",
    videoFilters,
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    args.outputPath,
  ]);
}

function validateClipPlans(plans: ClipPlan[]) {
  if (plans.length === 0) {
    throw new Error("Er staan geen clipsegmenten klaar voor deze episode.");
  }

  if (plans.length > maxClipCount) {
    throw new Error(`Render maximaal ${maxClipCount} clips per episode in één run.`);
  }

  for (const plan of plans) {
    const durationSeconds = plan.endSeconds - plan.startSeconds;

    if (durationSeconds <= 0) {
      throw new Error(`Clip "${plan.title}" heeft geen geldige duur.`);
    }

    if (durationSeconds > maxClipDurationSeconds) {
      throw new Error(
        `Clip "${plan.title}" is te lang. Houd clips onder ${maxClipDurationSeconds} seconden.`,
      );
    }
  }
}

function buildInitialClipExports(platforms: ClipPlan["platforms"]): RenderedClipExport[] {
  return platforms.map((platform) => ({
    platform,
    state: "queued",
    note: "Render klaar; platform-export wacht nog op een connector-run.",
    externalUrl: null,
    externalId: null,
    exportedAt: null,
  }));
}

export async function renderEpisodeClips(args: {
  tenantSlug: string;
  episode: PodcastEpisode;
  origin: string;
  brandLabel?: string | null;
  defaultTemplateId?: ClipRenderTemplateId;
}) {
  const { episode, tenantSlug, origin } = args;
  const plans = episode.clipPlans;

  if (!episode.videoPath) {
    throw new Error("Cliprender kan niet starten zonder videomaster.");
  }

  validateClipPlans(plans);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ivariumlabs-cast-clips-"));
  const inputPath = path.join(tempDir, `${episode.slug}-source.mp4`);
  const videoUrl = new URL(episode.videoPath, origin).toString();
  const fontPath = await resolveFontPath();
  const defaultTemplateId = args.defaultTemplateId ?? "clean";
  const brandLabel = args.brandLabel?.trim() || episode.title;

  try {
    await downloadEpisodeVideoToFile({
      videoUrl,
      outputPath: inputPath,
    });

    const renderedClips: RenderedClip[] = [];

    for (const plan of plans) {
      const outputPath = path.join(tempDir, `${plan.id}.mp4`);
      const templateId = plan.templateId ?? defaultTemplateId;

      await renderSingleClip({
        inputPath,
        outputPath,
        plan,
        templateId,
        brandLabel,
        fontPath,
      });

      const outputBuffer = await fs.readFile(outputPath);
      const storedUpload = await persistDerivedAsset({
        tenantSlug,
        slug: episode.slug,
        folder: "clips",
        fileName: buildClipFileName(episode, plan),
        body: outputBuffer,
        contentType: "video/mp4",
      });

      renderedClips.push({
        id: `${episode.id}-${plan.id}`,
        sourcePlanId: plan.id,
        title: plan.title,
        startTime: plan.startTime,
        endTime: plan.endTime,
        durationSeconds: Math.max(plan.endSeconds - plan.startSeconds, 0),
        hook: plan.hook,
        caption: plan.caption,
        platforms: plan.platforms,
        templateId,
        assetPath: storedUpload.publicPath,
        assetBytes: storedUpload.byteLength,
        assetMimeType: storedUpload.contentType,
        renderedAt: new Date().toISOString(),
        exports: buildInitialClipExports(plan.platforms),
      });
    }

    const manifestUpload = await persistDerivedAsset({
      tenantSlug,
      slug: episode.slug,
      folder: "clip-manifests",
      fileName: `${episode.slug}-clips.json`,
      body: JSON.stringify(
        {
          episodeId: episode.id,
          episodeTitle: episode.title,
          renderedAt: new Date().toISOString(),
          brandLabel,
          clips: renderedClips,
        },
        null,
        2,
      ),
      contentType: "application/json; charset=utf-8",
      cacheControl: "public, max-age=300",
    });

    return {
      clips: renderedClips,
      manifestUrl: manifestUpload.publicPath,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
