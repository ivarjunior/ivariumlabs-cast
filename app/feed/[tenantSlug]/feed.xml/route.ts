import { buildPodcastFeedXml } from "@/lib/cast";
import { getTenantWorkspace } from "@/lib/cast-store";

type TenantFeedRouteProps = {
  params: Promise<{
    tenantSlug: string;
  }>;
};

export async function GET(request: Request, { params }: TenantFeedRouteProps) {
  const { tenantSlug } = await params;
  const origin = new URL(request.url).origin;
  const workspace = await getTenantWorkspace(tenantSlug);

  if (!workspace) {
    return new Response("Tenant feed not found.", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const xml = buildPodcastFeedXml(origin, workspace);

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
