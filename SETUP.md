# 🚀 AI Lead Gen SaaS - Complete Setup Guide

Complete setup in **45 minutes**. Everything you need is here.

---

## 📋 CHECKLIST - Follow In Order

### ✅ Step 1: Local Environment (10 min)

1. Download Node.js v18+ from https://nodejs.org/
2. Install Node.js
3. Verify in terminal:
   ```bash
   node --version
   npm --version
   ```

### ✅ Step 2: Supabase Database Setup (15 min)

1. Go to https://supabase.com and create an account
2. Create new project:
   - Project name: `ai-lead-gen`
   - Database password: Set strong password
   - Region: Choose closest to you
   - Wait for creation to complete

3. Get your API keys from **Settings → API**:
   - Copy `SUPABASE_URL`
   - Copy `SUPABASE_SERVICE_ROLE_KEY`
   - Copy `NEXT_PUBLIC_SUPABASE_ANON_KEY` (marked as "anon")

4. **Run database schema** (critical!):
   - Click **SQL Editor**
   - Click **New Query**
   - Copy entire file: `backend/src/db/schema.sql`
   - Paste into editor and click **Run**
   - Wait for completion ✓

5. Verify tables in **Table Editor**:
   - [ ] lead_sources
   - [ ] leads
   - [ ] campaigns
   - [ ] emails
   - [ ] gmail_tokens

### ✅ Step 3: OpenAI API Key (5 min)

1. Go to https://platform.openai.com
2. Sign up or login
3. Click **API keys** in left sidebar
4. Click **Create new secret key**
5. Copy and save: `OPENAI_API_KEY`
6. ⚠️ Never commit to GitHub!

### ✅ Step 4: Gmail OAuth Setup (10 min)

1. Go to https://console.cloud.google.com
2. Create new project:
   - Click "Select a Project" → "NEW PROJECT"
   - Name: `AI Lead Gen`
   - Click Create

3. Enable Gmail API:
   - Search for "Gmail API"
   - Click **ENABLE**

4. Create OAuth credentials:
   - Click **Credentials** in left sidebar
   - Click **+ CREATE CREDENTIALS**
   - Select **OAuth client ID**
   - Choose **Web application**
   - Under "Authorized redirect URIs", click **Add URI**
   - Add: `http://localhost:5000/api/gmail/callback`
   - Click **Create**

5. Copy:
   - `GMAIL_CLIENT_ID`
   - `GMAIL_CLIENT_SECRET`
   - Note: `GMAIL_REDIRECT_URI` = `http://localhost:5000/api/gmail/callback`

### ✅ Step 5: Create Environment Files

**Create `backend/.env`:**
```
SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
OPENAI_API_KEY=<your-openai-key>
GMAIL_CLIENT_ID=<your-gmail-client-id>
GMAIL_CLIENT_SECRET=<your-gmail-client-secret>
GMAIL_REDIRECT_URI=http://localhost:5000/api/gmail/callback
NODE_ENV=development
PORT=5000
```

**Create `frontend/.env.local`:**
```
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
NEXT_PUBLIC_API_URL=http://localhost:5000
```

### ✅ Step 6: Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend (in new terminal)
cd frontend
npm install
```

### ✅ Step 7: Start the App

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```
Expected: `Backend server running on http://localhost:5000`

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```
Expected: `started server on 0.0.0.0:3000`

Then open: **http://localhost:3000**

### ✅ Step 8: Verify It Works

1. Sign up at http://localhost:3000/signup
2. Create account with email/password
3. You should see dashboard
4. Go to **Upload** → Upload leads CSV
5. Success! ✓

---

## 🛠️ Quick Commands

### Start Development
```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

### Build for Production
```bash
# Backend
cd backend && npm run build && npm start

# Frontend
cd frontend && npm run build && npm start
```

### Database Commands
```bash
# Access Supabase SQL Editor to run queries
# Open: https://supabase.com → Your Project → SQL Editor
```

### Debug Issues
- Backend logs: Check Terminal 1 for API errors
- Frontend logs: Check Terminal 2 and browser console
- Port conflict? See TROUBLESHOOTING.md
- Missing env vars? Copy exactly from Step 5

---

## ⏱️ Time Estimate
- Node.js install: 5 min
- Supabase setup: 10 min
- OpenAI key: 3 min
- Gmail OAuth: 8 min
- Env files: 2 min
- Dependencies: 10 min
- Start servers: 2 min
- Verify: 5 min
- **Total: ~45 minutes**

