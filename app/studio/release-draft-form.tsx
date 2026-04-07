'use client';

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clipPlatforms, clipRenderTemplates, distributionTargets } from "@/lib/cast";
import { createReleaseDraft, type ReleaseDraftState } from "./actions";

const audioTargetIds = new Set(["spotify", "apple", "pocketcasts", "overcast"]);
const videoTargetIds = new Set(["youtube", "shorts", "reels", "tiktok"]);

const audioTargets = distributionTargets.filter((target) => audioTargetIds.has(target.id));
const videoTargets = distributionTargets.filter((target) => videoTargetIds.has(target.id));
const clipPlanSlots = [1, 2, 3] as const;

const initialReleaseDraftState: ReleaseDraftState = {
  status: "idle",
  message: "Nog geen queued release opgeslagen.",
  issues: [],
  preview: null,
};

type UploadKind = "audio" | "video" | "artwork";

type UploadDescriptor = {
  fieldName: "audioMaster" | "videoMaster" | "artwork";
  kind: UploadKind;
  file: File;
};

type SignedUploadDescriptor = {
  kind: UploadKind;
  sourceName: string;
  publicPath: string;
  byteLength: number;
  contentType: string;
  uploadUrl: string;
  headers: Record<string, string>;
};

type UploadPhase = "idle" | "signing" | "uploading" | "saving";

type UploadStatus = {
  phase: UploadPhase;
  message: string;
  percent: number;
};

function InputLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground/70"
    >
      {children}
    </label>
  );
}

