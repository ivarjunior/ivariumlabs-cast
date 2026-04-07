import Link from "next/link";

const surfaces = [
  {
    eyebrow: "Workspace",
    title: "Publishing studio",
    description:
      "Interne omgeving voor releases, media-opslag, feed-publicatie en distributiejobs.",
    href: "/studio",
    cta: "Open studio",
  },
  {
    eyebrow: "Surface policy",
    title: "Geen publieke podcastweergave op root",
    description:
      "Podcastdata, feedstatus en episodekaarten staan niet meer op `/`, maar alleen in de aparte studio-route.",
    href: "/studio",
    cta: "Ga naar workspace",
  },
] as const;

export const metadata = {
  title: "IvariumLabs",
  description: "Interne ingang voor IvariumLabs tooling.",
};

export default function Home() {
  return (
    <main className="relative isolate overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-[-12rem] top-[-8rem] h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,_rgba(247,148,29,0.24),_transparent_68%)] blur-3xl" />
        <div className="absolute right-[-8rem] top-[2rem] h-[20rem] w-[20rem] rounded-full bg-[radial-gradient(circle,_rgba(105,171,255,0.16),_transparent_70%)] blur-3xl" />
        <div className="absolute bottom-[-12rem] left-[22%] h-[22rem] w-[22rem] rounded-full bg-[radial-gradient(circle,_rgba(87,227,197,0.14),_transparent_72%)] blur-3xl" />
      </div>

      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 sm:px-10 lg:px-12">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <p className="font-mono text-xs uppercase tracking-[0.32em] text-accent-soft">
              IvariumLabs
            </p>
            <h1 className="max-w-4xl text-5xl font-semibold leading-[0.96] tracking-[-0.06em] text-foreground sm:text-6xl lg:text-7xl">
              Interne workspace, niet de publieke contentlaag.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-foreground/70 sm:text-lg">
              De rootroute toont nu alleen een neutrale ingang. Operationele
              content en publicatiebeheer leven in aparte werkruimtes.
            </p>
          </div>

          <Link
            href="/studio"
            className="inline-flex items-center rounded-full border border-accent/50 bg-accent px-5 py-3 text-sm font-semibold text-background transition-transform duration-200 hover:-translate-y-0.5"
          >
            Open interne studio
          </Link>
        </header>

        <section className="grid flex-1 gap-6 py-14 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            {surfaces.map((surface) => (
              <article
                key={surface.title}
                className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6 shadow-[0_20px_80px_rgba(3,9,20,0.18)]"
              >
                <p className="font-mono text-xs uppercase tracking-[0.32em] text-accent-soft">
                  {surface.eyebrow}
                </p>
                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-foreground">
                  {surface.title}
                </h2>
                <p className="mt-4 max-w-2xl text-base leading-7 text-foreground/68">
                  {surface.description}
                </p>
                <Link
                  href={surface.href}
                  className="mt-6 inline-flex items-center rounded-full border border-white/14 bg-white/6 px-4 py-2 text-sm font-semibold text-foreground transition-colors duration-200 hover:bg-white/10"
                >
                  {surface.cta}
                </Link>
              </article>
            ))}
          </div>

          <aside className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(17,28,44,0.88),rgba(11,19,33,0.82))] p-6 shadow-[0_20px_100px_rgba(0,0,0,0.26)]">
            <p className="font-mono text-xs uppercase tracking-[0.32em] text-sky-glow">
              Access pattern
            </p>
            <div className="mt-5 space-y-4">
              {[
                "Root blijft generiek en toont geen episode-, feed- of showgegevens.",
                "Studio bevat releasebeheer, assetopslag en distributiejobs.",
                "Feed-output blijft op een aparte route voor platformgebruik.",
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-3xl border border-white/10 bg-black/18 p-4 text-sm leading-6 text-foreground/70"
                >
                  {item}
                </div>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
