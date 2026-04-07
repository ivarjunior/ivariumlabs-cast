import Link from "next/link";
import {
  type CastWorkspace,
  getConnectorBoardStats,
  getDashboardStats,
  getJobBoardStats,
  getTargets,
} from "@/lib/cast";
import { type DistributionWorkerStatus } from "@/lib/distribution-worker";
import { type ObjectStorageStatus } from "@/lib/object-storage";
import {
  lockTenantStudio,
  publishQueuedRelease,
  runDistributionJob,
  runPendingDistributionQueue,
  saveConnectorConfig,
  updateDistributionJobStatus,
} from "./actions";
import { ReleaseDraftForm } from "./release-draft-form";

export const metadata = {
  title: "Studio | IvariumLabs Cast",
  description:
    "Private tenant studio voor releases, feedstatus en distributie van IvariumLabs Cast.",
};

function formatDutchDate(dateString: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(dateString));
}

function formatJobHistoryEventLabel(event: string) {
  if (event === "queued") {
    return "In wachtrij";
  }

  if (event === "started") {
    return "Run gestart";
  }

  if (event === "completed") {
    return "Run afgerond";
  }

  if (event === "failed") {
    return "Run gefaald";
  }

  if (event === "retry-scheduled") {
    return "Retry ingepland";
  }

  return "Status aangepast";
}

