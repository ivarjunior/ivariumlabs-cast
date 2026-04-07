import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type CastRegistry,
  type CastStore,
  type CastTenantProfile,
  type CastWorkspace,
  type DistributionJob,
  type PlatformConnector,
  type PodcastEpisode,
  type PodcastShow,
  type QueuedRelease,
  buildCastWorkspaceDocumentId,
  buildTenantPaths,
  createCastWorkspace,
  createEmptyCastRegistry,
  createTenantProfile,
  defaultPodcastShow,
  defaultTenantSlug,
  getCastWorkspaceBySlug,
  normalizeCastRegistry,
  normalizeCastStore,
  normalizeCastWorkspace,
  slugify,
} from "@/lib/cast";
import {
  isSanityServerConfigured,
  sanityMutateServer,
  sanityQueryServer,
} from "@/lib/sanity-server";

const storePath = path.join(process.cwd(), "data", "cast-store.json");
const sanityWorkspaceProjection = `{
  _id,
  _type,
  company,
  tenant,
  show,
  publishedEpisodes,
  queuedReleases,
  distributionJobs,
  connectors,
  createdAt,
  updatedAt
}`;

type SanityReference = {
  _ref?: string;
  _type?: string;
};

type SanityCastWorkspaceDocument = {
  _id?: string;
  _type?: string;
  company?: SanityReference | null;
  tenant?: Partial<CastTenantProfile> | null;
  show?: PodcastShow | null;
  publishedEpisodes?: Array<PodcastEpisode & { _key?: string }> | null;
  queuedReleases?: Array<QueuedRelease & { _key?: string }> | null;
  distributionJobs?: Array<DistributionJob & { _key?: string }> | null;
  connectors?: Array<PlatformConnector & { _key?: string }> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type SanityMutationResult = {
  results?: Array<{ id?: string }>;
};

export type CastStorePersistenceStatus = {
  configured: boolean;
  mode: "sanity" | "file";
  issues: string[];
};

export class CastStorePersistenceError extends Error {
  readonly issues: string[];

  constructor(status: CastStorePersistenceStatus) {
    super(status.issues.join(" "));
    this.name = "CastStorePersistenceError";
    this.issues = status.issues;
  }
}

function isVercelRuntime() {
  return Boolean((process.env.VERCEL || "").trim());
}

export function getCastStorePersistenceStatus(): CastStorePersistenceStatus {
  if (isSanityServerConfigured()) {
    return {
      configured: true,
      mode: "sanity",
      issues: [],
    };
  }

  if (isVercelRuntime()) {
    return {
      configured: false,
      mode: "file",
      issues: [
        "SANITY_API_TOKEN ontbreekt op Vercel.",
        "De castmetadata kan daar niet veilig naar data/cast-store.json worden weggeschreven.",
      ],
    };
  }

  return {
    configured: true,
    mode: "file",
    issues: [],
  };
}

export function assertCastStoreWriteReady() {
  const status = getCastStorePersistenceStatus();

  if (!status.configured) {
    throw new CastStorePersistenceError(status);
  }

  return status;
}

async function ensureStoreDirectory() {
  await mkdir(path.dirname(storePath), { recursive: true });
}

function isCastRegistry(value: unknown): value is CastRegistry {
  return Boolean(
    value &&
      typeof value === "object" &&
      "tenants" in (value as Record<string, unknown>) &&
      Array.isArray((value as CastRegistry).tenants),
  );
}

function migrateLegacyStoreToRegistry(store: CastStore): CastRegistry {
  const companyName =
    store.show.title.replace(/\s+cast$/i, "") ||
    store.show.ownerName ||
    store.show.author ||
    "IvariumLabs";

  return {
    tenants: [
      createCastWorkspace({
        tenant: {
          slug: defaultTenantSlug,
          companyId: null,
          companyName,
          studioLabel: store.show.title || `${companyName} Cast`,
          accessCode: `${slugify(companyName) || defaultTenantSlug}-studio`,
        },
        store,
      }),
    ],
  };
}

function sanitizePublishedEpisode(
  episode: PodcastEpisode & { _key?: string },
): PodcastEpisode {
  const {
    _key: _ignored,
    distribution,
    clipPlans,
    renderedClips,
    ...rest
  } = episode;

  return {
    ...rest,
    distribution: Array.isArray(distribution)
      ? distribution.map((item) => {
          const { _key: _distributionKey, ...distributionRest } = item as typeof item & {
            _key?: string;
          };

          return distributionRest;
        })
      : [],
    clipPlans: Array.isArray(clipPlans)
      ? clipPlans.map((plan) => {
          const { _key: _clipPlanKey, ...clipPlanRest } = plan as typeof plan & {
            _key?: string;
          };

          return clipPlanRest;
        })
      : [],
    renderedClips: Array.isArray(renderedClips)
      ? renderedClips.map((clip) => {
          const {
            _key: _renderedClipKey,
            exports,
            ...renderedClipRest
          } = clip as typeof clip & {
            _key?: string;
            exports?: Array<{ _key?: string }>;
          };

          return {
            ...renderedClipRest,
            exports: Array.isArray(exports)
              ? exports.map((item) => {
                  const { _key: _exportKey, ...exportRest } = item as typeof item & {
                    _key?: string;
                  };

                  return exportRest;
                })
              : [],
          };
        })
      : [],
  };
}

function sanitizeQueuedRelease(
  release: QueuedRelease & { _key?: string },
): QueuedRelease {
  const { _key: _ignored, clipPlans, ...rest } = release;

  return {
    ...rest,
    clipPlans: Array.isArray(clipPlans)
      ? clipPlans.map((plan) => {
          const { _key: _clipPlanKey, ...clipPlanRest } = plan as typeof plan & {
            _key?: string;
          };

          return clipPlanRest;
        })
      : [],
  };
}

function sanitizeDistributionJob(
  job: DistributionJob & { _key?: string },
): DistributionJob {
  const { _key: _ignored, history, ...rest } = job;

  return {
    ...rest,
    history: Array.isArray(history)
      ? history.map((entry) => {
          const { _key: _historyKey, ...historyRest } = entry as typeof entry & {
            _key?: string;
          };

          return historyRest;
        })
      : [],
  };
}

function sanitizeConnector(
  connector: PlatformConnector & { _key?: string },
): PlatformConnector {
  const { _key: _ignored, ...rest } = connector;

  return rest;
}

function buildWorkspaceFromSanityDocument(
  document: SanityCastWorkspaceDocument,
): CastWorkspace {
  const resolvedSlug =
    slugify(document.tenant?.slug ?? "") ||
    document._id?.replace(/^castWorkspace\./, "") ||
    defaultTenantSlug;
  const fallbackWorkspace = createCastWorkspace({
    tenant: {
      slug: resolvedSlug,
      companyId:
        typeof document.tenant?.companyId === "string" && document.tenant.companyId.trim()
          ? document.tenant.companyId.trim()
          : document.company?._ref?.trim() || null,
      companyName: document.tenant?.companyName,
      studioLabel: document.tenant?.studioLabel ?? document.show?.title,
      accessCode: document.tenant?.accessCode,
      createdAt:
        document.tenant?.createdAt ??
        (typeof document.createdAt === "string" ? document.createdAt : undefined),
      updatedAt:
        document.tenant?.updatedAt ??
        (typeof document.updatedAt === "string" ? document.updatedAt : undefined),
    },
    store: {
      show: document.show ?? undefined,
      publishedEpisodes: Array.isArray(document.publishedEpisodes)
        ? document.publishedEpisodes.map((episode) =>
            sanitizePublishedEpisode(episode),
          )
        : [],
      queuedReleases: Array.isArray(document.queuedReleases)
        ? document.queuedReleases.map((release) => sanitizeQueuedRelease(release))
        : [],
      distributionJobs: Array.isArray(document.distributionJobs)
        ? document.distributionJobs.map((job) => sanitizeDistributionJob(job))
        : [],
      connectors: Array.isArray(document.connectors)
        ? document.connectors.map((connector) => sanitizeConnector(connector))
        : [],
    },
  });

  return normalizeCastWorkspace(fallbackWorkspace);
}

function buildSanityWorkspaceDocument(workspace: CastWorkspace) {
  const normalized = normalizeCastWorkspace(workspace);

  return {
    _id: buildCastWorkspaceDocumentId(normalized.tenant.slug),
    _type: "castWorkspace",
    company: normalized.tenant.companyId
      ? {
          _type: "reference",
          _ref: normalized.tenant.companyId,
        }
      : null,
    tenant: normalized.tenant,
    show: normalized.show,
    publishedEpisodes: normalized.publishedEpisodes.map((episode) => ({
      _key: episode.id,
      ...episode,
      clipPlans: episode.clipPlans.map((plan) => ({
        _key: plan.id,
        ...plan,
      })),
      renderedClips: episode.renderedClips.map((clip) => ({
        _key: clip.id,
        ...clip,
        exports: clip.exports.map((item, index) => ({
          _key: `${clip.id}-${item.platform}-${index}`,
          ...item,
        })),
      })),
      distribution: episode.distribution.map((item, index) => ({
        _key: `${episode.id}-${item.targetId}-${index}`,
        ...item,
      })),
    })),
    queuedReleases: normalized.queuedReleases.map((release) => ({
      _key: release.id,
      ...release,
      clipPlans: release.clipPlans.map((plan) => ({
        _key: plan.id,
        ...plan,
      })),
    })),
    distributionJobs: normalized.distributionJobs.map((job) => ({
      _key: job.id,
      ...job,
      history: job.history.map((entry) => ({
        _key: entry.id,
        ...entry,
      })),
    })),
    connectors: normalized.connectors.map((connector) => ({
      _key: connector.targetId,
      ...connector,
    })),
    createdAt: normalized.tenant.createdAt,
    updatedAt: normalized.tenant.updatedAt,
  };
}

async function readLocalRegistryIfAvailable(): Promise<CastRegistry | null> {
  await ensureStoreDirectory();

  try {
    const contents = await readFile(storePath, "utf8");
    const parsed = JSON.parse(contents) as CastRegistry | CastStore;

    if (isCastRegistry(parsed)) {
      return normalizeCastRegistry(parsed);
    }

    return normalizeCastRegistry(migrateLegacyStoreToRegistry(parsed as CastStore));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function getCastRegistryFromFile(): Promise<CastRegistry> {
  await ensureStoreDirectory();

  try {
    const contents = await readFile(storePath, "utf8");
    const parsed = JSON.parse(contents) as CastRegistry | CastStore;

    if (isCastRegistry(parsed)) {
      return normalizeCastRegistry(parsed);
    }

    const migrated = normalizeCastRegistry(migrateLegacyStoreToRegistry(parsed as CastStore));
    await saveCastRegistryToFile(migrated);

    return migrated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const fallback = createEmptyCastRegistry();
      await saveCastRegistryToFile(fallback);

      return fallback;
    }

    throw error;
  }
}

async function saveCastRegistryToFile(registry: CastRegistry) {
  const normalized = normalizeCastRegistry(registry);

  await ensureStoreDirectory();
  await writeFile(storePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

  return normalized;
}

async function queryAllSanityWorkspaceDocuments() {
  return sanityQueryServer<SanityCastWorkspaceDocument[]>(
    `*[_type == "castWorkspace"] | order(coalesce(tenant.companyName, tenant.slug) asc)${sanityWorkspaceProjection}`,
  );
}

async function querySanityWorkspaceDocumentBySlug(tenantSlug: string) {
  const normalizedSlug = slugify(tenantSlug) || defaultTenantSlug;

  return sanityQueryServer<SanityCastWorkspaceDocument | null>(
    `*[_type == "castWorkspace" && _id == ${JSON.stringify(buildCastWorkspaceDocumentId(normalizedSlug))}][0]${sanityWorkspaceProjection}`,
  );
}

async function querySanityWorkspaceDocumentByCompanyId(companyId: string) {
  const normalizedCompanyId = companyId.trim();

  if (!normalizedCompanyId) {
    return null;
  }

  return sanityQueryServer<SanityCastWorkspaceDocument | null>(
    `*[_type == "castWorkspace" && (tenant.companyId == ${JSON.stringify(normalizedCompanyId)} || company._ref == ${JSON.stringify(normalizedCompanyId)})][0]${sanityWorkspaceProjection}`,
  );
}

async function saveCastRegistryToSanity(registry: CastRegistry) {
  const normalized = normalizeCastRegistry(registry);
  const existingDocuments = await queryAllSanityWorkspaceDocuments();
  const nextDocuments = normalized.tenants.map((workspace) =>
    buildSanityWorkspaceDocument(workspace),
  );
  const nextDocumentIds = new Set(
    nextDocuments.map((document) => document._id),
  );
  const mutations: Array<Record<string, unknown>> = [
    ...nextDocuments.map((document) => ({
      createOrReplace: document,
    })),
    ...existingDocuments
      .filter(
        (document) =>
          document._id && !nextDocumentIds.has(document._id),
      )
      .map((document) => ({
        delete: {
          id: document._id,
        },
      })),
  ];

  if (mutations.length > 0) {
    await sanityMutateServer<SanityMutationResult>(mutations);
  }

  return normalized;
}

async function saveTenantWorkspaceToSanity(workspace: CastWorkspace) {
  const normalized = normalizeCastWorkspace(workspace);

  await sanityMutateServer<SanityMutationResult>([
    {
      createOrReplace: buildSanityWorkspaceDocument(normalized),
    },
  ]);

  return normalized;
}

async function bootstrapSanityRegistryFromLocalFile() {
  const localRegistry = await readLocalRegistryIfAvailable();

  if (!localRegistry) {
    return {
      tenants: [],
    } satisfies CastRegistry;
  }

  await saveCastRegistryToSanity(localRegistry);

  return localRegistry;
}

export async function getCastRegistry(): Promise<CastRegistry> {
  if (!isSanityServerConfigured()) {
    return getCastRegistryFromFile();
  }

  const documents = await queryAllSanityWorkspaceDocuments();

  if (documents.length > 0) {
    return normalizeCastRegistry({
      tenants: documents.map((document) => buildWorkspaceFromSanityDocument(document)),
    });
  }

  return bootstrapSanityRegistryFromLocalFile();
}

export async function saveCastRegistry(registry: CastRegistry) {
  if (!isSanityServerConfigured()) {
    assertCastStoreWriteReady();
    return saveCastRegistryToFile(registry);
  }

  return saveCastRegistryToSanity(registry);
}

export async function listCastTenants(): Promise<CastTenantProfile[]> {
  const registry = await getCastRegistry();

  return registry.tenants.map((workspace) => workspace.tenant);
}

export async function getTenantWorkspace(
  tenantSlug: string,
): Promise<CastWorkspace | null> {
  if (!isSanityServerConfigured()) {
    const registry = await getCastRegistryFromFile();

    return getCastWorkspaceBySlug(registry, tenantSlug) ?? null;
  }

  const document = await querySanityWorkspaceDocumentBySlug(tenantSlug);

  if (document) {
    return buildWorkspaceFromSanityDocument(document);
  }

  const documents = await queryAllSanityWorkspaceDocuments();

  if (documents.length > 0) {
    return null;
  }

  const bootstrapRegistry = await bootstrapSanityRegistryFromLocalFile();

  return getCastWorkspaceBySlug(bootstrapRegistry, tenantSlug) ?? null;
}

export async function getTenantWorkspaceByCompanyId(
  companyId: string,
): Promise<CastWorkspace | null> {
  const normalizedCompanyId = companyId.trim();

  if (!normalizedCompanyId) {
    return null;
  }

  if (!isSanityServerConfigured()) {
    const registry = await getCastRegistryFromFile();

    return (
      registry.tenants.find(
        (workspace) => workspace.tenant.companyId === normalizedCompanyId,
      ) ?? null
    );
  }

  const document = await querySanityWorkspaceDocumentByCompanyId(
    normalizedCompanyId,
  );

  if (document) {
    return buildWorkspaceFromSanityDocument(document);
  }

  const documents = await queryAllSanityWorkspaceDocuments();

  if (documents.length > 0) {
    return null;
  }

  const bootstrapRegistry = await bootstrapSanityRegistryFromLocalFile();

  return (
    bootstrapRegistry.tenants.find(
      (workspace) => workspace.tenant.companyId === normalizedCompanyId,
    ) ?? null
  );
}

export async function saveTenantWorkspace(workspace: CastWorkspace) {
  if (!isSanityServerConfigured()) {
    assertCastStoreWriteReady();
    const registry = await getCastRegistryFromFile();
    const nextWorkspace = normalizeCastWorkspace(workspace);
    const existingIndex = registry.tenants.findIndex(
      (item) => item.tenant.slug === nextWorkspace.tenant.slug,
    );
    const nextTenants = [...registry.tenants];

    if (existingIndex >= 0) {
      nextTenants[existingIndex] = nextWorkspace;
    } else {
      nextTenants.push(nextWorkspace);
    }

    const nextRegistry: CastRegistry = {
      tenants: nextTenants,
    };

    await saveCastRegistryToFile(nextRegistry);

    return nextWorkspace;
  }

  return saveTenantWorkspaceToSanity(workspace);
}

export async function upsertTenantWorkspace(args: {
  tenant: Partial<CastTenantProfile> & Pick<CastTenantProfile, "slug">;
  show?: Partial<PodcastShow>;
}) {
  const requestedSlug = slugify(args.tenant.slug) || defaultTenantSlug;
  const normalizedCompanyId =
    typeof args.tenant.companyId === "string" && args.tenant.companyId.trim()
      ? args.tenant.companyId.trim()
      : null;
  const existingWorkspaceBySlug = await getTenantWorkspace(requestedSlug);
  const existingWorkspaceByCompany = normalizedCompanyId
    ? await getTenantWorkspaceByCompanyId(normalizedCompanyId)
    : null;
  const slugBelongsToCompany =
    Boolean(existingWorkspaceBySlug) &&
    (!normalizedCompanyId ||
      !existingWorkspaceBySlug?.tenant.companyId ||
      existingWorkspaceBySlug.tenant.companyId === normalizedCompanyId);
  const fallbackRequestedSlug =
    normalizedCompanyId &&
    existingWorkspaceBySlug &&
    !slugBelongsToCompany &&
    !existingWorkspaceByCompany
      ? `${requestedSlug}-${normalizedCompanyId
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "")}`
      : requestedSlug;
  const existingWorkspace =
    existingWorkspaceByCompany ??
    (slugBelongsToCompany ? existingWorkspaceBySlug : null);
  const timestamp = new Date().toISOString();
  const tenant = createTenantProfile({
    ...existingWorkspace?.tenant,
    ...args.tenant,
    slug: existingWorkspace?.tenant.slug ?? fallbackRequestedSlug,
    companyId: normalizedCompanyId ?? existingWorkspace?.tenant.companyId ?? null,
    createdAt: existingWorkspace?.tenant.createdAt ?? args.tenant.createdAt ?? timestamp,
    updatedAt: timestamp,
  });
  const paths = buildTenantPaths(tenant.slug);
  const baseWorkspace =
    existingWorkspace ??
    createCastWorkspace({
      tenant,
      store: {
        show: {
          ...defaultPodcastShow,
          title: tenant.studioLabel,
          author: tenant.companyName,
          ownerName: tenant.companyName,
          ownerEmail: defaultPodcastShow.ownerEmail,
          ...paths,
        },
      },
    });

  const nextWorkspace = normalizeCastWorkspace({
    ...baseWorkspace,
    tenant,
    show: {
      ...baseWorkspace.show,
      ...args.show,
      ...paths,
    },
  });

  await saveTenantWorkspace(nextWorkspace);

  return nextWorkspace;
}

export async function getCastStore(): Promise<CastStore> {
  const workspace = await getTenantWorkspace(defaultTenantSlug);

  return normalizeCastStore(
    workspace ?? createCastWorkspace({ tenant: { slug: defaultTenantSlug } }),
  );
}

export async function saveCastStore(store: CastStore) {
  const existingWorkspace =
    (await getTenantWorkspace(defaultTenantSlug)) ??
    createCastWorkspace({ tenant: { slug: defaultTenantSlug } });
  const nextWorkspace: CastWorkspace = {
    ...existingWorkspace,
    ...normalizeCastStore(store),
  };

  await saveTenantWorkspace(nextWorkspace);

  return normalizeCastStore(nextWorkspace);
}
