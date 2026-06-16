import "server-only";

import {
  appendDistributionJobHistory,
  createDistributionJobHistoryEntry,
  finalizeDistributionWorkerRuntime,
  getConnector,
  getDistributionJobNextRetryAt,
  isDistributionJobRetryDue,
  type CastWorkspace,
  type DistributionJob,
  type DistributionWorkerTrigger,
} from "@/lib/cast";
import { getTenantWorkspace, listCastTenants, saveTenantWorkspace } from "@/lib/cast-store";
import { executeDistributionConnector } from "@/lib/distribution-connectors";

export type DistributionWorkerStatus = {
  configured: boolean;
  batchSize: number;
  routePath: string;
  schedule: string;
  missing: string[];
};

export type DistributionJobRunResult =
  | {
      status: "processed";
      tenantSlug: string;
      jobId: string;
      targetId: string;
      episodeId: string;
      jobStatus: "pending" | "processing" | "completed" | "failed";
      note: string;
      externalUrl: string | null;
      externalId: string | null;
      workspace: CastWorkspace;
    }
  | {
      status: "missing-workspace" | "missing-job";
      tenantSlug: string;
      jobId: string;
      note: string;
    };

export type DistributionBatchResult = {
  processed: number;
  completed: number;
  failed: number;
  tenantsTouched: string[];
  jobs: Array<{
    tenantSlug: string;
    jobId: string;
    targetId: string;
    episodeId: string;
    jobStatus: "pending" | "processing" | "completed" | "failed";
    note: string;
    externalUrl: string | null;
    externalId: string | null;
  }>;
};

const defaultBatchSize = 4;
const maxBatchSize = 25;

function clampBatchSize(value: number) {
  if (!Number.isFinite(value)) {
    return defaultBatchSize;
  }

  return Math.min(Math.max(Math.trunc(value), 1), maxBatchSize);
}

export function getDistributionWorkerSecret() {
  const secret =
    process.env.CAST_DISTRIBUTION_WORKER_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";

  return secret || null;
}

export function getDistributionWorkerBatchSize(input?: number | null) {
  if (typeof input === "number") {
    return clampBatchSize(input);
  }

  const envValue = Number.parseInt(
    process.env.CAST_DISTRIBUTION_BATCH_SIZE ?? "",
    10,
  );

  return clampBatchSize(envValue);
}

export function getDistributionWorkerStatus(): DistributionWorkerStatus {
  const missing: string[] = [];

  if (!getDistributionWorkerSecret()) {
    missing.push("CRON_SECRET of CAST_DISTRIBUTION_WORKER_SECRET");
  }

  return {
    configured: missing.length === 0,
    batchSize: getDistributionWorkerBatchSize(),
    routePath: "/api/distribution/cron",
    schedule: "external scheduler",
    missing,
  };
}

function createFailedConnectorResult(note: string) {
  return {
    jobStatus: "failed" as const,
    distributionState: "manual" as const,
    note,
    externalUrl: null,
    externalId: null,
    renderedClips: [] as NonNullable<
      Awaited<ReturnType<typeof executeDistributionConnector>>["renderedClips"]
    >,
  };
}

function getJobRunAt(job: DistributionJob) {
  return job.status === "failed" ? job.nextRetryAt ?? job.updatedAt : job.createdAt;
}

function sortRunnableJobs(jobs: DistributionJob[], now: string) {
  return [...jobs]
    .filter(
      (job) => job.status === "pending" || isDistributionJobRetryDue(job, now),
    )
    .sort((left, right) => getJobRunAt(left).localeCompare(getJobRunAt(right)));
}

function buildWorkerRunNote(args: {
  trigger: DistributionWorkerTrigger;
  processedJobs: number;
  completedJobs: number;
  failedJobs: number;
}) {
  const triggerLabel =
    args.trigger === "manual-job"
      ? "Handmatige job-run"
      : args.trigger === "manual-batch"
        ? "Handmatige batch-run"
        : "Scheduler-run";

  if (args.processedJobs === 0) {
    return `${triggerLabel} vond geen runnable jobs in deze tenant.`;
  }

  if (args.failedJobs > 0 && args.completedJobs > 0) {
    return `${triggerLabel} verwerkte ${args.processedJobs} jobs: ${args.completedJobs} succesvol en ${args.failedJobs} gefaald.`;
  }

  if (args.failedJobs > 0) {
    return `${triggerLabel} verwerkte ${args.processedJobs} jobs en eindigde met ${args.failedJobs} fout(en).`;
  }

  return `${triggerLabel} verwerkte ${args.processedJobs} jobs zonder fouten.`;
}