function StatusPill({
  state,
  label,
}: {
  state: string;
  label: string;
}) {
  const palette =
    state === "live" || state === "completed" || state === "ready"
      ? "border-mint-glow/30 bg-mint-glow/12 text-mint-glow"
      : state === "queued" || state === "pending" || state === "setup"
        ? "border-accent/30 bg-accent/12 text-accent-soft"
        : state === "review" || state === "processing"
          ? "border-sky-glow/30 bg-sky-glow/12 text-sky-glow"
          : state === "failed" || state === "disabled"
            ? "border-[#ffb4a6]/30 bg-[#ffb4a6]/12 text-[#ffb4a6]"
          : "border-white/10 bg-white/6 text-foreground/74";

  return (
    <span
      className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] ${palette}`}
    >
      {label}
    </span>
  );
}

type StudioShellProps = {
  workspace: CastWorkspace;
  storageStatus: ObjectStorageStatus;
  workerStatus: DistributionWorkerStatus;
};

export function StudioShell({
  workspace,
  storageStatus,
  workerStatus,
}: StudioShellProps) {
  const { tenant, show, publishedEpisodes, queuedReleases, distributionJobs, connectors } =
    workspace;
  const dashboardStats = getDashboardStats(workspace);
  const jobBoardStats = getJobBoardStats(workspace);
  const connectorBoardStats = getConnectorBoardStats(workspace);
  const openJobs = jobBoardStats.pending + jobBoardStats.processing + jobBoardStats.failed;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 sm:px-10 lg:px-12">
      <header className="flex flex-col gap-6 border-b border-white/10 pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.32em] text-accent-soft">
            {tenant.companyName} studio
          </p>
          <h1 className="max-w-4xl text-5xl font-semibold leading-[0.96] tracking-[-0.06em] text-foreground sm:text-6xl">
            Studio, store en feed lopen nu door dezelfde backendlaag.
          </h1>
          <p className="max-w-3xl text-base leading-7 text-foreground/70 sm:text-lg">
            Nieuwe releases schrijven metadata naar de studio-store, masters en
            artwork landen direct in de media-opslag, en queued episodes kun je
            vanuit deze studio publiceren naar de feed.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <form action={lockTenantStudio}>
            <input type="hidden" name="tenantSlug" value={tenant.slug} />
            <button
              type="submit"
              className="inline-flex items-center rounded-full border border-white/14 bg-white/6 px-4 py-2 text-sm font-semibold text-foreground/86 transition-colors duration-200 hover:bg-white/10"
            >
              Sluit studio
            </button>
          </form>
          <Link
            href="/"
            className="inline-flex items-center rounded-full border border-white/14 bg-white/6 px-4 py-2 text-sm font-semibold text-foreground/86 transition-colors duration-200 hover:bg-white/10"
          >
            Terug naar home
          </Link>
          <a
            href={show.feedPath}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-full border border-accent/50 bg-accent px-4 py-2 text-sm font-semibold text-background transition-transform duration-200 hover:-translate-y-0.5"
          >
            Open feed.xml
          </a>
        </div>
      </header>

      <section className="grid gap-6 py-10 lg:grid-cols-[0.92fr_1.08fr]">
        <div className="space-y-6">
          <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(17,28,44,0.9),rgba(11,19,33,0.82))] p-6 shadow-[0_20px_100px_rgba(0,0,0,0.26)]">
            <p className="font-mono text-xs uppercase tracking-[0.32em] text-accent-soft">
              Show profile
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-foreground">
              {show.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-foreground/68">
              {show.description}
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-black/18 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-accent-soft">
                  Feed endpoint
                </p>
                <p className="mt-3 text-sm leading-6 text-foreground/72">
                  {show.feedPath}
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-black/18 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-accent-soft">
                  Owner
                </p>
                <p className="mt-3 text-sm leading-6 text-foreground/72">
                  {show.ownerName}
                  <br />
                  {show.ownerEmail}
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: "Published",
                  value: dashboardStats.publishedEpisodes.toString(),
                },
                {
                  label: "Queued",
                  value: dashboardStats.queuedReleases.toString(),
                },
                {
                  label: "Open jobs",
                  value: openJobs.toString(),
                },
                {
                  label: "Job total",
                  value: dashboardStats.distributionJobs.toString(),
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-3xl border border-white/10 bg-white/6 p-4"
                >
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-foreground/55">
                    {item.label}
                  </p>
                  <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-[2rem] border border-white/10 bg-white/5 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <p className="font-mono text-xs uppercase tracking-[0.32em] text-sky-glow">
                  Media storage
                </p>
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
                  Uploads gaan rechtstreeks naar de centrale object store.
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-foreground/68">
                  Zonder complete storage-configuratie accepteert de intake geen
                  nieuwe audio-, video- of artworkbestanden. Grote bestanden
                  lopen via signed uploads direct vanuit de browser.
                </p>
              </div>

              <StatusPill
                state={storageStatus.configured ? "ready" : "setup"}
                label={storageStatus.configured ? "ready" : "setup required"}
              />
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-black/18 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-accent-soft">
                  Bucket
                </p>
                <p className="mt-3 break-all text-sm leading-6 text-foreground/72">
                  {storageStatus.bucket ?? "Nog niet ingesteld"}
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-black/18 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-accent-soft">
                  Public base URL
                </p>
                <p className="mt-3 break-all text-sm leading-6 text-foreground/72">
                  {storageStatus.publicBaseUrl ?? "Nog niet ingesteld"}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-3xl border border-white/10 bg-black/18 p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-accent-soft">
                Runtime
              </p>
              <p className="mt-3 text-sm leading-6 text-foreground/72">
                Regio {storageStatus.region}
                {storageStatus.endpoint ? " en upload-endpoint actief." : ", endpoint nog niet beschikbaar."}
              </p>
            </div>

            {storageStatus.missing.length > 0 ? (
              <div className="mt-4 rounded-[1.75rem] border border-[#ffb4a6]/20 bg-[#ffb4a6]/8 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#ffd2c7]">
                  Ontbrekende configuratie
                </p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-[#ffd2c7]">
                  {storageStatus.missing.map((item) => (
                    <li
                      key={item}
                      className="rounded-2xl border border-[#ffb4a6]/20 bg-[#ffb4a6]/8 px-4 py-3"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>

          <article className="rounded-[2rem] border border-white/10 bg-white/5 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <p className="font-mono text-xs uppercase tracking-[0.32em] text-sky-glow">
                  Distribution worker
                </p>
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
                  Pending jobs kunnen automatisch in batches worden verwerkt.
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-foreground/68">
                  De geplande worker gebruikt dezelfde connectorlogica als de
                  studio. Je kunt daarnaast nog steeds handmatig een batch voor
                  deze tenant starten.
                </p>
              </div>

              <StatusPill
                state={workerStatus.configured ? "ready" : "setup"}
                label={workerStatus.configured ? "automation ready" : "setup required"}
              />
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-black/18 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-accent-soft">
                  Worker route
                </p>
                <p className="mt-3 text-sm leading-6 text-foreground/72">
                  {workerStatus.routePath}
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-black/18 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-accent-soft">
                  Cadence
                </p>
                <p className="mt-3 text-sm leading-6 text-foreground/72">
                  {workerStatus.schedule} · batch {workerStatus.batchSize}
                </p>
              </div>
            </div>

            <form action={runPendingDistributionQueue} className="mt-5 space-y-3">
              <input type="hidden" name="tenantSlug" value={tenant.slug} />
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-full border border-white/14 bg-white/6 px-4 py-2 text-sm font-semibold text-foreground transition-colors duration-200 hover:bg-white/10"
              >
                Verwerk pending jobs
              </button>
              <p className="text-xs leading-5 text-foreground/55">
                Draait een handmatige batch-run voor deze tenant bovenop de
                geplande worker.
              </p>
            </form>

            {workerStatus.missing.length > 0 ? (
              <div className="mt-4 rounded-[1.75rem] border border-[#ffb4a6]/20 bg-[#ffb4a6]/8 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#ffd2c7]">
                  Ontbrekende worker-configuratie
                </p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-[#ffd2c7]">
                  {workerStatus.missing.map((item) => (
                    <li
                      key={item}
                      className="rounded-2xl border border-[#ffb4a6]/20 bg-[#ffb4a6]/8 px-4 py-3"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>

          <article className="rounded-[2rem] border border-white/10 bg-white/5 p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.32em] text-sky-glow">
                  Queued releases
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-foreground">
                  Releases die klaarstaan voor feed-publicatie.
                </h2>
              </div>
              <StatusPill
                state={queuedReleases.length > 0 ? "queued" : "manual"}
                label={queuedReleases.length > 0 ? `${queuedReleases.length} queued` : "empty"}
              />
            </div>

            {queuedReleases.length > 0 ? (
              <div className="mt-5 grid gap-4">
                {queuedReleases.map((release) => (
                  <div
                    key={release.id}
                    className="rounded-[1.75rem] border border-white/10 bg-black/18 p-5"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="max-w-2xl">
                        <div className="flex flex-wrap gap-2">
                          <StatusPill state={release.status} label={release.status} />
                          <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/70">
                            S{release.seasonNumber} E{release.episodeNumber}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/70">
                            {release.duration}
                          </span>
                        </div>
                        <h3 className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-foreground">
                          {release.title}
                        </h3>
                        <p className="mt-3 text-sm leading-6 text-foreground/68">
                          {release.summary}
                        </p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-white/10 bg-white/4 p-3">
                            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-accent-soft">
                              Audio asset
                            </p>
                            <p className="mt-2 text-sm leading-6 text-foreground/72">
                              {release.audioMasterName ?? "Nog geen audio"}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-white/4 p-3">
                            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-accent-soft">
                              Video asset
                            </p>
                            <p className="mt-2 text-sm leading-6 text-foreground/72">
                              {release.videoMasterName ?? "Geen video gekoppeld"}
                            </p>
                          </div>
                        </div>
                        <p className="mt-4 text-xs uppercase tracking-[0.24em] text-foreground/50">
                          gepland voor {formatDutchDate(release.scheduledFor)}
                        </p>
                      </div>

                      <div className="w-full max-w-md space-y-4">
                        <div className="rounded-3xl border border-white/10 bg-white/4 p-4">
                          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-glow">
                            Targets
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {getTargets(release.targetIds).map((target) => (
                              <span
                                key={`${release.id}-${target.id}`}
                                className="rounded-full border border-white/10 bg-black/18 px-3 py-1 text-xs font-semibold text-foreground/76"
                              >
                                {target.label}
                              </span>
                            ))}
                          </div>
                        </div>

                        <form action={publishQueuedRelease} className="space-y-3">
                          <input type="hidden" name="tenantSlug" value={tenant.slug} />
                          <input type="hidden" name="releaseId" value={release.id} />
                          <button
                            type="submit"
                            disabled={!release.audioMasterPath}
                            className="inline-flex w-full items-center justify-center rounded-full border border-accent/50 bg-accent px-5 py-3 text-sm font-semibold text-background transition-transform duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            {release.audioMasterPath
                              ? "Publiceer naar feed"
                              : "Audio upload vereist voor feed-publicatie"}
                          </button>
                          <p className="text-xs leading-5 text-foreground/55">
                            Deze actie verplaatst de release van de queue naar de
                            gepubliceerde episodes en zet hem direct in `feed.xml`.
                          </p>
                        </form>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-[1.75rem] border border-white/10 bg-black/18 p-5 text-sm leading-6 text-foreground/68">
                Er staan nog geen queued releases in de store. Gebruik het intakeformulier
                om de eerste release aan te maken.
              </div>
            )}
          </article>
        </div>

        <ReleaseDraftForm tenantSlug={tenant.slug} />
      </section>

      <section className="border-t border-white/10 py-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <p className="font-mono text-xs uppercase tracking-[0.32em] text-accent-soft">
              Connector control room
            </p>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">
              Per platform bepaal je hoe jobs echt moeten lopen.
            </h2>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { label: "ready", value: connectorBoardStats.ready },
              { label: "setup", value: connectorBoardStats.setup },
              { label: "disabled", value: connectorBoardStats.disabled },
            ].map((item) => (
              <span
                key={item.label}
                className="rounded-full border border-white/10 bg-white/6 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/70"
              >
                {item.label} {item.value}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-8 grid gap-4 xl:grid-cols-2">
          {connectors.map((connector) => {
            const target = getTargets([connector.targetId])[0];

            return (
              <article
                key={connector.targetId}
                className="rounded-[2rem] border border-white/10 bg-white/5 p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
                      {target?.label ?? connector.targetId}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-foreground/64">
                      {target?.route}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill state={connector.readiness} label={connector.readiness} />
                    <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/70">
                      {connector.mode}
                    </span>
                  </div>
                </div>

                <form action={saveConnectorConfig} className="mt-5 space-y-4">
                  <input type="hidden" name="tenantSlug" value={tenant.slug} />
                  <input type="hidden" name="targetId" value={connector.targetId} />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 text-sm text-foreground/68">
                      <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                        Mode
                      </span>
                      <select
                        name="mode"
                        defaultValue={connector.mode}
                        className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none"
                      >
                        <option value="rss">rss</option>
                        <option value="api">api</option>
                        <option value="manual">manual</option>
                      </select>
                    </label>

                    <label className="space-y-2 text-sm text-foreground/68">
                      <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                        Readiness
                      </span>
                      <select
                        name="readiness"
                        defaultValue={connector.readiness}
                        className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none"
                      >
                        <option value="ready">ready</option>
                        <option value="setup">setup</option>
                        <option value="disabled">disabled</option>
                      </select>
                    </label>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 text-sm text-foreground/68">
                      <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                        Account label
                      </span>
                      <input
                        name="accountLabel"
                        type="text"
                        defaultValue={connector.accountLabel}
                        placeholder="Primary show"
                        className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/35"
                      />
                    </label>

                    <label className="space-y-2 text-sm text-foreground/68">
                      <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                        Destination
                      </span>
                      <input
                        name="destination"
                        type="text"
                        defaultValue={connector.destination}
                        placeholder={
                          connector.targetId === "youtube"
                            ? "optionele playlist id"
                            : "feed.xml ingest of directory route"
                        }
                        className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/35"
                      />
                    </label>
                  </div>

                  {connector.targetId === "youtube" ? (
                    <div className="rounded-[1.75rem] border border-white/10 bg-black/18 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-glow">
                            Tenant API config
                          </p>
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/64">
                            Laat lege velden ongemoeid om eerder opgeslagen waarden
                            te behouden. Nieuwe waarden worden alleen voor deze tenant
                            gebruikt.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-semibold text-foreground/76">
                            client id {connector.youtubeConfig?.clientId ? "saved" : "missing"}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-semibold text-foreground/76">
                            secret {connector.youtubeConfig?.clientSecret ? "saved" : "missing"}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-semibold text-foreground/76">
                            token {connector.youtubeConfig?.refreshToken ? "saved" : "missing"}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="space-y-2 text-sm text-foreground/68">
                          <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                            Client ID
                          </span>
                          <input
                            name="youtubeClientId"
                            type="text"
                            defaultValue=""
                            placeholder={
                              connector.youtubeConfig?.clientId
                                ? "Opgeslagen waarde blijft behouden"
                                : "Tenant client id"
                            }
                            className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/35"
                          />
                        </label>

                        <label className="space-y-2 text-sm text-foreground/68">
                          <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                            Client Secret
                          </span>
                          <input
                            name="youtubeClientSecret"
                            type="password"
                            defaultValue=""
                            placeholder={
                              connector.youtubeConfig?.clientSecret
                                ? "Opgeslagen waarde blijft behouden"
                                : "Tenant secret"
                            }
                            className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/35"
                          />
                        </label>

                        <label className="space-y-2 text-sm text-foreground/68 sm:col-span-2">
                          <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                            Refresh Token
                          </span>
                          <input
                            name="youtubeRefreshToken"
                            type="password"
                            defaultValue=""
                            placeholder={
                              connector.youtubeConfig?.refreshToken
                                ? "Opgeslagen waarde blijft behouden"
                                : "Tenant refresh token"
                            }
                            className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/35"
                          />
                        </label>

                        <label className="space-y-2 text-sm text-foreground/68">
                          <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                            Privacy
                          </span>
                          <select
                            name="youtubePrivacyStatus"
                            defaultValue={connector.youtubeConfig?.privacyStatus ?? "private"}
                            className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none"
                          >
                            <option value="private">private</option>
                            <option value="unlisted">unlisted</option>
                            <option value="public">public</option>
                          </select>
                        </label>

                        <label className="space-y-2 text-sm text-foreground/68">
                          <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                            Category
                          </span>
                          <input
                            name="youtubeCategoryId"
                            type="text"
                            defaultValue={connector.youtubeConfig?.categoryId ?? "28"}
                            placeholder="28"
                            className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/35"
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}

                  <label className="block space-y-2 text-sm text-foreground/68">
                    <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                      Notes
                    </span>
                    <textarea
                      name="note"
                      rows={3}
                      defaultValue={connector.note}
                      className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm leading-6 text-foreground outline-none"
                    />
                  </label>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs leading-5 text-foreground/52">
                      Laatst bijgewerkt {formatDutchDate(connector.updatedAt)}
                    </p>
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center rounded-full border border-white/14 bg-white/6 px-4 py-2 text-sm font-semibold text-foreground transition-colors duration-200 hover:bg-white/10"
                    >
                      Sla connector op
                    </button>
                  </div>
                </form>
              </article>
            );
          })}
        </div>
      </section>

      <section className="border-t border-white/10 py-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <p className="font-mono text-xs uppercase tracking-[0.32em] text-accent-soft">
              Distribution jobs
            </p>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">
              Platformtaken per release en per kanaal.
            </h2>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { label: "pending", value: jobBoardStats.pending },
              { label: "processing", value: jobBoardStats.processing },
              { label: "completed", value: jobBoardStats.completed },
              { label: "failed", value: jobBoardStats.failed },
              { label: "retry scheduled", value: jobBoardStats.scheduled },
            ].map((item) => (
              <span
                key={item.label}
                className="rounded-full border border-white/10 bg-white/6 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/70"
              >
                {item.label} {item.value}
              </span>
            ))}
          </div>
        </div>

        {distributionJobs.length > 0 ? (
          <div className="mt-8 grid gap-4">
            {distributionJobs.map((job) => {
              const target = getTargets([job.targetId])[0];

              return (
                <article
                  key={job.id}
                  className="rounded-[2rem] border border-white/10 bg-white/5 p-6"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-3xl">
                      <div className="flex flex-wrap gap-2">
                        <StatusPill state={job.status} label={job.status} />
                        {job.nextRetryAt ? (
                          <StatusPill state="queued" label="retry scheduled" />
                        ) : null}
                        <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/70">
                          {job.kind}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/70">
                          {job.lane}
                        </span>
                      </div>
                      <h3 className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-foreground">
                        {job.episodeTitle}
                      </h3>
                      <p className="mt-3 text-sm leading-6 text-foreground/68">
                        {target?.label ?? job.targetId}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-foreground/60">
                        {job.note}
                      </p>
                      {job.nextRetryAt ? (
                        <p className="mt-2 text-xs uppercase tracking-[0.22em] text-accent-soft">
                          automatische retry gepland op {formatDutchDate(job.nextRetryAt)}
                        </p>
                      ) : null}
                      {!job.nextRetryAt &&
                      job.status === "failed" &&
                      job.attemptCount >= job.maxAttempts ? (
                        <p className="mt-2 text-xs uppercase tracking-[0.22em] text-[#ffb4a6]">
                          retrylimiet bereikt, handmatige opvolging vereist
                        </p>
                      ) : null}
                      {job.externalId ? (
                        <p className="mt-2 text-xs uppercase tracking-[0.22em] text-foreground/45">
                          external id {job.externalId}
                        </p>
                      ) : null}
                      <p className="mt-4 text-xs uppercase tracking-[0.24em] text-foreground/50">
                        laatst bijgewerkt {formatDutchDate(job.updatedAt)}
                        {" · "}
                        attempts {job.attemptCount}/{job.maxAttempts}
                      </p>
                      {job.lastAttemptAt ? (
                        <p className="mt-2 text-xs uppercase tracking-[0.22em] text-foreground/45">
                          laatste poging {formatDutchDate(job.lastAttemptAt)}
                        </p>
                      ) : null}
                      {job.externalUrl ? (
                        <a
                          href={job.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-4 inline-flex items-center rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-white/10"
                        >
                          Open resultaat
                        </a>
                      ) : null}
                      {job.history.length > 0 ? (
                        <div className="mt-5 rounded-3xl border border-white/10 bg-black/18 p-4">
                          <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-accent-soft">
                            Audit trail
                          </p>
                          <div className="mt-4 space-y-3">
                            {job.history.slice(0, 6).map((entry) => (
                              <div
                                key={entry.id}
                                className="border-l border-white/12 pl-4"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-foreground">
                                    {formatJobHistoryEventLabel(entry.event)}
                                  </p>
                                  {entry.toStatus ? (
                                    <StatusPill
                                      state={entry.toStatus}
                                      label={entry.toStatus}
                                    />
                                  ) : null}
                                </div>
                                <p className="mt-2 text-sm leading-6 text-foreground/68">
                                  {entry.note}
                                </p>
                                <p className="mt-2 text-xs uppercase tracking-[0.22em] text-foreground/45">
                                  {formatDutchDate(entry.at)}
                                  {typeof entry.attemptCount === "number"
                                    ? ` · attempt ${entry.attemptCount}/${job.maxAttempts}`
                                    : ""}
                                  {entry.nextRetryAt
                                    ? ` · retry ${formatDutchDate(entry.nextRetryAt)}`
                                    : ""}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="w-full max-w-md space-y-3">
                      {job.status !== "completed" ? (
                        <form action={runDistributionJob}>
                          <input type="hidden" name="tenantSlug" value={tenant.slug} />
                          <input type="hidden" name="jobId" value={job.id} />
                          <button
                            type="submit"
                            className="inline-flex w-full items-center justify-center rounded-full border border-accent/50 bg-accent px-5 py-3 text-sm font-semibold text-background transition-transform duration-200 hover:-translate-y-0.5"
                          >
                            Run connector
                          </button>
                        </form>
                      ) : null}

                      <form action={updateDistributionJobStatus} className="space-y-3">
                        <input type="hidden" name="tenantSlug" value={tenant.slug} />
                        <input type="hidden" name="jobId" value={job.id} />
                        <div className="grid gap-2 sm:grid-cols-2">
                          <button
                            type="submit"
                            name="status"
                            value="pending"
                            className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-white/10"
                          >
                            Reset queue
                          </button>
                          <button
                            type="submit"
                            name="status"
                            value="processing"
                            className="rounded-full border border-sky-glow/40 bg-sky-glow/12 px-4 py-2 text-sm font-semibold text-sky-glow transition-colors hover:bg-sky-glow/18"
                          >
                            Start job
                          </button>
                          <button
                            type="submit"
                            name="status"
                            value="completed"
                            className="rounded-full border border-mint-glow/40 bg-mint-glow/12 px-4 py-2 text-sm font-semibold text-mint-glow transition-colors hover:bg-mint-glow/18"
                          >
                            Markeer afgerond
                          </button>
                          <button
                            type="submit"
                            name="status"
                            value="failed"
                            className="rounded-full border border-[#ffb4a6]/40 bg-[#ffb4a6]/12 px-4 py-2 text-sm font-semibold text-[#ffb4a6] transition-colors hover:bg-[#ffb4a6]/18"
                          >
                            Markeer gefaald
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mt-8 rounded-[2rem] border border-white/10 bg-black/18 p-5 text-sm leading-6 text-foreground/68">
            Er zijn nog geen distributiejobs. Zodra je een queued release naar de
            feed publiceert, maakt de studio automatisch platformtaken aan.
          </div>
        )}
      </section>

      <section className="border-t border-white/10 py-10">
        <div className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.32em] text-accent-soft">
            Published episodes
          </p>
          <h2 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">
            Gepubliceerde feed-items en hun distributiestatus.
          </h2>
        </div>

        <div className="mt-8 grid gap-4">
          {publishedEpisodes.map((episode) => (
            <article
              key={episode.id}
              id={episode.slug}
              className="rounded-[2rem] border border-white/10 bg-white/5 p-6"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl">
                  <div className="flex flex-wrap gap-2">
                    <StatusPill state={episode.status} label={episode.status} />
                    <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/70">
                      S{episode.seasonNumber} E{episode.episodeNumber}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/70">
                      {episode.duration}
                    </span>
                  </div>
                  <h3 className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-foreground">
                    {episode.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-foreground/68">
                    {episode.description}
                  </p>
                  <p className="mt-4 text-xs uppercase tracking-[0.24em] text-foreground/50">
                    {formatDutchDate(episode.publishedAt)}
                  </p>
                </div>

                <div className="min-w-0 rounded-3xl border border-white/10 bg-black/18 p-4 lg:w-[24rem]">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-glow">
                    Distribution status
                  </p>
                  <div className="mt-3 space-y-3">
                    {episode.distribution.map((item) => {
                      const target = getTargets([item.targetId])[0];

                      return (
                        <div
                          key={`${episode.id}-${item.targetId}`}
                          className="rounded-2xl border border-white/8 bg-white/4 p-3"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <p className="text-sm font-semibold text-foreground">
                              {target?.label ?? item.targetId}
                            </p>
                            <StatusPill state={item.state} label={item.state} />
                          </div>
                          <p className="mt-2 text-xs leading-5 text-foreground/60">
                            {item.note}
                          </p>
                          {item.externalId ? (
                            <p className="mt-2 text-[11px] uppercase tracking-[0.22em] text-foreground/45">
                              external id {item.externalId}
                            </p>
                          ) : null}
                          {item.syncedAt ? (
                            <p className="mt-2 text-[11px] uppercase tracking-[0.22em] text-foreground/45">
                              gesynct {formatDutchDate(item.syncedAt)}
                            </p>
                          ) : null}
                          {item.externalUrl ? (
                            <a
                              href={item.externalUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-flex items-center rounded-full border border-white/10 bg-black/18 px-3 py-1 text-xs font-semibold text-foreground/76 transition-colors hover:bg-white/10"
                            >
                              Open resultaat
                            </a>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

type StudioPageProps = {
  searchParams?: Promise<{
    platform?: string;
  }>;
};

export default async function StudioPage({ searchParams }: StudioPageProps) {
  const resolvedSearchParams = (await searchParams) || {};
  const platformMessage =
    resolvedSearchParams.platform === "invalid"
      ? "De studio-link uit het hoofdplatform is ongeldig of verlopen. Open de cast studio opnieuw vanuit de hoofdapp."
      : resolvedSearchParams.platform === "config"
        ? "De platform-handoff is nog niet volledig geconfigureerd. Voeg eerst dezelfde handoff-secret toe aan beide apps."
        : "";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-6 py-12 sm:px-10">
      <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(17,28,44,0.9),rgba(11,19,33,0.82))] p-8 shadow-[0_20px_100px_rgba(0,0,0,0.26)]">
        <p className="font-mono text-xs uppercase tracking-[0.32em] text-accent-soft">
          Private studio access
        </p>
        <h1 className="mt-4 text-5xl font-semibold leading-[0.96] tracking-[-0.06em] text-foreground sm:text-6xl">
          Elke castworkspace draait nu per company.
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-foreground/70 sm:text-lg">
          Gebruik je private studio-link om je tenant te openen. Deze route toont
          geen releases, feeds of episodes van een specifieke company.
        </p>
        {platformMessage ? (
          <div className="mt-6 rounded-[1.5rem] border border-[#ffb4a6]/20 bg-[#ffb4a6]/8 px-4 py-3 text-sm leading-6 text-[#ffd2c7]">
            {platformMessage}
          </div>
        ) : null}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/"
            className="inline-flex items-center rounded-full border border-accent/50 bg-accent px-5 py-3 text-sm font-semibold text-background transition-transform duration-200 hover:-translate-y-0.5"
          >
            Terug naar home
          </Link>
        </div>
      </div>
    </main>
  );
}
