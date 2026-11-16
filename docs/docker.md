# Running with Docker

The repo ships a multi-stage `Dockerfile` (Next.js standalone output,
runs as a non-root user) and a `docker-compose.yml` with a single
`app` service. Supabase is external — point the app at your hosted
(or self-hosted) Supabase project via env vars; no database container
is included.

## Quick start

1. Copy the env template and fill it in:

   ```bash
   cp .env.local.example .env.local
   ```

2. Build and start (the `--env-file` flag is required — Compose only
   reads `.env` by default for `${VAR}` substitution, and this project
   keeps its config in `.env.local`):

   ```bash
   docker compose --env-file .env.local up --build -d
   ```

3. The app is served on [http://localhost:3000](http://localhost:3000)
   (publish it elsewhere with `HOST_PORT=8080` in `.env.local`).

> Use `HOST_PORT`, not `PORT`, to move the published port. `PORT` is
> what the server listens on _inside_ the container, and `env_file`
> would inject it there — leaving the app on a port the mapping and
> the healthcheck don't target. Compose pins it to 3000 for that
> reason.

## Build-time vs runtime variables

- `NEXT_PUBLIC_*` variables are **inlined into the client bundle at
  build time**. They are passed as Docker build args by
  `docker-compose.yml`. If you change any of them, rebuild:
  `docker compose --env-file .env.local up --build -d`.
- Everything else (`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`,
  `META_APP_SECRET`, `MEDIA_LOCAL_DIR`, `MEDIA_PUBLIC_BASE_URL`, …)
  is read at **runtime** from `.env.local` via `env_file` and is never
  baked into the image — safe to change with just a container restart.

## Media files on the VPS

New uploads (chat, flows, avatars, logos, notification sounds, inbound
WAHA copies) are written to disk, not Supabase Storage. Existing
database URLs are left as they are.

The app does not serve the bytes itself. nginx on the same host already
publishes `https://media.joshuavazquez.com` from `/var/www/media`. A
file at `/data/media/{bucket}/{path}` inside the CRM container is
`https://media.joshuavazquez.com/crm/{bucket}/{path}`.

### Coolify volume

On the wacrm application, add one persistent storage mount:

| Host path            | Container path | Mode       |
| -------------------- | -------------- | ---------- |
| `/var/www/media/crm` | `/data/media`  | read-write |

Then set these environment variables on the same application and redeploy:

```
MEDIA_LOCAL_DIR=/data/media
MEDIA_PUBLIC_BASE_URL=https://media.joshuavazquez.com/crm
```

Before the first deploy that uses the mount, on the VPS:

```bash
sudo mkdir -p /var/www/media/crm
sudo chown 100:101 /var/www/media/crm
sudo chmod 775 /var/www/media/crm
```

`100:101` is the `nextjs` user in the image. New files are written mode
`644` so nginx can read them. Do not add an upload API to the media
nginx; it only serves the files it already has on disk.

`/api/media/upload` fails on purpose when either variable is unset.

## Plain Docker (no Compose)

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t wacrm .

docker run -d --env-file .env.local -e PORT=3000 -p 3000:3000 wacrm
```

## Notes

- Database migrations under `supabase/` are **not** run by the
  container — apply them with the Supabase CLI as described in the
  README.
- Nothing inside the container is scheduled. If you use automation
  Wait steps or flows, point an external scheduler at
  `GET /api/automations/cron` and `GET /api/flows/cron` on this
  deployment, sending the shared secret in the `x-cron-secret` header
  (`AUTOMATION_CRON_SECRET`, see `.env.local.example`). Both return
  503 until that variable is set.
