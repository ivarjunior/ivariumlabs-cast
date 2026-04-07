import { NextResponse } from "next/server";
import {
  grantCastPlatformSessionOnResponse,
  grantTenantAccessOnResponse,
} from "@/lib/cast-access";
import { getTenantWorkspaceByCompanyId, upsertTenantWorkspace } from "@/lib/cast-store";
import {
  getCastPlatformEntryStatus,
  verifyCastPlatformEntryToken,
} from "@/lib/platform-entry";

export const runtime = "nodejs";

function redirectToStudio(request: Request, platform: string) {
  const url = new URL("/studio", request.url);
  url.searchParams.set("platform", platform);

  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const entryStatus = getCastPlatformEntryStatus();

  if (!entryStatus.configured) {
    return redirectToStudio(request, "config");
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token")?.trim() || "";
  const payload = verifyCastPlatformEntryToken(token);

  if (!payload) {
    return redirectToStudio(request, "invalid");
  }

  const existingWorkspace = await getTenantWorkspaceByCompanyId(payload.companyId);
  const workspace = await upsertTenantWorkspace({
    tenant: {
      slug: payload.tenantSlug,
      companyId: payload.companyId,
      companyName: payload.companyName,
      studioLabel: `${payload.companyName} Cast`,
    },
    ...(existingWorkspace
      ? {}
      : {
          show: {
            title: `${payload.companyName} Cast`,
            author: payload.companyName,
            ownerName: payload.companyName,
          },
        }),
  });

  const response = NextResponse.redirect(
    new URL(`/studio/${workspace.tenant.slug}`, request.url),
  );
  grantCastPlatformSessionOnResponse(response, {
    companyId: payload.companyId,
    companyName: payload.companyName,
    tenantSlug: workspace.tenant.slug,
    userId: payload.userId,
  });
  grantTenantAccessOnResponse(response, workspace.tenant);

  return response;
}
