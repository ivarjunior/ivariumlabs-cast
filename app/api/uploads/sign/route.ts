import { NextResponse } from "next/server";
import { CastTenantAccessError, requireTenantWorkspaceAccess } from "@/lib/cast-access";
import { slugify } from "@/lib/cast";
import {
  assertCastStoreWriteReady,
  CastStorePersistenceError,
} from "@/lib/cast-store";
import {
  ObjectStorageConfigurationError,
  createSignedUpload,
  type UploadKind,
} from "@/lib/object-storage";

export const runtime = "nodejs";

type SignUploadRequest = {
  tenantSlug?: string;
  title?: string;
  slug?: string;
  files?: Array<{
    kind?: string;
    fileName?: string;
    byteLength?: number;
    contentType?: string | null;
  }>;
};

const allowedUploadKinds = new Set<UploadKind>(["audio", "video", "artwork"]);

function isUploadKind(value: string): value is UploadKind {
  return allowedUploadKinds.has(value as UploadKind);
}

export async function POST(request: Request) {
  let payload: SignUploadRequest;

  try {
    payload = (await request.json()) as SignUploadRequest;
  } catch {
    return NextResponse.json(
      {
        status: "error",
        message: "De upload-aanvraag kon niet worden gelezen.",
        issues: ["Stuur geldige JSON mee voor de sign-aanvraag."],
      },
      { status: 400 },
    );
  }

  const slug =
    slugify(typeof payload.slug === "string" ? payload.slug : "") ||
    slugify(typeof payload.title === "string" ? payload.title : "") ||
    "release";
  const tenantSlug =
    typeof payload.tenantSlug === "string" ? payload.tenantSlug.trim() : "";
  const files = Array.isArray(payload.files) ? payload.files : [];
  const issues: string[] = [];

  if (!tenantSlug) {
    issues.push("Tenantslug ontbreekt voor deze upload-aanvraag.");
  }

  if (files.length === 0) {
    issues.push("Er zijn geen bestanden opgegeven voor directe upload.");
  }

  if (files.length > 3) {
    issues.push("Vraag maximaal drie signed uploads tegelijk aan.");
  }

  for (const file of files) {
    if (!file || typeof file.fileName !== "string" || !file.fileName.trim()) {
      issues.push("Elk bestand heeft een bestandsnaam nodig.");
    }

    if (!file || typeof file.kind !== "string" || !isUploadKind(file.kind)) {
      issues.push("Een of meer uploadsoorten zijn ongeldig.");
    }

    if (
      !file ||
      typeof file.byteLength !== "number" ||
      !Number.isFinite(file.byteLength) ||
      file.byteLength <= 0
    ) {
      issues.push("Elk bestand moet een geldige bestandsgrootte hebben.");
    }
  }

  if (issues.length > 0) {
    return NextResponse.json(
      {
        status: "error",
        message: "De upload-aanvraag is nog niet compleet.",
        issues,
      },
      { status: 400 },
    );
  }

  try {
    await requireTenantWorkspaceAccess(tenantSlug);
    assertCastStoreWriteReady();

    const uploads = await Promise.all(
      files.map((file) =>
        createSignedUpload({
          kind: file.kind as UploadKind,
          tenantSlug,
          slug,
          fileName: file.fileName as string,
          byteLength: file.byteLength as number,
          contentType: file.contentType ?? null,
        }),
      ),
    );

    return NextResponse.json({
      status: "success",
      uploads,
    });
  } catch (error) {
    if (error instanceof CastTenantAccessError) {
      return NextResponse.json(
        {
          status: "error",
          message: "Geen toegang tot deze castworkspace.",
          issues: [error.message],
        },
        { status: 403 },
      );
    }

    if (error instanceof ObjectStorageConfigurationError) {
      return NextResponse.json(
        {
          status: "error",
          message: "Object storage is nog niet volledig geconfigureerd.",
          issues: error.missing.map((item) => `Ontbreekt: ${item}`),
        },
        { status: 503 },
      );
    }

    if (error instanceof CastStorePersistenceError) {
      return NextResponse.json(
        {
          status: "error",
          message: "De castmetadata-opslag is niet klaar voor deze omgeving.",
          issues: error.issues,
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        status: "error",
        message: "Signed uploads konden niet worden voorbereid.",
        issues: ["Controleer de storage-configuratie en probeer opnieuw."],
      },
      { status: 500 },
    );
  }
}
