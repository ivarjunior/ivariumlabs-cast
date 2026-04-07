# ivariumlabs-cast

Private Next.js studio for cast releases, distribution jobs, and tenant workspaces.

## Getting Started

Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Distribution worker

This project does not use Vercel Cron on Hobby. Instead, trigger the worker with an external scheduler against the production deployment.

### Recommended: GitHub Actions scheduler

This repository now includes a scheduled workflow in `.github/workflows/distribution-worker.yml`.

Setup:

1. Push the repository to GitHub on the default branch.
2. In GitHub, open `Settings -> Secrets and variables -> Actions`.
3. Add repository secret `CAST_DISTRIBUTION_WORKER_URL` with your production endpoint, for example:

```text
https://your-domain.com/api/distribution/cron
```

4. Add repository secret `CAST_DISTRIBUTION_WORKER_SECRET` with the same value as your app environment variable.
5. In GitHub, open `Actions -> Distribution worker` and enable the workflow if needed.

The workflow runs every 10 minutes, offset from the top of the hour, and also supports manual runs through `workflow_dispatch`.

Endpoint:

```text
POST /api/distribution/cron
```

Authentication:

```text
Authorization: Bearer <CAST_DISTRIBUTION_WORKER_SECRET>
```

Notes:

- `CAST_DISTRIBUTION_WORKER_SECRET` is the preferred secret.
- `CRON_SECRET` is still accepted as a legacy fallback.
- `GET` also works if your scheduler cannot send `POST`.
- Optional query params:
  - `batch=8`
  - `tenantSlug=demo-company`

Example:

```bash
curl -X POST "https://your-domain.com/api/distribution/cron?batch=8" \
  -H "Authorization: Bearer $CAST_DISTRIBUTION_WORKER_SECRET"
```

The worker processes pending distribution jobs in batches and returns a JSON summary of the run.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

Deploy the app on Vercel as a normal Next.js project. No Vercel cron configuration is required on Hobby when you use an external scheduler for `/api/distribution/cron`.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
