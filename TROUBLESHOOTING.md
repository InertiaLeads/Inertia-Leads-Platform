# 🔧 Troubleshooting Guide

## Quick Fix Checklist

When something breaks, try these in order:

### **Always Try First:**
1. Close all terminals
2. Delete `node_modules` in both backend and frontend
3. Run `npm install` again
4. Restart servers
5. Wait 5 seconds for servers to fully load
6. Hard refresh browser (Ctrl+Shift+R)

---

## Common Problems & Solutions

### ❌ "Module not found" or "Cannot find module"

**Problem:** 
```
Error: Cannot find module 'express'
```

**Solution:**
```bash
cd backend
rm -r node_modules
npm install
npm run dev
```

---

### ❌ "Port 5000 is already in use"

**Problem:**
```
Error: listen EADDRINUSE :::5000
```

**Solution 1 - Use different port:**
```bash
PORT=5001 npm run dev
```

**Solution 2 - Kill the process using port 5000:**

Windows:
```bash
netstat -ano | findstr :5000
taskkill /PID <PID_NUMBER> /F
```

Mac/Linux:
```bash
lsof -i :5000
kill -9 <PID>
```

---

### ❌ "OPENAI_API_KEY not set" or missing

**Problem:**
```
Warning: OPENAI_API_KEY not set. AI generation will fail.
```

**Solution:**
1. Check that `backend/.env` file exists
2. Open `backend/.env` and verify the line:
   ```
   OPENAI_API_KEY=sk-your_actual_key_here
   ```
3. Copy the exact key from https://platform.openai.com/api-keys
4. Make sure it starts with `sk-`
5. Restart backend server: `npm run dev`

---

### ❌ "Supabase connection failed"

**Problem:**
```
Error: Failed to connect to Supabase
```

**Solution:**
1. Check `backend/.env` has these lines:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
   ```
2. Verify URLs match exactly from Supabase dashboard
3. Check Supabase project is active (not paused)
4. Try health check:
   ```bash
   curl http://localhost:5000/api/health
   ```
5. If still fails, restart backend

---

### ❌ Frontend can't reach backend

**Problem:**
```
Failed to fetch from http://localhost:5000/api
CORS error
```

**Solution:**
1. Make sure backend is running: `npm run dev` in backend folder
2. Check backend is on port 5000:
   ```bash
   curl http://localhost:5000/api/health
   ```
3. In `frontend/.env.local`, verify:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:5000/api
   ```
4. In `backend/.env`, verify:
   ```
   FRONTEND_URL=http://localhost:3000
   ```
5. Restart frontend: `npm run dev` in frontend folder

---

### ❌ Signup/Login not working

**Problem:**
```
Error creating user in Supabase
```

**Solution:**
1. Check Supabase project exists and is active
2. Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are correct
3. Go to Supabase dashboard → Authentication → Check it's enabled
4. Try creating user directly in Supabase dashboard
5. If still fails, recreate project

---

### ❌ "npm install" fails with errors

**Problem:**
```
npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
```

**Solution:**
```bash
# Option 1 - Force install
npm install --legacy-peer-deps

# Option 2 - Clean and reinstall
rm -r node_modules package-lock.json
npm cache clean --force
npm install

# Option 3 - Use different Node version
node --version  # Check your version
nvm install 18  # Install Node 18 if needed
```

---

### ❌ TypeScript compilation errors

**Problem:**
```
error TS2307: Cannot find module '@types/express'
```

**Solution:**
```bash
cd backend
npm install --save-dev @types/express
npm run build
```

---

### ❌ "Command not found" or "not recognized"

**Problem:**
```
npm: command not found
```

**Solution:**
1. Node.js not installed: Download from nodejs.org
2. Terminal can't find npm: Restart terminal after installing Node
3. Wrong directory: Make sure you're in `backend` or `frontend` folder

---

### ❌ Files being saved but changes don't appear

**Problem:**
```
Code changed but app still shows old behavior
```

**Solution:**
1. Backend changes:
   - Backend automatically reloads (tsx watch)
   - Wait 2-3 seconds for compilation
   - Check terminal for errors
   - If stuck: Restart server

2. Frontend changes:
   - Frontend automatically reloads (Next.js dev mode)
   - Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
   - If stuck: Restart server and clear browser cache

---

### ❌ Database table doesn't exist

**Problem:**
```
Error: relation "leads" does not exist
```

**Solution:**
1. Go to Supabase SQL Editor
2. Copy entire contents of `backend/src/db/schema.sql`
3. Create new query
4. Paste and run
5. Wait for ✓ completion
6. Verify tables exist in "Table Editor"

---

### ❌ Email generation fails

**Problem:**
```
Error: Failed to generate emails
```

**Solution:**
1. Check OpenAI API key is valid:
   - Go to https://platform.openai.com/api-keys
   - Verify key exists and is active
   - Check in `backend/.env`

2. Check OpenAI has credits:
   - Go to https://platform.openai.com/account/billing/overview
   - Verify positive balance

