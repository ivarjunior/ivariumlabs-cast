import "server-only";

import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { slugify } from "@/lib/cast";

export type UploadKind = "audio" | "video" | "artwork";

export type StoredUpload = {
  sourceName: string;
  publicPath: string;
  byteLength: number;
  contentType: string;
};

export type ObjectStorageStatus = {
  configured: boolean;
  bucket: string | null;
  publicBaseUrl: string | null;
  endpoint: string | null;
  region: string;
  missing: string[];
  signedUploadExpiresIn: number;
};

type ObjectStorageConfig = {
  bucket: string;
  publicBaseUrl: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type SignedUpload = StoredUpload & {
  kind: UploadKind;
  objectKey: string;
  uploadUrl: string;
  expiresIn: number;
  headers: Record<string, string>;
};

const objectStorageEnv = {
  accountId: ["OBJECT_STORAGE_ACCOUNT_ID", "R2_ACCOUNT_ID"],
  endpoint: ["OBJECT_STORAGE_ENDPOINT", "R2_ENDPOINT"],
  accessKeyId: ["OBJECT_STORAGE_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID"],
  secretAccessKey: [
    "OBJECT_STORAGE_SECRET_ACCESS_KEY",
    "R2_SECRET_ACCESS_KEY",
  ],
  bucket: ["OBJECT_STORAGE_BUCKET", "R2_BUCKET_NAME"],
  publicBaseUrl: ["OBJECT_STORAGE_PUBLIC_BASE_URL", "R2_PUBLIC_BASE_URL"],
  region: ["OBJECT_STORAGE_REGION", "R2_REGION"],
  signedUrlExpiresIn: [
    "OBJECT_STORAGE_SIGNED_URL_EXPIRES_IN",
    "R2_SIGNED_URL_EXPIRES_IN",
  ],
} as const;

const missingEnvLabels = {
  endpoint: "OBJECT_STORAGE_ENDPOINT of OBJECT_STORAGE_ACCOUNT_ID",
  accessKeyId: "OBJECT_STORAGE_ACCESS_KEY_ID",
  secretAccessKey: "OBJECT_STORAGE_SECRET_ACCESS_KEY",
  bucket: "OBJECT_STORAGE_BUCKET",
  publicBaseUrl: "OBJECT_STORAGE_PUBLIC_BASE_URL",
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

function normalizeUrl(value: string | null) {
  return value ? value.replace(/\/+$/, "") : null;
}

function readEnvNumber(keys: readonly string[]) {
  const value = readEnvValue(keys);

  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return parsed;
}

function clampSignedUploadExpiry(value: number | null) {
  if (value === null) {
    return 900;
  }

  return Math.min(Math.max(value, 60), 604_800);
}

function buildEndpoint() {
  const explicitEndpoint = normalizeUrl(readEnvValue(objectStorageEnv.endpoint));

  if (explicitEndpoint) {
    return explicitEndpoint;
  }

  const accountId = readEnvValue(objectStorageEnv.accountId);

  if (!accountId) {
    return null;
  }

  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function resolveObjectStorageConfig(): {
  config: ObjectStorageConfig | null;
  status: ObjectStorageStatus;
} {
  const bucket = readEnvValue(objectStorageEnv.bucket);
  const publicBaseUrl = normalizeUrl(readEnvValue(objectStorageEnv.publicBaseUrl));
  const endpoint = buildEndpoint();
  const accessKeyId = readEnvValue(objectStorageEnv.accessKeyId);
  const secretAccessKey = readEnvValue(objectStorageEnv.secretAccessKey);
  const region = readEnvValue(objectStorageEnv.region) ?? "auto";
  const signedUploadExpiresIn = clampSignedUploadExpiry(
    readEnvNumber(objectStorageEnv.signedUrlExpiresIn),
  );
  const missing: string[] = [];

  if (!endpoint) {
    missing.push(missingEnvLabels.endpoint);
  }

  if (!accessKeyId) {
    missing.push(missingEnvLabels.accessKeyId);
  }

  if (!secretAccessKey) {
    missing.push(missingEnvLabels.secretAccessKey);
  }

  if (!bucket) {
    missing.push(missingEnvLabels.bucket);
  }

  if (!publicBaseUrl) {
    missing.push(missingEnvLabels.publicBaseUrl);
  }

  const status: ObjectStorageStatus = {
    configured: missing.length === 0,
    bucket,
    publicBaseUrl,
    endpoint,
    region,
    missing,
    signedUploadExpiresIn,
  };

  if (missing.length > 0 || !bucket || !publicBaseUrl || !endpoint || !accessKeyId || !secretAccessKey) {
    return {
      config: null,
      status,
    };
  }

  return {
    config: {
      bucket,
      publicBaseUrl,
      endpoint,
      region,
      accessKeyId,
      secretAccessKey,
    },
    status,
  };
}

let cachedClientKey = "";
let cachedClient: S3Client | null = null;

function getObjectStorageClient(config: ObjectStorageConfig) {
  const clientKey = `${config.endpoint}:${config.bucket}:${config.accessKeyId}`;

  if (cachedClient && cachedClientKey === clientKey) {
    return cachedClient;
  }

  cachedClient = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedClientKey = clientKey;

  return cachedClient;
}

function normalizeExtension(fileName: string, kind: UploadKind) {
  const detected = path.extname(fileName).toLowerCase();

  if (detected) {
    return detected;
  }

  if (kind === "audio") {
    return ".mp3";
  }

  if (kind === "video") {
    return ".mp4";
  }

  return ".png";
}

function getDefaultContentType(kind: UploadKind, extension: string) {
  if (kind === "audio") {
    if (extension === ".wav") {
      return "audio/wav";
    }

    if (extension === ".m4a") {
      return "audio/mp4";
    }

    return "audio/mpeg";
  }

  if (kind === "video") {
    if (extension === ".mov") {
      return "video/quicktime";
    }

    return "video/mp4";
  }

  if (extension === ".svg") {
    return "image/svg+xml";
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  return "image/png";
}

function buildObjectKey(kind: UploadKind, slug: string, fileName: string) {
  const extension = normalizeExtension(fileName, kind);
  const safeSlug = slugify(slug) || "release";
  const baseName =
    slugify(path.basename(fileName, path.extname(fileName))) || kind;
  const storedFileName = `${Date.now()}-${safeSlug}-${baseName}${extension}`;

  return {
    extension,
    key: `casts/${kind}/${safeSlug}/${storedFileName}`,
  };
}

function buildPublicUrl(publicBaseUrl: string, objectKey: string) {
  return `${publicBaseUrl}/${objectKey}`;
}

function buildDerivedObjectKey(args: {
  tenantSlug: string;
  slug: string;
  folder: string;
  fileName: string;
}) {
  const safeTenantSlug = slugify(args.tenantSlug) || "workspace";
  const safeSlug = slugify(args.slug) || "release";
  const safeFolder = slugify(args.folder) || "derived";
  const extension = path.extname(args.fileName).toLowerCase();
  const baseName =
    slugify(path.basename(args.fileName, extension || undefined)) || "asset";
  const resolvedExtension = extension || ".bin";
  const storedFileName = `${Date.now()}-${safeSlug}-${baseName}${resolvedExtension}`;

  return `casts/${safeTenantSlug}/${safeFolder}/${safeSlug}/${storedFileName}`;
}

export class ObjectStorageConfigurationError extends Error {
  readonly missing: string[];

  constructor(status: ObjectStorageStatus) {
    super(`Object storage mist configuratie: ${status.missing.join(", ")}`);
    this.name = "ObjectStorageConfigurationError";
    this.missing = status.missing;
  }
}

export function getObjectStorageStatus(): ObjectStorageStatus {
  return resolveObjectStorageConfig().status;
}

export function getSignedUploadExpirySeconds() {
  return resolveObjectStorageConfig().status.signedUploadExpiresIn;
}

function buildStoredUpload(
  kind: UploadKind,
  tenantSlug: string,
  slug: string,
  fileName: string,
  byteLength: number,
  contentType: string | null | undefined,
) {
  const { extension, key: baseKey } = buildObjectKey(kind, slug, fileName);
  const namespacedTenantSlug = slugify(tenantSlug) || "workspace";
  const resolvedContentType = contentType || getDefaultContentType(kind, extension);

  return {
    extension,
    key: `casts/${namespacedTenantSlug}/${baseKey.replace(/^casts\//, "")}`,
    storedUpload: {
      sourceName: fileName,
      publicPath: "",
      byteLength,
      contentType: resolvedContentType,
    },
  };
}

export async function persistUpload(
  file: File | null,
  kind: UploadKind,
  tenantSlug: string,
  slug: string,
): Promise<StoredUpload | null> {
  if (!(file instanceof File) || file.size === 0) {
    return null;
  }

  const { config, status } = resolveObjectStorageConfig();

  if (!config) {
    throw new ObjectStorageConfigurationError(status);
  }

  const { key, storedUpload } = buildStoredUpload(
    kind,
    tenantSlug,
    slug,
    file.name,
    file.size,
    file.type,
  );
  const client = getObjectStorageClient(config);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: Buffer.from(await file.arrayBuffer()),
      ContentType: storedUpload.contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return {
    sourceName: storedUpload.sourceName,
    publicPath: buildPublicUrl(config.publicBaseUrl, key),
    byteLength: storedUpload.byteLength,
    contentType: storedUpload.contentType,
  };
}

export async function createSignedUpload(args: {
  kind: UploadKind;
  tenantSlug: string;
  slug: string;
  fileName: string;
  byteLength: number;
  contentType?: string | null;
}): Promise<SignedUpload> {
  const { kind, tenantSlug, slug, fileName, byteLength, contentType } = args;
  const { config, status } = resolveObjectStorageConfig();

  if (!config) {
    throw new ObjectStorageConfigurationError(status);
  }

  const { key, storedUpload } = buildStoredUpload(
    kind,
    tenantSlug,
    slug,
    fileName,
    byteLength,
    contentType,
  );
  const client = getObjectStorageClient(config);
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: storedUpload.contentType,
  });
  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: status.signedUploadExpiresIn,
  });

  return {
    ...storedUpload,
    kind,
    objectKey: key,
    publicPath: buildPublicUrl(config.publicBaseUrl, key),
    uploadUrl,
    expiresIn: status.signedUploadExpiresIn,
    headers: {
      "Content-Type": storedUpload.contentType,
    },
  };
}

export async function persistDerivedAsset(args: {
  tenantSlug: string;
  slug: string;
  folder: string;
  fileName: string;
  body: Buffer | Uint8Array | string;
  contentType: string;
  cacheControl?: string;
}): Promise<StoredUpload> {
  const { config, status } = resolveObjectStorageConfig();

  if (!config) {
    throw new ObjectStorageConfigurationError(status);
  }

  const key = buildDerivedObjectKey({
    tenantSlug: args.tenantSlug,
    slug: args.slug,
    folder: args.folder,
    fileName: args.fileName,
  });
  const client = getObjectStorageClient(config);
  const buffer =
    typeof args.body === "string"
      ? Buffer.from(args.body)
      : Buffer.isBuffer(args.body)
        ? args.body
        : Buffer.from(args.body);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: args.contentType,
      CacheControl: args.cacheControl ?? "public, max-age=31536000, immutable",
    }),
  );

  return {
    sourceName: args.fileName,
    publicPath: buildPublicUrl(config.publicBaseUrl, key),
    byteLength: buffer.byteLength,
    contentType: args.contentType,
  };
}
