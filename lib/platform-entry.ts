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

export function verifyCastPlatformEntryToken(token: string): CastPlatformEntryPayload | null {
  const secret = getCastPlatformEntrySecret();

  if (!secret) {
    return null;
  }

  try {
    const [payloadEncoded, signature] = token.split(".");

    if (!payloadEncoded || !signature) {
      return null;
    }

    const expectedSignature = toBase64Url(
      createHmac("sha256", secret).update(payloadEncoded).digest(),
    );

    if (signature !== expectedSignature) {
      return null;
    }

    const payload = JSON.parse(
      fromBase64Url(payloadEncoded).toString("utf8"),
    ) as Partial<CastPlatformEntryPayload>;
    const companyId =
      typeof payload.companyId === "string" ? payload.companyId.trim() : "";
    const companyName =
      typeof payload.companyName === "string" ? payload.companyName.trim() : "";
    const tenantSlug = slugify(
      typeof payload.tenantSlug === "string" ? payload.tenantSlug : "",
    );
    const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";

    if (
      !companyId ||
      !companyName ||
      !tenantSlug ||
      !userId ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }

    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      companyId,
      companyName,
      tenantSlug,
      userId,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}
