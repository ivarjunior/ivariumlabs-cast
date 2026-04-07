import "server-only";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { CastTenantProfile, CastWorkspace } from "@/lib/cast";
import { getTenantWorkspace } from "@/lib/cast-store";

export class CastTenantAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CastTenantAccessError";
  }
}

export function getTenantAccessCookieName(tenantSlug: string) {
  return `cast_tenant_access_${tenantSlug}`;
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

export async function hasTenantAccess(tenant: CastTenantProfile) {
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

export async function revokeTenantAccess(tenantSlug: string) {
  const cookieStore = await cookies();
  cookieStore.delete(getTenantAccessCookieName(tenantSlug));
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
