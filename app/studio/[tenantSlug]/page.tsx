import { notFound } from "next/navigation";
import {
  hasTenantAccess,
  isTenantAccessCodeFallbackEnabled,
} from "@/lib/cast-access";
import { getTenantWorkspace } from "@/lib/cast-store";
import { getDistributionWorkerStatus } from "@/lib/distribution-worker";
import { getObjectStorageStatus } from "@/lib/object-storage";
import { StudioShell } from "../page";
import { unlockTenantStudio } from "../actions";

type TenantStudioPageProps = {
  params: Promise<{
    tenantSlug: string;
  }>;
  searchParams: Promise<{
    access?: string;
  }>;
};

export async function generateMetadata({ params }: TenantStudioPageProps) {
  const { tenantSlug } = await params;
  const workspace = await getTenantWorkspace(tenantSlug);

  if (!workspace) {
    return {
      title: "Studio | IvariumLabs Cast",
      description: "Tenantstudio niet gevonden.",
    };
  }

  return {
    title: `${workspace.tenant.companyName} Studio | IvariumLabs Cast`,
    description: `Private caststudio voor ${workspace.tenant.companyName}.`,
  };
}

export default async function TenantStudioPage({
  params,
  searchParams,
}: TenantStudioPageProps) {
  const { tenantSlug } = await params;
  const { access } = await searchParams;
  const workspace = await getTenantWorkspace(tenantSlug);

  if (!workspace) {
    notFound();
  }

  const accessCodeFallbackEnabled = isTenantAccessCodeFallbackEnabled();

  if (!(await hasTenantAccess(workspace.tenant))) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-6 py-12 sm:px-10">
        <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(17,28,44,0.9),rgba(11,19,33,0.82))] p-8 shadow-[0_20px_100px_rgba(0,0,0,0.26)]">
          <p className="font-mono text-xs uppercase tracking-[0.32em] text-accent-soft">
            Tenant access
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-[0.96] tracking-[-0.06em] text-foreground sm:text-5xl">
            {workspace.tenant.companyName} caststudio
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-foreground/70 sm:text-lg">
            {accessCodeFallbackEnabled
              ? "Deze studio is tenant-afgeschermd. Voer de company access code in om releases, feeds en distributiejobs van deze workspace te openen."
              : "Deze studio gebruikt nu platform-auth. Open hem vanuit de hoofdapp zodat een geldige company-sessie wordt doorgegeven aan de castomgeving."}
          </p>

          {accessCodeFallbackEnabled ? (
            <form action={unlockTenantStudio} className="mt-8 space-y-4">
              <input type="hidden" name="tenantSlug" value={workspace.tenant.slug} />
              <label className="block space-y-2 text-sm text-foreground/68">
                <span className="font-semibold uppercase tracking-[0.18em] text-foreground/70">
                  Access code
                </span>
                <input
                  name="accessCode"
                  type="password"
                  required
                  placeholder="Company code"
                  className="w-full rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/35"
                />
              </label>

              {access === "invalid" ? (
                <div className="rounded-2xl border border-[#ffb4a6]/20 bg-[#ffb4a6]/8 px-4 py-3 text-sm leading-6 text-[#ffd2c7]">
                  De ingevoerde access code klopt niet voor deze tenant.
                </div>
              ) : null}

              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-full border border-accent/50 bg-accent px-5 py-3 text-sm font-semibold text-background transition-transform duration-200 hover:-translate-y-0.5"
              >
                Open studio
              </button>
            </form>
          ) : (
            <div className="mt-8 space-y-4">
              {access === "platform" ? (
                <div className="rounded-2xl border border-[#ffb4a6]/20 bg-[#ffb4a6]/8 px-4 py-3 text-sm leading-6 text-[#ffd2c7]">
                  Directe access-code unlock is uitgeschakeld in deze omgeving. Gebruik de casting-ingang vanuit de hoofdapp.
                </div>
              ) : null}
              <div className="rounded-2xl border border-white/10 bg-black/18 px-4 py-4 text-sm leading-6 text-foreground/68">
                Platform-auth koppelt de studio aan de ingelogde company-sessie. Daardoor blijven tenantrechten, uploads en distributiejobs aan hetzelfde bedrijf gebonden.
              </div>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <StudioShell
      workspace={workspace}
      storageStatus={getObjectStorageStatus()}
      workerStatus={getDistributionWorkerStatus()}
    />
  );
}
