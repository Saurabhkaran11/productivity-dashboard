# MyLife — Your Daily Dashboard

A friendly, colorful, **3D** productivity dashboard for anyone — kids, adults, and everyone in between. Track spending, work hours, daily schedule, and to-do lists with PDF/Excel export, multi-chart analytics, email + Google login, Gmail reports, Google Sheets export, and Google Drive backup.

## Features

- **3D experience** — a gentle WebGL scene of floating shapes in the background (auto-disabled when the device can't handle it), plus CSS-3D tilting cards and an animated logo
- **Made for all ages** — an accessibility toolbar on every page:
  - **A+/A−** resize all text
  - **High contrast** mode
  - **Dyslexia-friendly font** (OpenDyslexic)
  - **Big easy-to-press buttons** mode
  - **Reduce movement** mode (turns off the 3D motion)
  - **Read this page aloud** (speech)
  - **Voice navigation** — tap the microphone and say "Spending", "To-Do List", "Settings", "Help"… to jump there
  - **Help** — a friendly how-to overlay with a "Listen" button for every topic
- **Dashboard** — overview cards + progress & utilization pie charts
- **Spending Tracker** — expenses by category with daily/weekly/monthly/yearly filters + pie/area/bar/line charts
- **To-Do List** — tasks with priority, due dates, completion; progress & priority pie charts
- **Work Tracker** — hours per task/project; charts by date and project
- **Daily Schedule** — time-blocked events with recurring option; time-utilization pie charts
- **Export & Reports** — PDF + Excel downloads for daily/weekly/monthly/yearly/all-time
- **Accounts** — email/password signup, or Google login (Gmail, Yahoo, etc.), with per-user private data
- **Google Cloud** — export all dashboard data to Google Sheets, archive PDF/Excel backups to Drive, and mirror local to-dos to Google Tasks
- **Email notifications** — daily/weekly/monthly/yearly reports to your inbox (Gmail API or SMTP), with opt-in daily and weekly delivery
- **Weekly Google automation** — select Sheets, Drive, Tasks and/or a weekly analysis email, choose a day and time, then test it with “Run weekly automation now”

## Tech Stack

- **Frontend:** React + Vite + Recharts + lucide-react + react-three-fiber (three.js)
- **Backend:** FastAPI + SQLite (local, in `backend/data.db` — safe by default) *or PostgreSQL in production*
- **Exports:** openpyxl (Excel), reportlab (PDF)
- **Auth:** PBKDF2 password hashing + HMAC-signed tokens

## Run it locally

```bash
cd ~/Desktop/productivity-dashboard
./start.sh
```

Open **http://localhost:3000** (dev mode: backend on :8000, frontend on :3000).

Or run the single-server production mode (the built app is served by the backend on one port):

```bash
./start.sh --prod   # then open http://localhost:8000
```

Create an account on the login screen — your data is stored locally and linked to your account.

## Deploy so anyone in the world can use it

The app is designed to run as **one Docker service** (backend serves the built frontend).

### Option A — Any container host (Railway, Fly.io, Render, a VPS)

1. Build the image:

```bash
cd ~/Desktop/productivity-dashboard
docker build -t mylife-dashboard .
```

2. Run it with a **persistent volume** for the SQLite database (so data survives restarts):

```bash
docker run -d --name mylife \
  -p 8000:8000 \
  -e APP_SECRET='a-long-random-secret-string' \
  -e CORS_ORIGINS='https://your-domain.com' \
  -e FRONTEND_URL='https://your-domain.com' \
  -v mylife_data:/data \
  mylife-dashboard
```

or with compose: `docker compose up -d`

3. Open `https://your-domain.com`, create an account, and share the URL.

> **Important:** mount a persistent volume at `/data` (the DB lives at `/data/mylife.db`). Without it your users' data is lost on redeploys. SQLite comfortably handles a small community of users. If you expect heavy traffic, use the **AWS + PostgreSQL** recipe below instead.

### Option C — AWS (ECS Fargate + PostgreSQL + HTTPS) ← recommended for production
See the `terraform/` folder. One `terraform apply` provisions: a VPC, an SSL certificate, an Application Load Balancer (HTTPS redirect), a **PostgreSQL** RDS, the ECS cluster running the container, Route 53 DNS, and CloudWatch logs. Set `DATABASE_URL` in AWS Secrets Manager instead of a mounted SQLite volume.

### Option B — Free-tier host (Render.com)

1. Push this repo to GitHub.
2. Create a **Web Service** on Render pointing at the repo.
3. Build command: `docker build -t mylife-dashboard .` and run command: `sh -c "python -m uvicorn main:app --host 0.0.0.0 --port 8000"` (or use the provided Dockerfile directly — Render auto-detects it).
4. Add a **Persistent Disk** mounted at `/data` (Render free tier supports disks).
5. Set env vars: `APP_SECRET`, `CORS_ORIGINS`, `FRONTEND_URL`.
6. Deploy and share the URL.

## Enable Google login + Drive/Sheets/Gmail (one-time ~10 min setup)

1. https://console.cloud.google.com/ → create a project.
2. **APIs & Services → OAuth consent screen** → type **External** → add your email as a **Test user**.
3. **Enable the APIs** you want to use: **Gmail API**, **Google Drive API**, **Google Sheets API**, **Google Calendar API**, and **Google Tasks API** (all under APIs & Services → Library).
4. **Credentials → Create Credentials → OAuth client ID**:
   - Type: **Web application**
   - Authorized redirect URI: `http://localhost:8000/auth/google/callback` (or your deployed URL)
5. `cp backend/.env.example backend/.env` and paste the **Client ID / Secret**.
6. Restart (`./start.sh` or redeploy).

On the **Settings** page you can then: connect Google, export to Sheets, back up to Drive, send reports, mirror MyLife to-dos to Google Tasks, and schedule daily or weekly automation. The **My Google** page shows your live Gmail inbox, Drive files, Sheets and Calendar in one place.

### Reliable weekly automation on Render

The web service checks due automations while it is running. For reliable delivery in production, create a [Render Cron Job](https://render.com/docs/cronjobs) which calls the protected endpoint every five minutes:

1. In the **Web Service** environment, add a strong random `CRON_SECRET`.
2. Create a **Cron Job** in the same Render account and give it two environment variables: `APP_URL` (for example `https://productivity-dashboard-hsr0.onrender.com`) and the same `CRON_SECRET`.
3. Use schedule `*/5 * * * *` and this command:

```bash
curl --fail --silent --show-error -X POST "$APP_URL/cron/automations" -H "X-Cron-Secret: $CRON_SECRET"
```

4. In **Settings → Weekly Google automation**, select the actions you want, choose a day/time, save, then use **Run weekly automation now** to validate the connected products and email delivery. The manual test does not consume that week's scheduled run.

To-dos are mirrored **one-way from MyLife to Google Tasks**. MyLife remains the source of truth, so edits made only inside Google Tasks are not imported back or used to overwrite the dashboard.

## SMTP (alternative email delivery)

Configure on the **Settings** page: Gmail `smtp.gmail.com` :587 with an App Password, Outlook `smtp.office365.com` :587, or Yahoo `smtp.mail.yahoo.com` :587.

## Configuration (env vars)

| Variable | Purpose | Default |
|----------|---------|---------|
| `APP_SECRET` | HMAC token signing secret — **change in production** | dev value |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins | localhost |
| `FRONTEND_URL` | Where login redirects after Google OAuth | `http://localhost:3000` |
| `MYLIFE_DB` | Path to the SQLite file | `backend/data.db` |
| `ALLOWED_DOMAIN` | Restrict sign-up + Google login to one domain (empty = open) | empty |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google OAuth | empty |
| `CRON_SECRET` | Secret required by the protected recurring-automation endpoint | empty (endpoint disabled) |
| `FRONTEND_DIST` | Where the built React app lives | `frontend/dist` |

## Security

- **Per-user data isolation** — every row is filtered by `user_id`; data is never mixed across accounts.
- **Signed, expiring tokens** — HMAC-SHA256 auth tokens (default 168h); no guessable sessions.
- **Rate limiting** — login, registration and Google auth flows are throttled per IP (429 if exceeded).
- **Optional domain restriction** — set `ALLOWED_DOMAIN` to lock sign-ups to a single organization, so only trusted users can log in.
- **Least-privilege Google scopes** — users approve exactly the permissions requested at connect time.

## API Endpoints

Full docs at `/docs` once running. Highlights: `/auth/register`, `/auth/login`, `/auth/google/callback`, `/spending`, `/todos`, `/worklog`, `/schedule`, `/analytics/summary`, `/export/excel`, `/export/pdf`, `/sync/sheets`, `/sync/drive`, `/notify/report`, `/settings/email`.