3. Check lead has data:
   - Upload a lead first
   - Then try generating

---

### ❌ Auto-find (lead scraper) returns empty

**Problem:**
```
No leads found for the given criteria
```

**Solution:**
This is expected! The scraper API integration is a TODO.

**To enable real lead finding:**
1. Sign up for SerpAPI: https://serpapi.com
2. Get API key
3. In `backend/src/services/leadFinder.ts`, uncomment SerpAPI code
4. Add to `backend/.env`:
   ```
   SERPER_API_KEY=your_key_here
   ```
5. Restart backend

---

### ❌ Email sending fails

**Problem:**
```
Error: Failed to send email
```

**Solution:**
1. Check Gmail OAuth is configured:
   - Go to https://console.cloud.google.com
   - Verify project exists
   - Verify Gmail API is enabled
   - Verify OAuth credentials exist

2. Check in `backend/.env`:
   ```
   GMAIL_CLIENT_ID=your_id_here
   GMAIL_CLIENT_SECRET=your_secret_here
   GMAIL_REDIRECT_URI=http://localhost:5000/api/gmail/callback
   ```

3. Try authorizing Gmail again:
   - Go to http://localhost:3000/dashboard/settings
   - Click "Connect Gmail"
   - Follow OAuth flow

---

### ❌ "Too many requests" error

**Problem:**
```
Error: Too many requests, please try again later
```

**Solution:**
- Rate limiting is working (good sign!)
- Wait 15 minutes and try again
- Rate limits:
  - General API: 100 requests / 15 minutes
  - Email sending: 10 requests / hour
  - Generation: 20 requests / hour
  - Lead finding: 5 searches / hour

---

## Debug Mode

### Enable Verbose Logging

**Backend:**
Add to `backend/src/server.ts`:
```javascript
console.log = (...args) => {
  console.error(`[${new Date().toISOString()}]`, ...args);
};
```

**Frontend:**
Add to `frontend/src/lib/api.ts`:
```javascript
console.log('API Request:', method, endpoint, body);
```

### Check All Environment Variables

**Backend:**
```bash
# Windows PowerShell
Get-Content .env

# Mac/Linux
cat .env
```

**Frontend:**
```bash
# Windows PowerShell
Get-Content .env.local

# Mac/Linux
cat .env.local
```

---

## Network Debugging

### Test Backend Health
```bash
curl http://localhost:5000/api/health
```

Should return:
```json
{"status":"ok","timestamp":"2026-03-23T..."}
```

### Test Frontend
```bash
# Windows
start http://localhost:3000

# Mac
open http://localhost:3000

# Linux
xdg-open http://localhost:3000
```

---

## Database Debugging

### Check Tables Exist
Go to Supabase Dashboard → Table Editor

You should see:
- [ ] lead_sources
- [ ] leads
- [ ] campaigns
- [ ] emails
- [ ] gmail_tokens

### Check Data
In Supabase Dashboard:
1. Go to "Table Editor"
2. Click each table
3. Should see "(0)" rows when empty
4. After uploading leads, should show row count

### Clear All Data (Nuclear Option)

In Supabase SQL Editor, run:
```sql
DELETE FROM emails;
DELETE FROM leads;
DELETE FROM campaigns;
DELETE FROM lead_sources;
DELETE FROM gmail_tokens;
```

---

## Server Won't Start

### Issue: Port in use
See "Port 5000 is already in use" above

### Issue: Memory limit
```bash
# Increase Node memory
NODE_OPTIONS=--max-old-space-size=4096 npm run dev
```

### Issue: Disk space
- Check available disk space
- Delete unnecessary `node_modules` folders
- Clear npm cache: `npm cache clean --force`

---

## Performance Debugging

### Check What's Slow
1. Open browser DevTools (F12)
2. Go to "Network" tab
3. Reload page
4. Look for slow requests (color coded)
5. Check "Performance" tab for bottlenecks

---

## Emergency Recovery

If everything is broken:

```bash
# Backend recovery
cd backend
rm -r node_modules dist .env
npm install
# Recreate .env file with your API keys
npm run dev

# Frontend recovery
cd frontend
rm -r node_modules .next .env.local
npm install
# Recreate .env.local file with Supabase keys
npm run dev

# Database recovery
# Go to Supabase → SQL Editor
# Run entire backend/src/db/schema.sql again
```

---

## Still Stuck?

1. **Check all error messages** - they usually tell you exactly what's wrong
2. **Verify all .env files** - 90% of issues are missing API keys
3. **Check terminals** - backend errors show in backend terminal, frontend in terminal 2
4. **Check browser console** - F12 → Console tab shows frontend errors
5. **Restart everything** - close all terminals, restart fresh
6. **Google the error** - copy exact error message and search

---

## Getting Help

When asking for help, provide:
1. Exact error message (copy & paste)
2. Which terminal it's from (backend/frontend)
3. What you were doing when it broke
4. What you've already tried
5. Your Node version: `node --version`

---

Good luck! 🚀