function applyWorkerRuntime(args: {
  workspace: CastWorkspace;
  trigger: DistributionWorkerTrigger;
  startedAt: string;
  completedAt: string;
  processedJobs: number;
  completedJobs: number;
  failedJobs: number;
  jobId?: string | null;
}) {
  return {
    ...args.workspace,
    workerRuntime: finalizeDistributionWorkerRuntime({
      runtime: args.workspace.workerRuntime,
      trigger: args.trigger,
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      processedJobs: args.processedJobs,
      completedJobs: args.completedJobs,
      failedJobs: args.failedJobs,
      jobId: args.jobId ?? null,
      note: buildWorkerRunNote({
        trigger: args.trigger,
        processedJobs: args.processedJobs,
        completedJobs: args.completedJobs,
        failedJobs: args.failedJobs,
      }),
    }),
  } satisfies CastWorkspace;
}

async function executeJobInWorkspace(args: {
  workspace: CastWorkspace;
  job: DistributionJob;
  origin: string | null;
}) {
  const { workspace, job, origin } = args;
  const startedAt = new Date().toISOString();
  const episode = workspace.publishedEpisodes.find(
    (item) => item.id === job.episodeId,
  );
  const result = !episode
    ? createFailedConnectorResult(
        "Connector-run kon niet starten omdat de gekoppelde episode niet meer bestaat.",
      )
    : await executeDistributionConnector({
        origin,
        store: workspace,
        job,
        episode,
        connector: getConnector(workspace.connectors, job.targetId),
      }).catch((error) =>
        createFailedConnectorResult(
          error instanceof Error
            ? error.message
            : "Connector-run is onverwacht afgebroken.",
        ),
      );
  const completedAt = new Date().toISOString();

  const nextJobs = workspace.distributionJobs.map((item) =>
    item.id === job.id
      ? (() => {
          const nextAttemptCount = (item.attemptCount ?? 0) + 1;
          const nextRetryAt =
            result.jobStatus === "failed"
              ? getDistributionJobNextRetryAt({
                  job: item,
                  nextAttemptCount,
                  failedAt: completedAt,
                })
              : null;
          const nextNote = nextRetryAt
            ? `${result.note} Automatische retry staat ingepland.`
            : result.note;
          const startedEntry = createDistributionJobHistoryEntry({
            jobId: item.id,
            at: startedAt,
            event: "started",
            note: "Connector-run is gestart.",
            fromStatus: item.status,
            toStatus: "processing",
            attemptCount: item.attemptCount ?? 0,
          });
          const completionEntry = createDistributionJobHistoryEntry({
            jobId: item.id,
            at: completedAt,
            event: result.jobStatus === "completed" ? "completed" : "failed",
            note: nextNote,
            fromStatus: "processing",
            toStatus: result.jobStatus,
            attemptCount: nextAttemptCount,
            nextRetryAt,
            externalUrl: result.externalUrl ?? null,
            externalId: result.externalId ?? null,
          });
          let nextHistory = appendDistributionJobHistory(item, startedEntry);
          nextHistory = appendDistributionJobHistory(
            {
              ...item,
              history: nextHistory,
            },
            completionEntry,
          );

          if (nextRetryAt) {
            nextHistory = appendDistributionJobHistory(
              {
                ...item,
                history: nextHistory,
              },
              createDistributionJobHistoryEntry({
                jobId: item.id,
                at: completedAt,
                event: "retry-scheduled",
                note: "Worker heeft automatisch een nieuwe poging ingepland.",
                fromStatus: result.jobStatus,
                toStatus: result.jobStatus,
                attemptCount: nextAttemptCount,
                nextRetryAt,
              }),
            );
          }

          return {
            ...item,
            status: result.jobStatus,
            updatedAt: completedAt,
            note: nextNote,
            attemptCount: nextAttemptCount,
            lastAttemptAt: completedAt,
            lastErrorAt: result.jobStatus === "failed" ? completedAt : null,
            nextRetryAt,
            externalUrl: result.externalUrl ?? null,
            externalId: result.externalId ?? null,
            history: nextHistory,
          };
        })()
      : item,
  );
  const nextEpisodes = workspace.publishedEpisodes.map((item) =>
    item.id === job.episodeId
      ? {
          ...item,
          renderedClips:
            result.renderedClips && result.renderedClips.length > 0
              ? result.renderedClips
              : item.renderedClips,
          distribution: item.distribution.map((distributionItem) =>
            distributionItem.targetId === job.targetId
              ? {
                  ...distributionItem,
                  state: result.jobStatus === "failed" && nextJobs.find((nextJob) => nextJob.id === job.id)?.nextRetryAt
                    ? "queued"
                    : result.distributionState,
                  note:
                    result.jobStatus === "failed" &&
                    nextJobs.find((nextJob) => nextJob.id === job.id)?.nextRetryAt
                      ? `${result.note} Automatische retry staat ingepland vanuit de worker.`
                      : result.note,
                  externalUrl: result.externalUrl ?? null,
                  externalId: result.externalId ?? null,
                  syncedAt: completedAt,
                }
              : distributionItem,
          ),
        }
      : item,
  );

  return {
    ...workspace,
    publishedEpisodes: nextEpisodes,
    distributionJobs: nextJobs,
  } satisfies CastWorkspace;
}

