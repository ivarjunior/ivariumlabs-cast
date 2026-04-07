import "server-only";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { CastTenantProfile, CastWorkspace } from "@/lib/cast";
import { getTenantWorkspace } from "@/lib/cast-store";
import {
  createCastPlatformSessionToken,
  getCastPlatformSessionMaxAgeSeconds,
  type CastPlatformSessionPayload,
  verifyCastPlatformSessionToken,
} from "@/lib/platform-entry";

export class CastTenantAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CastTenantAccessError";
  }
}

export function getTenantAccessCookieName(tenantSlug: string) {
  return `cast_tenant_access_${tenantSlug}`;
}

export function getCastPlatformSessionCookieName() {
  return "cast_platform_session";
}

function buildTenantAccessCookie(tenant: CastTenantProfile) {
  return {
    name: getTenantAccessCookieName(tenant.slug),
    value: tenant.accessCode,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

function buildPlatformSessionCookie(session: Omit<CastPlatformSessionPayload, "iat" | "exp">) {
  return {
    name: getCastPlatformSessionCookieName(),
    value: createCastPlatformSessionToken(session),
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getCastPlatformSessionMaxAgeSeconds(),
  };
}

export function isTenantAccessCodeFallbackEnabled() {
  const explicit = process.env.CAST_ALLOW_ACCESS_CODE_FALLBACK?.trim().toLowerCase();

  if (explicit === "true") {
    return true;
  }

  if (explicit === "false") {
    return false;
  }

  return process.env.NODE_ENV !== "production" && !process.env.VERCEL;
}

export async function getCastPlatformSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(getCastPlatformSessionCookieName())?.value ?? "";

  return token ? verifyCastPlatformSessionToken(token) : null;
}

function sessionMatchesTenant(
  session: CastPlatformSessionPayload | null,
  tenant: CastTenantProfile,
) {
  if (!session) {
    return false;
  }

  if (session.tenantSlug !== tenant.slug) {
    return false;
  }

  if (tenant.companyId && session.companyId !== tenant.companyId) {
    return false;
  }

  return true;
}

export async function hasTenantAccess(tenant: CastTenantProfile) {
  const platformSession = await getCastPlatformSession();

  if (sessionMatchesTenant(platformSession, tenant)) {
    return true;
  }

  if (!isTenantAccessCodeFallbackEnabled()) {
    return false;
  }

  const cookieStore = await cookies();

  return cookieStore.get(getTenantAccessCookieName(tenant.slug))?.value === tenant.accessCode;
}

export async function grantTenantAccess(tenant: CastTenantProfile) {
  const cookieStore = await cookies();

  cookieStore.set(buildTenantAccessCookie(tenant));
}

export function grantTenantAccessOnResponse(
  response: NextResponse,
  tenant: CastTenantProfile,
) {
  response.cookies.set(buildTenantAccessCookie(tenant));
}

export function grantCastPlatformSessionOnResponse(
  response: NextResponse,
  session: Omit<CastPlatformSessionPayload, "iat" | "exp">,
) {
  response.cookies.set(buildPlatformSessionCookie(session));
}

export async function revokeTenantAccess(tenantSlug: string) {
  const cookieStore = await cookies();
  cookieStore.delete(getTenantAccessCookieName(tenantSlug));
  cookieStore.delete(getCastPlatformSessionCookieName());
}

export async function requireTenantWorkspaceAccess(
  tenantSlug: string,
): Promise<CastWorkspace> {
  const workspace = await getTenantWorkspace(tenantSlug);

  if (!workspace) {
    throw new CastTenantAccessError("Tenantworkspace bestaat niet.");
  }

  if (!(await hasTenantAccess(workspace.tenant))) {
    throw new CastTenantAccessError("Geen toegang tot deze castworkspace.");
  }

  return workspace;
}
