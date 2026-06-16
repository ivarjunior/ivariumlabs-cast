import Link from "next/link";
import {
  type CastWorkspace,
  clipRenderTemplates,
  getConnectorBoardStats,
  getConnectorHealthBoard,
  getConnectorHealthBoardStats,
  getDashboardStats,
  getJobBoardStats,
  getTargets,
} from "@/lib/cast";
import { type CastStorePersistenceStatus } from "@/lib/cast-store";
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

function formatClipTemplateLabel(templateId: string) {
  return (
    clipRenderTemplates.find((template) => template.id === templateId)?.label ??
    templateId
  );
}

function formatWorkerTriggerLabel(trigger: string | null | undefined) {
  if (trigger === "manual-job") {
    return "Handmatige job-run";
  }

  if (trigger === "manual-batch") {
    return "Handmatige batch-run";
  }

  if (trigger === "scheduler") {
    return "Scheduler-run";
  }

  return "Nog geen trigger";
}

function StatusPill({
  state,
  label,
}: {
  state: string;
  label: string;
}) {
  const palette =
    state === "live" ||
    state === "completed" ||
    state === "ready" ||
    state === "healthy" ||
    state === "success"
      ? "border-mint-glow/30 bg-mint-glow/12 text-mint-glow"
      : state === "queued" ||
          state === "pending" ||
          state === "setup" ||
          state === "attention"
        ? "border-accent/30 bg-accent/12 text-accent-soft"
        : state === "review" ||
            state === "processing" ||
            state === "active" ||
            state === "partial"
          ? "border-sky-glow/30 bg-sky-glow/12 text-sky-glow"
          : state === "failed" ||
              state === "disabled" ||
              state === "blocked"
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

function OverviewMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/6 p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-foreground/55">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">
        {value}
      </p>
      <p className="mt-2 text-sm leading-6 text-foreground/62">{detail}</p>
    </div>
  );
}

function OperationalCheck({
  title,
  state,
  detail,
  meta,
}: {
  title: string;
  state: string;
  detail: string;
  meta?: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/18 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-accent-soft">
            {title}
          </p>
          <p className="text-sm leading-6 text-foreground/72">{detail}</p>
          {meta ? (
            <p className="text-xs uppercase tracking-[0.22em] text-foreground/45">
              {meta}
            </p>
          ) : null}
        </div>
        <StatusPill state={state} label={state} />
      </div>
    </div>
  );
}

type StudioShellProps = {
  workspace: CastWorkspace;
  storageStatus: ObjectStorageStatus;
  workerStatus: DistributionWorkerStatus;
  persistenceStatus: CastStorePersistenceStatus;
  platformEntryStatus: {
    configured: boolean;
    missing: string[];
  };
};

