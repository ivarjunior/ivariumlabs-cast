import "server-only";

import { createHmac } from "crypto";
import { slugify } from "@/lib/cast";

export type CastPlatformEntryPayload = {
  companyId: string;
  companyName: string;
  tenantSlug: string;
  userId: string;
  iat: number;
  exp: number;
};

export type CastPlatformSessionPayload = {
  companyId: string;
  companyName: string;
  tenantSlug: string;
  userId: string;
  iat: number;
  exp: number;
};

const defaultPlatformSessionMaxAgeSeconds = 60 * 60 * 8;

function toBase64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));

  return Buffer.from(normalized + padding, "base64");
}

function getCastPlatformEntrySecret() {
  const secret =
    process.env.CAST_PLATFORM_ENTRY_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    "";

  return secret || null;
}

export function getCastPlatformEntryStatus() {
  const secret = getCastPlatformEntrySecret();

  return {
    configured: Boolean(secret),
    missing: secret ? [] : ["CAST_PLATFORM_ENTRY_SECRET"],
  };
}

function signPayload(payloadEncoded: string, secret: string) {
  return toBase64Url(createHmac("sha256", secret).update(payloadEncoded).digest());
}

function verifySignedPayloadToken<T>(token: string, parser: (payload: unknown) => T | null): T | null {
  const secret = getCastPlatformEntrySecret();

  if (!secret) {
    return null;
  }

  try {
    const [payloadEncoded, signature] = token.split(".");

    if (!payloadEncoded || !signature) {
      return null;
    }

    const expectedSignature = signPayload(payloadEncoded, secret);

    if (signature !== expectedSignature) {
      return null;
    }

    const payload = JSON.parse(fromBase64Url(payloadEncoded).toString("utf8"));

    return parser(payload);
  } catch {
    return null;
  }
}

function parsePlatformPayload(
  payload: unknown,
): CastPlatformEntryPayload | CastPlatformSessionPayload | null {
  const source = payload as Partial<CastPlatformEntryPayload>;
  const companyId = typeof source.companyId === "string" ? source.companyId.trim() : "";
  const companyName =
    typeof source.companyName === "string" ? source.companyName.trim() : "";
  const tenantSlug = slugify(
    typeof source.tenantSlug === "string" ? source.tenantSlug : "",
  );
  const userId = typeof source.userId === "string" ? source.userId.trim() : "";

  if (
    !companyId ||
    !companyName ||
    !tenantSlug ||
    !userId ||
    typeof source.iat !== "number" ||
    typeof source.exp !== "number"
  ) {
    return null;
  }

  if (source.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return {
    companyId,
    companyName,
    tenantSlug,
    userId,
    iat: source.iat,
    exp: source.exp,
  };
}

function clampPlatformSessionMaxAge(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return defaultPlatformSessionMaxAgeSeconds;
  }

  return Math.min(Math.max(Math.trunc(parsed), 60), 60 * 60 * 24 * 7);
}

export function getCastPlatformSessionMaxAgeSeconds() {
  return clampPlatformSessionMaxAge(process.env.CAST_PLATFORM_SESSION_MAX_AGE);
}

export function createCastPlatformSessionToken(
  input: Omit<CastPlatformSessionPayload, "iat" | "exp">,
  maxAgeSeconds: number = getCastPlatformSessionMaxAgeSeconds(),
) {
  const secret = getCastPlatformEntrySecret();

  if (!secret) {
    throw new Error(
      "Missing CAST_PLATFORM_ENTRY_SECRET environment variable for cast platform session.",
    );
  }

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + maxAgeSeconds;
  const payload: CastPlatformSessionPayload = {
    ...input,
    iat,
    exp,
  };
  const payloadEncoded = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadEncoded, secret);

  return `${payloadEncoded}.${signature}`;
}

export function verifyCastPlatformEntryToken(token: string): CastPlatformEntryPayload | null {
  return verifySignedPayloadToken(token, (payload) => parsePlatformPayload(payload));
}

export function verifyCastPlatformSessionToken(
  token: string,
): CastPlatformSessionPayload | null {
  return verifySignedPayloadToken(token, (payload) => parsePlatformPayload(payload));
}