export async function runDistributionJobForTenant(args: {
  tenantSlug: string;
  jobId: string;
  origin: string | null;
  trigger?: DistributionWorkerTrigger;
}) {
  const tenantSlug = args.tenantSlug.trim();
  const jobId = args.jobId.trim();
  const trigger = args.trigger ?? "manual-job";
  const workspace = await getTenantWorkspace(tenantSlug);

  if (!workspace) {
    return {
      status: "missing-workspace",
      tenantSlug,
      jobId,
      note: "Tenantworkspace bestaat niet.",
    } satisfies DistributionJobRunResult;
  }

  const job = workspace.distributionJobs.find((item) => item.id === jobId);

  if (!job) {
    return {
      status: "missing-job",
      tenantSlug,
      jobId,
      note: "Distributiejob bestaat niet in deze workspace.",
    } satisfies DistributionJobRunResult;
  }

  const startedAt = new Date().toISOString();
  const nextWorkspace = await executeJobInWorkspace({
    workspace,
    job,
    origin: args.origin,
  });
  const completedAt = new Date().toISOString();
  const nextJob = nextWorkspace.distributionJobs.find((item) => item.id === job.id);
  const runtimeWorkspace = applyWorkerRuntime({
    workspace: nextWorkspace,
    trigger,
    startedAt,
    completedAt,
    processedJobs: 1,
    completedJobs: nextJob?.status === "completed" ? 1 : 0,
    failedJobs: nextJob?.status === "failed" ? 1 : 0,
    jobId,
  });

  await saveTenantWorkspace(runtimeWorkspace);

  return {
    status: "processed",
    tenantSlug,
    jobId,
    targetId: job.targetId,
    episodeId: job.episodeId,
    jobStatus: nextJob?.status ?? "failed",
    note: nextJob?.note ?? "Connector-run afgerond.",
    externalUrl: nextJob?.externalUrl ?? null,
    externalId: nextJob?.externalId ?? null,
    workspace: runtimeWorkspace,
  } satisfies DistributionJobRunResult;
}

export async function processPendingDistributionJobs(args: {
  limit?: number | null;
  origin: string | null;
  tenantSlug?: string | null;
  trigger?: DistributionWorkerTrigger;
}): Promise<DistributionBatchResult> {
  const limit = getDistributionWorkerBatchSize(args.limit ?? null);
  const scopedTenantSlug = args.tenantSlug?.trim() || "";
  const trigger = args.trigger ?? "scheduler";
  const targetSlugs = scopedTenantSlug
    ? [scopedTenantSlug]
    : (await listCastTenants()).map((tenant) => tenant.slug);
  const results: DistributionBatchResult = {
    processed: 0,
    completed: 0,
    failed: 0,
    tenantsTouched: [],
    jobs: [],
  };

  for (const tenantSlug of targetSlugs) {
    if (results.processed >= limit) {
      break;
    }

    let workspace = await getTenantWorkspace(tenantSlug);

    if (!workspace) {
      continue;
    }

    const tenantRunStartedAt = new Date().toISOString();
    let workspaceChanged = false;
    let tenantProcessed = 0;
    let tenantCompleted = 0;
    let tenantFailed = 0;
    const now = new Date().toISOString();

    for (const job of sortRunnableJobs(workspace.distributionJobs, now)) {
      if (results.processed >= limit) {
        break;
      }

      workspace = await executeJobInWorkspace({
        workspace,
        job,
        origin: args.origin,
      });
      workspaceChanged = true;

      const nextJob = workspace.distributionJobs.find((item) => item.id === job.id);

      tenantProcessed += 1;
      tenantCompleted += nextJob?.status === "completed" ? 1 : 0;
      tenantFailed += nextJob?.status === "failed" ? 1 : 0;
      results.processed += 1;
      results.completed += nextJob?.status === "completed" ? 1 : 0;
      results.failed += nextJob?.status === "failed" ? 1 : 0;
      results.tenantsTouched = Array.from(
        new Set([...results.tenantsTouched, tenantSlug]),
      );
      results.jobs.push({
        tenantSlug,
        jobId: job.id,
        targetId: job.targetId,
        episodeId: job.episodeId,
        jobStatus: nextJob?.status ?? "failed",
        note: nextJob?.note ?? "Connector-run afgerond.",
        externalUrl: nextJob?.externalUrl ?? null,
        externalId: nextJob?.externalId ?? null,
      });
    }

    const tenantRunCompletedAt = new Date().toISOString();
    const nextWorkspace = applyWorkerRuntime({
      workspace,
      trigger,
      startedAt: tenantRunStartedAt,
      completedAt: tenantRunCompletedAt,
      processedJobs: tenantProcessed,
      completedJobs: tenantCompleted,
      failedJobs: tenantFailed,
      jobId: null,
    });

    if (workspaceChanged || targetSlugs.length > 0) {
      await saveTenantWorkspace(nextWorkspace);
    }
  }

  return results;
}