export function StudioShell({
  workspace,
  storageStatus,
  workerStatus,
  persistenceStatus,
  platformEntryStatus,
}: StudioShellProps) {
  const { tenant, show, publishedEpisodes, queuedReleases, distributionJobs, connectors } =
    workspace;
  const dashboardStats = getDashboardStats(workspace);
  const jobBoardStats = getJobBoardStats(workspace);
  const connectorBoardStats = getConnectorBoardStats(workspace);
  const connectorHealthBoard = getConnectorHealthBoard(workspace);
  const connectorHealthStats = getConnectorHealthBoardStats(workspace);
  const connectorHealthByTarget = new Map(
    connectorHealthBoard.map((item) => [item.targetId, item]),
  );
  const workerRuntime = workspace.workerRuntime;
  const openJobs = jobBoardStats.pending + jobBoardStats.processing + jobBoardStats.failed;
  const distributionStateStats = publishedEpisodes.reduce(
    (summary, episode) => {
      for (const item of episode.distribution) {
        if (item.state === "live") {
          summary.live += 1;
          continue;
        }

        if (item.state === "review") {
          summary.review += 1;
          continue;
        }

        if (item.state === "queued") {
          summary.queued += 1;
          continue;
        }

        summary.manual += 1;
      }

      return summary;
    },
    {
      live: 0,
      review: 0,
      queued: 0,
      manual: 0,
    },
  );
  const openWorkItems =
    queuedReleases.length +
    jobBoardStats.pending +
    jobBoardStats.processing +
    jobBoardStats.failed;
  const setupDebt =
    connectorBoardStats.setup +
    storageStatus.missing.length +
    workerStatus.missing.length +
    platformEntryStatus.missing.length +
    persistenceStatus.issues.length;
  const systemChecks = [
    {
      title: "Metadata store",
      state: persistenceStatus.configured ? "ready" : "failed",
      detail: persistenceStatus.configured
        ? persistenceStatus.mode === "sanity"
          ? "Tenantmetadata schrijft terug naar Sanity."
          : "Lokale file store is actief voor development of fallback."
        : persistenceStatus.issues[0] ??
          "Metadata-opslag heeft nog een blocker.",
      meta:
        persistenceStatus.mode === "sanity"
          ? "sanity persistence"
          : "file persistence",
    },
    {
      title: "Media storage",
      state: storageStatus.configured ? "ready" : "setup",
      detail: storageStatus.configured
        ? "Signed uploads en derived assets landen direct in de object store."
        : storageStatus.missing[0] ??
          "Object storage mist nog configuratie.",
      meta: storageStatus.bucket ?? "bucket not configured",
    },
    {
      title: "Distribution worker",
      state: !workerStatus.configured
        ? "setup"
        : workerRuntime.lastState === "failed"
          ? "failed"
          : workerRuntime.lastState === "partial"
            ? "review"
            : "ready",
      detail: !workerStatus.configured
        ? workerStatus.missing[0] ??
          "Worker mist nog secret of schedulerconfiguratie."
        : workerRuntime.lastRunCompletedAt
          ? `${formatWorkerTriggerLabel(workerRuntime.lastTrigger)} eindigde ${formatDutchDate(
              workerRuntime.lastRunCompletedAt,
            )} met ${workerRuntime.lastCompletedJobs} succesvolle job(s) en ${workerRuntime.lastFailedJobs} fout(en).`
          : `Worker kan batches draaien via ${workerStatus.routePath}, maar heeft nog geen tenant-run gelogd.`,
      meta: workerRuntime.lastTrigger
        ? `${formatWorkerTriggerLabel(workerRuntime.lastTrigger)} · batch ${workerStatus.batchSize}`
        : `batch ${workerStatus.batchSize}`,
    },
    {
      title: "Platform handoff",
      state: platformEntryStatus.configured ? "ready" : "setup",
      detail: platformEntryStatus.configured
        ? "Studio kan platform-entry tokens en sessies valideren."
        : platformEntryStatus.missing[0] ??
          "Handoff-secret ontbreekt voor platform-auth.",
      meta: platformEntryStatus.configured
        ? "shared handoff enabled"
        : "shared handoff missing",
    },
    {
      title: "Feed publish",
      state:
        publishedEpisodes.length > 0
          ? "live"
          : queuedReleases.length > 0
            ? "review"
            : "setup",
      detail:
        publishedEpisodes.length > 0
          ? `${publishedEpisodes.length} episodes publiceren nu via ${show.feedPath}.`
          : queuedReleases.length > 0
            ? `${queuedReleases.length} queued release(s) wachten op feed publish.`
            : "Feedroute staat klaar, maar er is nog geen gepubliceerde episode.",
      meta: show.feedPath,
    },
    {
      title: "Connector coverage",
      state:
        connectorHealthStats.blocked > 0
          ? "setup"
          : connectorHealthStats.active > 0
            ? "review"
            : connectorHealthStats.healthy > 0
              ? "ready"
              : connectorBoardStats.setup === 0
                ? "ready"
                : "setup",
      detail:
        connectorHealthStats.blocked > 0
          ? `${connectorHealthStats.blocked} connectoren hebben nog setup- of runtime-blockers.`
          : connectorHealthStats.active > 0
            ? `${connectorHealthStats.active} connectoren hebben open jobs of retries.`
            : connectorHealthStats.healthy > 0
              ? `${connectorHealthStats.healthy} connectoren hebben gezonde runtime-signalen.`
              : "Connectorroutes staan klaar, maar hebben nog geen runtime-signaal.",
      meta: `${connectorHealthStats.healthy} healthy · ${connectorHealthStats.active} active · ${connectorHealthStats.attention} attention`,
    },
  ];
  const readyCheckCount = systemChecks.filter(
    (item) => item.state === "ready" || item.state === "live",
  ).length;
  const currentSignals = [
    openWorkItems > 0
      ? `${openWorkItems} open items staan nog in queued releases of het jobboard.`
      : "Geen open queue- of jobbacklog in deze workspace.",
    workerRuntime.lastRunCompletedAt
      ? `${formatWorkerTriggerLabel(workerRuntime.lastTrigger)} draaide ${formatDutchDate(
          workerRuntime.lastRunCompletedAt,
        )} en eindigde ${workerRuntime.lastState} met ${workerRuntime.lastCompletedJobs} completed en ${workerRuntime.lastFailedJobs} failed job(s).`
      : workerStatus.configured
        ? "Worker is geconfigureerd, maar deze tenant heeft nog geen geregistreerde run."
        : "Worker mist nog configuratie voor runtime-signalen.",
    connectorHealthStats.blocked > 0
      ? `${connectorHealthStats.blocked} connectoren zitten geblokkeerd op setup of een recente failure.`
      : connectorHealthStats.active > 0
        ? `${connectorHealthStats.active} connectoren draaien met open jobs of retries.`
        : connectorHealthStats.healthy > 0
          ? `${connectorHealthStats.healthy} connectoren hebben nu gezonde runtime-signalen.`
          : "Connectorroutes zijn ready, maar nog zonder runtime-activiteit.",
    distributionStateStats.manual > 0
      ? `${distributionStateStats.manual} distributiestatussen staan nog op manual.`
      : "Geen manual distributiestatussen op gepubliceerde episodes.",
  ];

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

      <section className="grid gap-6 py-10 xl:grid-cols-[1.08fr_0.92fr]">
        <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-6 shadow-[0_20px_80px_rgba(2,10,24,0.2)]">
          <p className="font-mono text-xs uppercase tracking-[0.32em] text-accent-soft">
            Operations overview
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-foreground">
            Je ziet nu direct welke schakels van storage tot publish echt klaar zijn.
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-foreground/68">
            Deze samenvatting trekt de echte readiness van metadata store, object
            storage, worker, handoff en feed publicatie naar boven in de
            dashboardlaag. Daardoor hoef je niet meer per sectie uit te zoeken
            waar de keten nog stokt.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <OverviewMetric
              label="Checks ready"
              value={`${readyCheckCount}/${systemChecks.length}`}
              detail="kernschakels operationeel"
            />
            <OverviewMetric
              label="Healthy routes"
              value={String(connectorHealthStats.healthy)}
              detail={`${connectorHealthStats.active} active · ${connectorHealthStats.blocked} blocked`}
            />
            <OverviewMetric
              label="Open work"
              value={String(openWorkItems)}
              detail="queued releases plus open jobs"
            />
            <OverviewMetric
              label="Setup debt"
              value={String(setupDebt)}
              detail="open configuratie-items"
            />
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-black/18 p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-sky-glow">
              Current signals
            </p>
            <div className="mt-4 grid gap-3">
              {currentSignals.map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm leading-6 text-foreground/70"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="rounded-[2rem] border border-white/10 bg-white/5 p-6">
          <p className="font-mono text-xs uppercase tracking-[0.32em] text-sky-glow">
            Pipeline map
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-foreground">
            Elke backendlaag heeft nu een zichtbare statuskaart.
          </h2>
          <div className="mt-6 grid gap-3">
            {systemChecks.map((item) => (
              <OperationalCheck
                key={item.title}
                title={item.title}
                state={item.state}
                detail={item.detail}
                meta={item.meta}
              />
            ))}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "live",
                value: distributionStateStats.live,
              },
              {
                label: "review",
                value: distributionStateStats.review,
              },
              {
                label: "queued",
                value: distributionStateStats.queued,
              },
              {
                label: "manual",
                value: distributionStateStats.manual,
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-3xl border border-white/10 bg-black/18 p-4"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-foreground/55">
                  {item.label}
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-foreground">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-6 pb-10 lg:grid-cols-[0.92fr_1.08fr]">
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
                  De distribution worker gebruikt dezelfde connectorlogica als
                  de studio. Je kunt hem via een externe scheduler aanroepen en
                  daarnaast nog steeds handmatig een batch voor deze tenant
                  starten.
                </p>
              </div>

              <StatusPill
                state={workerStatus.configured ? "ready" : "setup"}
                label={workerStatus.configured ? "automation ready" : "setup required"}
              />
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
                  Worker trigger
                </p>
                <p className="mt-3 text-sm leading-6 text-foreground/72">
                  {workerStatus.schedule} · batch {workerStatus.batchSize}
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-black/18 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-accent-soft">
                  Last run state
                </p>
                <div className="mt-3">
                  <StatusPill
                    state={!workerStatus.configured ? "setup" : workerRuntime.lastState}
                    label={
                      !workerStatus.configured
                        ? "setup"
                        : workerRuntime.lastRunCompletedAt
                          ? workerRuntime.lastState
                          : "idle"
                    }
                  />
                </div>
                <p className="mt-3 text-sm leading-6 text-foreground/72">
                  {workerRuntime.lastRunCompletedAt
                    ? `${workerRuntime.lastCompletedJobs} completed · ${workerRuntime.lastFailedJobs} failed`
                    : "Nog geen runtimegeschiedenis voor deze tenant."}
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-black/18 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-accent-soft">
                  Last completed
                </p>
                <p className="mt-3 text-sm leading-6 text-foreground/72">
                  {workerRuntime.lastRunCompletedAt
                    ? formatDutchDate(workerRuntime.lastRunCompletedAt)
                    : "Nog geen worker-run"}
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.22em] text-foreground/45">
                  {formatWorkerTriggerLabel(workerRuntime.lastTrigger)}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-[1.75rem] border border-white/10 bg-black/18 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-glow">
                    Worker runtime
                  </p>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/64">
                    Laatste tenant-runs worden nu in de store opgeslagen, zodat je
                    hier direct ziet of de scheduler, batch-run of job-run nog
                    echt gezond loopt.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-semibold text-foreground/76">
                    success{" "}
                    {workerRuntime.lastSuccessfulRunAt
                      ? formatDutchDate(workerRuntime.lastSuccessfulRunAt)
                      : "nog niet"}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-semibold text-foreground/76">
                    failure{" "}
                    {workerRuntime.lastFailedRunAt
                      ? formatDutchDate(workerRuntime.lastFailedRunAt)
                      : "geen"}
                  </span>
                </div>
              </div>

              {workerRuntime.recentRuns.length > 0 ? (
                <div className="mt-4 grid gap-3">
                  {workerRuntime.recentRuns.slice(0, 4).map((run) => (
                    <div
                      key={run.id}
                      className="rounded-2xl border border-white/10 bg-white/4 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-accent-soft">
                            {formatWorkerTriggerLabel(run.trigger)}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-foreground/72">
                            {run.note}
                          </p>
                        </div>
                        <StatusPill state={run.state} label={run.state} />
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.22em] text-foreground/45">
                        <span>start {formatDutchDate(run.startedAt)}</span>
                        <span>
                          einde{" "}
                          {run.completedAt
                            ? formatDutchDate(run.completedAt)
                            : "nog bezig"}
                        </span>
                        <span>
                          jobs {run.processedJobs} · ok {run.completedJobs} · fail{" "}
                          {run.failedJobs}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm leading-6 text-foreground/64">
                  Nog geen runtimehistorie opgeslagen voor deze tenant. De eerste
                  scheduler- of batch-run verschijnt hier automatisch.
                </p>
              )}
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
                externe workertrigger.
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
              { label: "healthy", value: connectorHealthStats.healthy },
              { label: "active", value: connectorHealthStats.active },
              { label: "attention", value: connectorHealthStats.attention },
              { label: "blocked", value: connectorHealthStats.blocked },
              { label: "idle", value: connectorHealthStats.idle },
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
            const connectorHealth = connectorHealthByTarget.get(connector.targetId);

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
                    {connectorHealth ? (
                      <StatusPill
                        state={connectorHealth.state}
                        label={connectorHealth.state}
                      />
                    ) : null}
                    <StatusPill state={connector.readiness} label={connector.readiness} />
                    <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/70">
                      {connector.mode}
                    </span>
                  </div>
                </div>

                {connectorHealth ? (
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-[1.75rem] border border-white/10 bg-black/18 p-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-glow">
                        Runtime health
                      </p>
                      <p className="mt-3 text-sm leading-6 text-foreground/72">
                        {connectorHealth.detail}
                      </p>
                      <p className="mt-3 text-xs uppercase tracking-[0.22em] text-foreground/45">
                        {connectorHealth.lastActivityAt
                          ? `laatste activiteit ${formatDutchDate(
                              connectorHealth.lastActivityAt,
                            )}`
                          : "nog geen runtime-activiteit"}
                      </p>
                      <p className="mt-2 text-xs uppercase tracking-[0.22em] text-foreground/45">
                        succes{" "}
                        {connectorHealth.lastSuccessAt
                          ? formatDutchDate(connectorHealth.lastSuccessAt)
                          : "nog niet"}
                        {" · "}failure{" "}
                        {connectorHealth.lastFailureAt
                          ? formatDutchDate(connectorHealth.lastFailureAt)
                          : "geen"}
                      </p>
                    </div>

                    <div className="rounded-[1.75rem] border border-white/10 bg-black/18 p-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-glow">
                        Runtime signals
                      </p>
                      <p className="mt-3 text-sm leading-6 text-foreground/72">
                        open jobs{" "}
                        {connectorHealth.pendingJobs +
                          connectorHealth.processingJobs +
                          connectorHealth.failedJobs}
                        {" · "}retries {connectorHealth.scheduledRetryJobs}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-foreground/72">
                        live {connectorHealth.liveCount}
                        {" · "}review {connectorHealth.reviewCount}
                        {" · "}queued {connectorHealth.queuedCount}
                        {" · "}manual {connectorHealth.manualCount}
                      </p>
                    </div>
                  </div>
                ) : null}

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
                          connector.targetId === "youtube" || connector.targetId === "shorts"
                            ? "optionele playlist id"
                            : connector.targetId === "reels"
                              ? "optionele reel dashboard url"
                              : connector.targetId === "tiktok"
                                ? "optionele creator dashboard url"
                                : connector.targetId === "clips"
                                  ? "vertical-9x16 pack"
                            : "feed.xml ingest of directory route"
                        }
                        className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/35"
                      />
                    </label>
                  </div>

                  {connector.targetId === "youtube" || connector.targetId === "shorts" ? (
                    <div className="rounded-[1.75rem] border border-white/10 bg-black/18 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-glow">
                            YouTube tenant API config
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

                  {connector.targetId === "reels" ? (
                    <div className="rounded-[1.75rem] border border-white/10 bg-black/18 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-glow">
                            Instagram tenant API config
                          </p>
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/64">
                            Gebruik een tenant access token en het Instagram user id
                            van het gekoppelde business-account voor Reels exports.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-semibold text-foreground/76">
                            token {connector.instagramConfig?.accessToken ? "saved" : "missing"}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-semibold text-foreground/76">
                            user id {connector.instagramConfig?.igUserId ? "saved" : "missing"}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="space-y-2 text-sm text-foreground/68 sm:col-span-2">
                          <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                            Access token
                          </span>
                          <input
                            name="instagramAccessToken"
                            type="password"
                            defaultValue=""
                            placeholder={
                              connector.instagramConfig?.accessToken
                                ? "Opgeslagen waarde blijft behouden"
                                : "Tenant access token"
                            }
                            className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/35"
                          />
                        </label>

                        <label className="space-y-2 text-sm text-foreground/68">
                          <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                            Instagram User ID
                          </span>
                          <input
                            name="instagramIgUserId"
                            type="text"
                            defaultValue=""
                            placeholder={
                              connector.instagramConfig?.igUserId
                                ? "Opgeslagen waarde blijft behouden"
                                : "1784..."
                            }
                            className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/35"
                          />
                        </label>

                        <label className="space-y-2 text-sm text-foreground/68">
                          <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                            API version
                          </span>
                          <input
                            name="instagramApiVersion"
                            type="text"
                            defaultValue={connector.instagramConfig?.apiVersion ?? "v23.0"}
                            placeholder="v23.0"
                            className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/35"
                          />
                        </label>
                      </div>

                      <label className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/4 px-4 py-2 text-xs font-semibold text-foreground/76">
                        <input
                          type="checkbox"
                          name="instagramShareToFeed"
                          defaultChecked={connector.instagramConfig?.shareToFeed ?? true}
                          className="h-4 w-4 accent-[var(--sky-glow)]"
                        />
                        <span>Share naar Instagram feed</span>
                      </label>
                    </div>
                  ) : null}

                  {connector.targetId === "tiktok" ? (
                    <div className="rounded-[1.75rem] border border-white/10 bg-black/18 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-glow">
                            TikTok tenant API config
                          </p>
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/64">
                            Gebruik een tenant access token en kies of clips direct
                            worden gepost of eerst in de inbox van de creator landen.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-semibold text-foreground/76">
                            token {connector.tiktokConfig?.accessToken ? "saved" : "missing"}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-semibold text-foreground/76">
                            mode {connector.tiktokConfig?.postMode ?? "direct"}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="space-y-2 text-sm text-foreground/68 sm:col-span-2">
                          <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                            Access token
                          </span>
                          <input
                            name="tiktokAccessToken"
                            type="password"
                            defaultValue=""
                            placeholder={
                              connector.tiktokConfig?.accessToken
                                ? "Opgeslagen waarde blijft behouden"
                                : "Tenant access token"
                            }
                            className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/35"
                          />
                        </label>

                        <label className="space-y-2 text-sm text-foreground/68">
                          <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                            Post mode
                          </span>
                          <select
                            name="tiktokPostMode"
                            defaultValue={connector.tiktokConfig?.postMode ?? "direct"}
                            className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none"
                          >
                            <option value="direct">direct</option>
                            <option value="inbox">inbox</option>
                          </select>
                        </label>

                        <label className="space-y-2 text-sm text-foreground/68">
                          <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                            Privacy level
                          </span>
                          <input
                            name="tiktokPrivacyLevel"
                            type="text"
                            defaultValue={connector.tiktokConfig?.privacyLevel ?? "SELF_ONLY"}
                            placeholder="SELF_ONLY"
                            className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/35"
                          />
                        </label>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-3">
                        <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/4 px-4 py-2 text-xs font-semibold text-foreground/76">
                          <input
                            type="checkbox"
                            name="tiktokDisableComment"
                            defaultChecked={connector.tiktokConfig?.disableComment ?? false}
                            className="h-4 w-4 accent-[var(--sky-glow)]"
                          />
                          <span>Disable comments</span>
                        </label>
                        <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/4 px-4 py-2 text-xs font-semibold text-foreground/76">
                          <input
                            type="checkbox"
                            name="tiktokDisableDuet"
                            defaultChecked={connector.tiktokConfig?.disableDuet ?? false}
                            className="h-4 w-4 accent-[var(--sky-glow)]"
                          />
                          <span>Disable duet</span>
                        </label>
                        <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/4 px-4 py-2 text-xs font-semibold text-foreground/76">
                          <input
                            type="checkbox"
                            name="tiktokDisableStitch"
                            defaultChecked={connector.tiktokConfig?.disableStitch ?? false}
                            className="h-4 w-4 accent-[var(--sky-glow)]"
                          />
                          <span>Disable stitch</span>
                        </label>
                      </div>
                    </div>
                  ) : null}

                  {connector.targetId === "clips" ? (
                    <div className="rounded-[1.75rem] border border-white/10 bg-black/18 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-glow">
                            Render defaults
                          </p>
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/64">
                            Stel hier de standaard template en brand-label in voor
                            de vertical clip renders. Per clip kun je nog een eigen
                            template kiezen.
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="space-y-2 text-sm text-foreground/68">
                          <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                            Default template
                          </span>
                          <select
                            name="clipDefaultTemplateId"
                            defaultValue={connector.clipRenderConfig?.defaultTemplateId ?? "clean"}
                            className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none"
                          >
                            {clipRenderTemplates.map((template) => (
                              <option key={template.id} value={template.id}>
                                {template.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-2 text-sm text-foreground/68">
                          <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                            Brand label
                          </span>
                          <input
                            name="clipBrandLabel"
                            type="text"
                            defaultValue={connector.clipRenderConfig?.brandLabel ?? ""}
                            placeholder="IvariumLabs Cast"
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
                  {episode.clipPlans.length > 0 ? (
                    <div className="mt-5 rounded-3xl border border-white/10 bg-black/18 p-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-glow">
                        Clip segments
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {episode.clipPlans.map((plan) => (
                          <span
                            key={`${episode.id}-${plan.id}`}
                            className="rounded-full border border-white/10 bg-white/4 px-3 py-1 text-xs font-semibold text-foreground/76"
                          >
                            {plan.title} · {plan.startTime}-{plan.endTime} ·{" "}
                            {formatClipTemplateLabel(plan.templateId)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {episode.renderedClips.length > 0 ? (
                    <div className="mt-5 rounded-3xl border border-white/10 bg-black/18 p-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-glow">
                        Rendered clips
                      </p>
                      <div className="mt-3 grid gap-3">
                        {episode.renderedClips.map((clip) => (
                          <div
                            key={clip.id}
                            className="rounded-2xl border border-white/8 bg-white/4 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-foreground">
                                  {clip.title}
                                </p>
                                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-foreground/45">
                                  {clip.startTime}-{clip.endTime} · {clip.durationSeconds}s ·{" "}
                                  {formatClipTemplateLabel(clip.templateId)}
                                </p>
                              </div>
                              <a
                                href={clip.assetPath}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center rounded-full border border-white/10 bg-black/18 px-3 py-1 text-xs font-semibold text-foreground/76 transition-colors hover:bg-white/10"
                              >
                                Open clip
                              </a>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {clip.platforms.map((platform) => (
                                <span
                                  key={`${clip.id}-${platform}`}
                                  className="rounded-full border border-white/10 bg-black/18 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/60"
                                >
                                  {platform}
                                </span>
                              ))}
                            </div>
                            {clip.exports.length > 0 ? (
                              <div className="mt-4 grid gap-2">
                                {clip.exports.map((item) => {
                                  const target = getTargets([item.platform])[0];

                                  return (
                                    <div
                                      key={`${clip.id}-${item.platform}`}
                                      className="rounded-2xl border border-white/8 bg-black/18 p-3"
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground/64">
                                          {target?.label ?? item.platform}
                                        </p>
                                        <StatusPill state={item.state} label={item.state} />
                                      </div>
                                      <p className="mt-2 text-xs leading-5 text-foreground/58">
                                        {item.note}
                                      </p>
                                      {item.externalUrl ? (
                                        <a
                                          href={item.externalUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="mt-3 inline-flex items-center rounded-full border border-white/10 bg-white/4 px-3 py-1 text-xs font-semibold text-foreground/76 transition-colors hover:bg-white/10"
                                        >
                                          Open export
                                        </a>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
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
