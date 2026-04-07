import { NextResponse } from "next/server";
import {
  getDistributionWorkerBatchSize,
  getDistributionWorkerSecret,
  getDistributionWorkerStatus,
  processPendingDistributionJobs,
} from "@/lib/distribution-worker";

export const runtime = "nodejs";

function getRequestSecret(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";

  if (authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return new URL(request.url).searchParams.get("secret")?.trim() ?? "";
}

async function runDistributionCron(request: Request) {
  const workerSecret = getDistributionWorkerSecret();

  if (!workerSecret) {
    return NextResponse.json(
      {
        status: "error",
        message: "Distribution worker secret ontbreekt.",
        worker: getDistributionWorkerStatus(),
      },
      { status: 503 },
    );
  }

  if (getRequestSecret(request) !== workerSecret) {
    return NextResponse.json(
      {
        status: "error",
        message: "Niet geautoriseerd voor de distribution worker.",
      },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const batchInput = Number.parseInt(url.searchParams.get("batch") ?? "", 10);
  const tenantSlug = url.searchParams.get("tenantSlug")?.trim() ?? "";
  const result = await processPendingDistributionJobs({
    origin: url.origin,
    limit: Number.isFinite(batchInput) ? batchInput : null,
    tenantSlug: tenantSlug || null,
  });

  return NextResponse.json({
    status: "success",
    worker: {
      ...getDistributionWorkerStatus(),
      batchSize: getDistributionWorkerBatchSize(
        Number.isFinite(batchInput) ? batchInput : null,
      ),
    },
    result,
  });
}

export async function GET(request: Request) {
  return runDistributionCron(request);
}

export async function POST(request: Request) {
  return runDistributionCron(request);
}
