# NPN Onboarding

ACA Agent onboarding portal with digital Producer Agreement, Intake, W-9 (e-sign or upload), and downloadable documents.

## Local Development

- Requirements: Node 18+
- Install and run:
  ```bash
  npm install
  npm start
  ```
- App runs at http://localhost:3000

### Key URLs
- Dashboard (requires `agentId`): `/dashboard.html?agentId=<ID>`
- Standalone Intake: `/intake.html` (optionally `?agentId=<ID>`)
- W‑9 page (e‑sign + upload): `/w9.html` (optionally `?agentId=<ID>`)
- Admin tools: `/admin.html`

### Admin Tools
- Find Agent ID by email using `/admin.html` → “Find by Email”.
- List documents and download ZIP of all artifacts from `/admin.html`.
- Per-document downloads (server endpoints):
  - W‑9 PDF: `GET /api/agents/:id/documents/w9.pdf`
  - CMS/FFM Certification Proof: `GET /api/agents/:id/documents/cert`
  - ZIP of packet: `GET /api/agents/:id/documents/zip`

### Where data is stored
- Configurable via env vars (see below). Defaults under the project root:
  - `agents/` (per-agent data, signatures, uploads)
  - `submissions/` (intake and W‑9 JSON + uploads for anon flows)
  - `uploads/` (temporary upload staging)

## Environment Variables
The server allows overriding storage directories for cloud deployments:

- `AGENTS_DIR` (default: `<project>/agents`)
- `SUBMISSIONS_DIR` (default: `<project>/submissions`)
- `UPLOADS_DIR` (default: `<project>/uploads`)

Example (local):
```bash
# Powershell example
$env:AGENTS_DIR="C:\\data\\npn\\agents"; $env:SUBMISSIONS_DIR="C:\\data\\npn\\submissions"; $env:UPLOADS_DIR="C:\\data\\npn\\uploads"; npm start
```

## Security Note
Admin and download endpoints are open by default. For production, you should add authentication (e.g., Basic Auth or a bearer token) in front of:
- `/admin.html`
- `/api/agents/:id/documents/list`
- `/api/agents/:id/documents/zip`
- `/api/agents/:id/documents/w9.pdf`
- `/api/agents/:id/documents/cert`

If you want, we can wire a simple token check in the server.

## Deploy to DigitalOcean App Platform
This repo contains an App Spec at `.do/app.yaml` to streamline deployment with persistent volumes.

### Steps
1. Push this repo to GitHub (see “Push to GitHub” below).
2. In DigitalOcean → Apps → Create App → Connect to GitHub → select this repo.
3. Choose the `main` branch and the root directory.
4. App Platform will auto-detect Node and use `npm start`.
5. Under “Resources”, ensure the `Service` defined in `.do/app.yaml` is detected.
6. Persistent Storage:
   - The spec defines three volumes mounted at `/data/agents`, `/data/submissions`, `/data/uploads`.
   - The service sets env vars to point the app there: `AGENTS_DIR`, `SUBMISSIONS_DIR`, `UPLOADS_DIR`.
7. Deploy. After the first deployment, your app will be available at a DO URL.

### App Spec
See `.do/app.yaml` in this repo. You can customize size/class of the service and volume sizes.

## Push to GitHub
Replace the remote URL with your repo `https://github.com/bbarnes4318/npn.git`.

```bash
# From the project root
git init
git branch -M main
git add .
git commit -m "Initial import: NPN onboarding portal"
git remote add origin https://github.com/bbarnes4318/npn.git
git push -u origin main
```

If the repo already exists with commits, use:
```bash
git remote set-url origin https://github.com/bbarnes4318/npn.git
git push -u origin main
```

## Routes Overview (Server)
- Intake submit: `POST /api/intake` (multipart; optional `agentId`)
- W‑9 e‑sign submit: `POST /api/w9`
- W‑9 uploaded file (agent-bound): `POST /api/agents/:id/w9`
- W‑9 uploaded file (anon): `POST /api/w9/upload`
- Upload cert proof (agent-bound): `POST /api/agents/:id/uploadCert`
- Update progress: `PATCH /api/agents/:id/progress`
- Find agent by email: `GET /api/agents/find?email=...`
- Get agent: `GET /api/agents/:id`
- Documents:
  - List: `GET /api/agents/:id/documents/list`
  - ZIP: `GET /api/agents/:id/documents/zip`
  - W‑9 PDF: `GET /api/agents/:id/documents/w9.pdf`
  - Cert proof: `GET /api/agents/:id/documents/cert`
- Static docs (generated): `GET /docs/producerAgreement` (updated PDF)

## License
Private. All rights reserved.