export function ReleaseDraftForm({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<ReleaseDraftState>(initialReleaseDraftState);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    phase: "idle",
    message: "",
    percent: 0,
  });
  const [pending, startTransition] = useTransition();
  const currentState = state ?? initialReleaseDraftState;
  const issues = currentState.issues ?? [];
  const preview = currentState.preview ?? null;
  const busy = pending || uploadStatus.phase !== "idle";

  async function uploadFileDirectly(
    file: File,
    signedUpload: SignedUploadDescriptor,
    onProgress: (loaded: number, total: number) => void,
  ) {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.open("PUT", signedUpload.uploadUrl);

      for (const [header, value] of Object.entries(signedUpload.headers)) {
        xhr.setRequestHeader(header, value);
      }

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          onProgress(event.loaded, event.total);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }

        reject(new Error(`Upload mislukt met status ${xhr.status}.`));
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Netwerkfout tijdens upload."));
      });

      xhr.send(file);
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy) {
      return;
    }

    const form = event.currentTarget;
    const rawFormData = new FormData(form);
    const title = typeof rawFormData.get("title") === "string" ? String(rawFormData.get("title")) : "";
    const uploads: UploadDescriptor[] = [];
    const audioFile = rawFormData.get("audioMaster");
    const videoFile = rawFormData.get("videoMaster");
    const artworkFile = rawFormData.get("artwork");

    if (audioFile instanceof File && audioFile.size > 0) {
      uploads.push({
        fieldName: "audioMaster",
        kind: "audio",
        file: audioFile,
      });
    }

    if (videoFile instanceof File && videoFile.size > 0) {
      uploads.push({
        fieldName: "videoMaster",
        kind: "video",
        file: videoFile,
      });
    }

    if (artworkFile instanceof File && artworkFile.size > 0) {
      uploads.push({
        fieldName: "artwork",
        kind: "artwork",
        file: artworkFile,
      });
    }

    let signedUploads: SignedUploadDescriptor[] = [];

    if (uploads.length > 0) {
      try {
        setUploadStatus({
          phase: "signing",
          message: "Signed uploads worden voorbereid...",
          percent: 5,
        });

        const signResponse = await fetch("/api/uploads/sign", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantSlug,
            title,
            files: uploads.map((upload) => ({
              kind: upload.kind,
              fileName: upload.file.name,
              byteLength: upload.file.size,
              contentType: upload.file.type || null,
            })),
          }),
        });
        const signPayload = (await signResponse.json()) as {
          status?: string;
          message?: string;
          issues?: string[];
          uploads?: SignedUploadDescriptor[];
        };

        if (!signResponse.ok || !Array.isArray(signPayload.uploads)) {
          setUploadStatus({
            phase: "idle",
            message: "",
            percent: 0,
          });
          setState({
            status: "error",
            message:
              signPayload.message ?? "Signed uploads konden niet worden voorbereid.",
            issues:
              signPayload.issues ?? [
                "Controleer de storage-configuratie en probeer opnieuw.",
              ],
            preview: null,
          });
          return;
        }

        signedUploads = signPayload.uploads;

        const totalBytes =
          uploads.reduce((sum, upload) => sum + upload.file.size, 0) || 1;
        const loadedByField = new Map<string, number>();

        setUploadStatus({
          phase: "uploading",
          message: "Bestanden worden direct naar de media-opslag geüpload...",
          percent: 10,
        });

        await Promise.all(
          uploads.map(async (upload) => {
            const signedUpload = signedUploads.find(
              (item) => item.kind === upload.kind,
            );

            if (!signedUpload) {
              throw new Error(`Signed upload ontbreekt voor ${upload.kind}.`);
            }

            await uploadFileDirectly(upload.file, signedUpload, (loaded) => {
              loadedByField.set(upload.fieldName, loaded);
              const totalLoaded = [...loadedByField.values()].reduce(
                (sum, value) => sum + value,
                0,
              );
              const percent = Math.min(
                98,
                Math.max(10, Math.round((totalLoaded / totalBytes) * 100)),
              );

              setUploadStatus({
                phase: "uploading",
                message: `Upload bezig: ${percent}%`,
                percent,
              });
            });
          }),
        );
      } catch (error) {
        setUploadStatus({
          phase: "idle",
          message: "",
          percent: 0,
        });
        setState({
          status: "error",
          message: "Directe upload naar de media-opslag is mislukt.",
          issues: [error instanceof Error ? error.message : "Onbekende uploadfout."],
          preview: null,
        });
        return;
      }
    }

    const submissionData = new FormData(form);
    submissionData.delete("audioMaster");
    submissionData.delete("videoMaster");
    submissionData.delete("artwork");

    for (const signedUpload of signedUploads) {
      submissionData.set(
        `${signedUpload.kind}UploadSourceName`,
        signedUpload.sourceName,
      );
      submissionData.set(
        `${signedUpload.kind}UploadPublicPath`,
        signedUpload.publicPath,
      );
      submissionData.set(
        `${signedUpload.kind}UploadByteLength`,
        String(signedUpload.byteLength),
      );
      submissionData.set(
        `${signedUpload.kind}UploadContentType`,
        signedUpload.contentType,
      );
    }

    setUploadStatus({
      phase: "saving",
      message: "Releasemetadata wordt opgeslagen...",
      percent: 100,
    });

    startTransition(async () => {
      const result = await createReleaseDraft(initialReleaseDraftState, submissionData);

      setState(result);
      setUploadStatus({
        phase: "idle",
        message: "",
        percent: 0,
      });

      if (result.status === "success") {
        formRef.current?.reset();
        router.refresh();
      }
    });
  }

  return (
    <section className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6 shadow-[0_20px_80px_rgba(2,10,24,0.2)]">
      <div className="space-y-3 border-b border-white/10 pb-5">
        <p className="font-mono text-xs uppercase tracking-[0.32em] text-accent-soft">
          Release intake
        </p>
        <h2 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">
          Sla een queued release op vanuit de frontend.
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-foreground/68">
          Deze stap schrijft metadata en gekozen masterbestanden nu echt weg.
          Grote assets gaan direct vanuit de browser naar de centrale
          media-opslag en alleen de release-data loopt nog via de app.
        </p>
      </div>

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        encType="multipart/form-data"
        className="mt-6 space-y-6"
      >
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <InputLabel htmlFor="title">Episode titel</InputLabel>
            <input
              id="title"
              name="title"
              type="text"
              required
              placeholder="Episode 015: De control room voor podcast distributie"
              className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground/35 focus:border-accent/65"
            />
          </div>

          <div className="space-y-2">
            <InputLabel htmlFor="scheduledFor">Publicatiemoment</InputLabel>
            <input
              id="scheduledFor"
              name="scheduledFor"
              type="datetime-local"
              required
              className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-accent/65"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[0.7fr_0.3fr]">
          <div className="space-y-2">
            <InputLabel htmlFor="duration">Duur</InputLabel>
            <input
              id="duration"
              name="duration"
              type="text"
              defaultValue="00:30:00"
              placeholder="00:42:00"
              className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground/35 focus:border-accent/65"
            />
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground">
            <input type="checkbox" name="explicit" className="h-4 w-4 accent-[var(--accent)]" />
            <span>Explicit content</span>
          </label>
        </div>

        <div className="space-y-2">
          <InputLabel htmlFor="summary">Release samenvatting</InputLabel>
          <textarea
            id="summary"
            name="summary"
            required
            rows={4}
            placeholder="Wat is de kern van deze aflevering en wat moet in de shownotes terechtkomen?"
            className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-foreground/35 focus:border-accent/65"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <InputLabel htmlFor="audioMaster">Audio master</InputLabel>
            <input
              id="audioMaster"
              name="audioMaster"
              type="file"
              accept="audio/*"
              className="block w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground file:mr-4 file:rounded-full file:border-0 file:bg-accent file:px-4 file:py-2 file:font-semibold file:text-background"
            />
          </div>

          <div className="space-y-2">
            <InputLabel htmlFor="videoMaster">Video master</InputLabel>
            <input
              id="videoMaster"
              name="videoMaster"
              type="file"
              accept="video/*"
              className="block w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground file:mr-4 file:rounded-full file:border-0 file:bg-accent file:px-4 file:py-2 file:font-semibold file:text-background"
            />
          </div>

          <div className="space-y-2">
            <InputLabel htmlFor="artwork">Artwork</InputLabel>
            <input
              id="artwork"
              name="artwork"
              type="file"
              accept="image/*"
              className="block w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground file:mr-4 file:rounded-full file:border-0 file:bg-accent file:px-4 file:py-2 file:font-semibold file:text-background"
            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <fieldset className="rounded-3xl border border-white/10 bg-black/18 p-4">
            <legend className="px-2 font-mono text-xs uppercase tracking-[0.28em] text-accent-soft">
              Audio targets
            </legend>
            <div className="mt-3 space-y-3">
              {audioTargets.map((target) => (
                <label
                  key={target.id}
                  className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/4 p-3"
                >
                  <input
                    type="checkbox"
                    name="audioTargets"
                    value={target.id}
                    defaultChecked={target.id === "spotify" || target.id === "apple"}
                    className="mt-1 h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-semibold text-foreground">
                      {target.label}
                    </span>
                    <span className="block text-xs leading-5 text-foreground/60">
                      {target.route}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded-3xl border border-white/10 bg-black/18 p-4">
            <legend className="px-2 font-mono text-xs uppercase tracking-[0.28em] text-sky-glow">
              Video & short-form
            </legend>
            <div className="mt-3 space-y-3">
              {videoTargets.map((target) => (
                <label
                  key={target.id}
                  className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/4 p-3"
                >
                  <input
                    type="checkbox"
                    name="videoTargets"
                    value={target.id}
                    defaultChecked={target.id === "youtube"}
                    className="mt-1 h-4 w-4 accent-[var(--sky-glow)]"
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-semibold text-foreground">
                      {target.label}
                    </span>
                    <span className="block text-xs leading-5 text-foreground/60">
                      {target.route}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-4 text-sm leading-6 text-foreground/58">
              Zodra je Shorts, Reels of TikTok selecteert, plant de backend automatisch
              eerst de verticale render pipeline en daarna de account-export jobs.
            </p>
          </fieldset>
        </div>

        <fieldset className="rounded-3xl border border-white/10 bg-black/18 p-4">
          <legend className="px-2 font-mono text-xs uppercase tracking-[0.28em] text-sky-glow">
            Clip segments
          </legend>
          <div className="mt-3 grid gap-4">
            {clipPlanSlots.map((slot) => (
              <div
                key={slot}
                className="rounded-[1.75rem] border border-white/8 bg-white/4 p-4"
              >
                <div className="grid gap-4 lg:grid-cols-[1fr_0.24fr_0.24fr]">
                  <div className="space-y-2">
                    <InputLabel htmlFor={`clipTitle${slot}`}>Clip {slot} titel</InputLabel>
                    <input
                      id={`clipTitle${slot}`}
                      name={`clipTitle${slot}`}
                      type="text"
                      placeholder={`Clip ${slot}: hook en highlight`}
                      className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground/35 focus:border-accent/65"
                    />
                  </div>
                  <div className="space-y-2">
                    <InputLabel htmlFor={`clipStart${slot}`}>Start</InputLabel>
                    <input
                      id={`clipStart${slot}`}
                      name={`clipStart${slot}`}
                      type="text"
                      placeholder="00:15"
                      className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground/35 focus:border-accent/65"
                    />
                  </div>
                  <div className="space-y-2">
                    <InputLabel htmlFor={`clipEnd${slot}`}>Einde</InputLabel>
                    <input
                      id={`clipEnd${slot}`}
                      name={`clipEnd${slot}`}
                      type="text"
                      placeholder="00:45"
                      className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground/35 focus:border-accent/65"
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_0.56fr]">
                  <div className="space-y-2">
                    <InputLabel htmlFor={`clipHook${slot}`}>Hook</InputLabel>
                    <textarea
                      id={`clipHook${slot}`}
                      name={`clipHook${slot}`}
                      rows={2}
                      placeholder="Wat pakt de kijker in de eerste seconden?"
                      className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-foreground/35 focus:border-accent/65"
                    />
                  </div>
                  <div className="space-y-2">
                    <InputLabel htmlFor={`clipCaption${slot}`}>Caption</InputLabel>
                    <textarea
                      id={`clipCaption${slot}`}
                      name={`clipCaption${slot}`}
                      rows={2}
                      placeholder="Caption of posttekst voor deze clip"
                      className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-foreground/35 focus:border-accent/65"
                    />
                  </div>
                  <div className="space-y-2">
                    <InputLabel htmlFor={`clipTemplate${slot}`}>Template</InputLabel>
                    <select
                      id={`clipTemplate${slot}`}
                      name={`clipTemplate${slot}`}
                      defaultValue="clean"
                      className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-accent/65"
                    >
                      {clipRenderTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs leading-5 text-foreground/50">
                      Kies hoe subtitles en branding in beeld worden gerenderd.
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground/70">
                    Platformen
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {clipPlatforms.map((platform) => (
                      <label
                        key={`${slot}-${platform.id}`}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-3 py-2 text-xs font-semibold text-foreground/76"
                      >
                        <input
                          type="checkbox"
                          name={`clipPlatforms${slot}`}
                          value={platform.id}
                          defaultChecked={platform.id === "shorts" || platform.id === "reels"}
                          className="h-4 w-4 accent-[var(--sky-glow)]"
                        />
                        <span>{platform.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm leading-6 text-foreground/60">
            Gebruik korte segmenten onder de 90 seconden. De renderer maakt
            verticale 9:16 masters met subtitles, branding en exports voor Shorts,
            Reels en TikTok.
          </p>
        </fieldset>

        <div className="flex flex-col gap-4 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl space-y-3">
            <p className="text-sm leading-6 text-foreground/60">
              Bestanden worden met signed uploads direct naar de media-opslag
              geschreven en alleen de metadata gaat de backend-store in.
            </p>

            {uploadStatus.phase !== "idle" ? (
              <div className="rounded-2xl border border-white/10 bg-black/18 p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm text-foreground/76">{uploadStatus.message}</p>
                  <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent-soft">
                    {uploadStatus.percent}%
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                    style={{ width: `${uploadStatus.percent}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center justify-center rounded-full border border-accent/50 bg-accent px-5 py-3 text-sm font-semibold text-background transition-transform duration-200 hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70"
          >
            {uploadStatus.phase === "signing"
              ? "Upload wordt voorbereid..."
              : uploadStatus.phase === "uploading"
                ? "Bestanden worden geüpload..."
                : uploadStatus.phase === "saving" || pending
                  ? "Release wordt opgeslagen..."
                  : "Sla queued release op"}
          </button>
        </div>
      </form>

      <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-black/18 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-accent-soft">
            Release output
          </p>
          <p
            className={`text-sm ${
              currentState.status === "error"
                ? "text-[#ffb4a6]"
                : currentState.status === "success"
                  ? "text-mint-glow"
                  : "text-foreground/55"
            }`}
          >
            {currentState.message}
          </p>
        </div>

        {issues.length > 0 ? (
          <ul className="mt-4 space-y-2 text-sm leading-6 text-[#ffd2c7]">
            {issues.map((issue) => (
              <li key={issue} className="rounded-2xl border border-[#ffb4a6]/20 bg-[#ffb4a6]/8 px-4 py-3">
                {issue}
              </li>
            ))}
          </ul>
        ) : null}

        {preview ? (
          <div className="mt-5 space-y-5">
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-3xl border border-white/10 bg-white/4 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-accent-soft">
                  Release
                </p>
                <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-foreground">
                  {preview.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-foreground/68">
                  {preview.summary}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full border border-white/10 bg-black/18 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/70">
                    slug {preview.slug}
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/18 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/70">
                    {preview.scheduledFor}
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/18 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/70">
                    E{preview.episodeNumber}
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/18 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/70">
                    {preview.duration}
                  </span>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/4 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-glow">
                  Opgeslagen assets
                </p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-foreground/68">
                  {preview.files.map((file) => (
                    <li key={file} className="rounded-2xl border border-white/8 bg-black/18 px-4 py-3">
                      {file}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-white/4 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-accent-soft">
                  Audio route
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {preview.audioTargets.map((target) => (
                    <span
                      key={target}
                      className="rounded-full border border-white/10 bg-black/18 px-3 py-1 text-xs font-semibold text-foreground/76"
                    >
                      {target}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/4 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-glow">
                  Video route
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {preview.videoTargets.map((target) => (
                    <span
                      key={target}
                      className="rounded-full border border-white/10 bg-black/18 px-3 py-1 text-xs font-semibold text-foreground/76"
                    >
                      {target}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {preview.clipTitles.length > 0 ? (
              <div className="rounded-3xl border border-white/10 bg-white/4 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-glow">
                  Clip pipeline
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {preview.clipTitles.map((clipTitle) => (
                    <span
                      key={clipTitle}
                      className="rounded-full border border-white/10 bg-black/18 px-3 py-1 text-xs font-semibold text-foreground/76"
                    >
                      {clipTitle}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-3xl border border-white/10 bg-white/4 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-accent-soft">
                  Volgende checks
                </p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-foreground/68">
                {preview.nextChecks.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-accent-soft" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