---

## 🆘 Troubleshooting

**Module errors?** → See TROUBLESHOOTING.md
**Port already in use?** → See TROUBLESHOOTING.md
**Can't sign up?** → See TROUBLESHOOTING.md
**API keys not working?** → Double-check Step 2-4, ensure no spaces in .env files

For ALL common issues, see: **TROUBLESHOOTING.md**

---

## 📱 Next Steps

1. Upload leads CSV file from dashboard
2. Generate emails using auto-find or upload
3. Send emails via Gmail
4. Track opens and clicks in analytics
5. Setup email follow-ups (toggle in campaign settings)

Enjoy! 🎉

---

## 🚀 V2 Tier 1 — Tracking, Unified Inbox, AI Replies, Smart Sequences

Deploy order matters: **database → backend → frontend**. Existing V1 behaviour is unchanged
until the new columns exist, so run the migration first.

### 1. Database migration (Supabase SQL Editor, dev AND production)

Run the whole file `backend/src/db/migrations/2026-09-24_v2_tier1.sql`. It is idempotent.
It adds:

- `email_events`, `imap_credentials`, `replies` tables (RLS: owner SELECT only)
- tracking / smart-sequence columns on `emails`, toggle + config on `campaigns`
- `auto_paused_at` / `auto_pause_reason` on `user_plans`
- `record_email_open` / `record_email_click` RPCs and the `reply_fetch` job-lock row

Verify with the queries in the comment block at the end of the file.

### 2. Backend environment (Railway)

| Variable | Required | Purpose |
|---|---|---|
| `TRACKING_URL` | Recommended | Public origin used in tracking pixels and click links, e.g. `https://track.yourdomain.com`. Falls back to `BACKEND_URL`. |
| `BACKEND_URL` | Yes (already) | Fallback for tracking links and unsubscribe links. |

**Tracking subdomain (do this before real traffic):**

1. DNS: add a CNAME `track` → your Railway backend hostname.
2. Railway → backend service → Settings → Domains → add `track.yourdomain.com` (SSL is automatic).
3. Set `TRACKING_URL=https://track.yourdomain.com` and redeploy.

Why a separate subdomain: every user's tracked links share this host. If one abusive
tenant gets it flagged, you point a fresh subdomain at Railway and change one variable —
the app, API and audit-report domains are never affected. Keep the old subdomain alive so
links in already-sent emails still redirect.

No new keys are needed for the inbox: reply fetching uses IMAP with **app passwords**
supplied by each user in Settings → Inbox Connection (no Gmail read scope, no CASA review).

### 3. Frontend (Vercel)

No new environment variables. New route: `/inbox` (Growth & Agency; trial unlocks it).

### 4. What changes for existing users

- Outreach emails are now sent as **text + HTML** (the HTML mirrors the text exactly and
  carries the open pixel + tracked links). Stored bodies and AI prompts are untouched.
- Manual replies sent from the Inbox are plain text with **no** tracking.
- Smart sequences are **off** per campaign until the user turns them on. Out-of-office
  pauses, unsubscribe and not-interested cancellations apply whenever an inbox is connected.
- Safety brake: if a user's bounces + unsubscribe replies exceed 10% of a day's sends
  (minimum 30 sends), their running campaigns move to Draft and the dashboard shows why.

### 5. Tier 1 pricing (Growth $99, Agency $149, Starter unchanged at $39)

Tier 1 features (tracking, smart sequences, unified inbox, AI reply sorting) are Growth and
Agency only; Starter is locked like Hot Leads and CSV upload. The free trial unlocks everything.
One price list for every user — the app shows $39 / $99 / $149 to everyone.

1. **Dodo (live mode, then test mode):** change the Growth product price to $98.99 and the
   Agency product price to $148.99. Check in Dodo whether existing subscriptions pick up the
   new price at their next renewal; if they do not, existing subscribers must be moved to the
   new price in Dodo, otherwise they keep being charged the old amount.
2. If you create NEW products instead of editing the old ones, put the new ID first in
   Railway and keep the old one after a comma, e.g.
   `DODO_GROWTH_PRODUCT_ID=pdt_newGrowth,pdt_oldGrowth`, so older subscriptions are still
   recognised as Growth.
3. Tell existing customers about the change before their next renewal.
4. **Website:** update the public pricing page (outside this repo) to match.
