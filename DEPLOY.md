# Put SAT Tutor on the public internet (beginner guide)

Stack: **GitHub** (stores code) → **Neon** (free PostgreSQL database) → **Render** (runs the app, gives you a public https link) → optional **Resend** (sign-up emails) and a **custom domain**.
Free-tier limits change, so check each site's pricing page before launch.

---

## STEP 0 — Rotate the API keys that were in your zip (do this first)
The old `.env.example` contained real Groq and Resend keys. Anyone who has seen that file can use them.
1. https://console.groq.com/keys → delete the old key, create a new one. Keep it private.
2. https://resend.com/api-keys → delete the old key (create a new one later in Step 7).
The new `.env.example` is empty on purpose. Never put real keys in files you upload or commit.

## STEP 1 — Put the code on GitHub (private repo)
1. Unzip the project. Make a free account at github.com → **New repository** → name `sat-tutor`, choose **Private**, don't add a README.
2. In a terminal inside the unzipped `sat-tutor-platform-groq` folder:
```
git init
git add .
git commit -m "SAT Tutor"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/sat-tutor.git
git push -u origin main
```
`.gitignore` already blocks `.env` and `node_modules`.

## STEP 2 — Create the database (Neon, free)
1. neon.tech → sign up → **Create project** (any name, pick the region closest to your users; later pick the same region on Render).
2. On the project dashboard click **Connect** and copy the **connection string** (starts with `postgresql://...`, ends with `?sslmode=require`). Save it somewhere private — this is your `DATABASE_URL`.
You do NOT need to create tables; the app does it on first start.

## STEP 3 — Deploy the app (Render)
1. render.com → sign up with GitHub.
2. **New + → Web Service** → connect your `sat-tutor` repo.
3. Settings: **Runtime: Docker** (it finds the Dockerfile), **Instance type: Free** (or Starter for always-on), **Health check path: `/healthz`**.
   (Alternative: **New + → Blueprint** uses the included `render.yaml` and pre-fills most of this.)
4. Add **Environment Variables**:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the Neon string from Step 2 |
| `DATABASE_SSL` | `true` |
| `GROQ_API_KEY` | your NEW Groq key |
| `GROQ_MODEL` | `openai/gpt-oss-20b` |
| `APP_BASE_URL` | your Render URL, e.g. `https://sat-tutor.onrender.com` (set after first deploy if you don't know it yet) |
| `TRUST_PROXY` | `true` |
| `MAX_TUTOR_AGENTS` | `5` (free instances have little RAM; each live AI chat runs 3 small helper processes) |
| `REQUIRE_EMAIL_VERIFICATION` | `false` for now (see Step 7) |
| `ADMIN_EMAIL` | your email |
| `ADMIN_PASSWORD` | a strong password, 10+ characters |

5. Click **Create Web Service**. First build takes a few minutes. In the logs you should see:
`PostgreSQL schema applied successfully` → `seeding 1,200 original questions` → `Created admin account` → `SAT Tutor web app listening`.
6. If you didn't know the URL beforehand: copy it from the top of the Render page, put it in `APP_BASE_URL`, save (it redeploys).

## STEP 4 — Test it like a stranger would
Open the Render URL in a private/incognito window:
1. Register a new student account → log in → answer a practice question.
2. Open the **AI Tutor** and send a message (if it errors, check `GROQ_API_KEY` and Groq's rate limits).
3. Log in with your `ADMIN_EMAIL` account → confirm the admin dashboard appears.
4. Visit `/healthz` → should show `{"ok":true}`.
5. After your first admin login, **delete `ADMIN_PASSWORD`** from Render's env vars (the account stays).

## STEP 5 — Know the free-tier behaviour
- Render free web services **sleep after ~15 min with no visitors**; the next visitor waits roughly a minute while it wakes. Upgrade to a paid instance for always-on, or use a free uptime pinger on `/healthz` (check Render's terms).
- Groq's free tier has request limits; heavy use will show "rate limited" errors in the AI tutor. Watch usage at console.groq.com and upgrade if needed.
- Neon free databases pause when idle and wake automatically on the next request (small delay).

## STEP 6 — Custom domain (optional, ~$10/year)
1. Buy a domain (Namecheap, Cloudflare, Porkbun…).
2. Render → your service → **Settings → Custom Domains → Add**, then create the DNS record Render shows you at your registrar. https is automatic.
3. Update `APP_BASE_URL` to `https://yourdomain.com`.

## STEP 7 — Email verification & password reset for the public (strongly recommended)
Resend's default sender (`onboarding@resend.dev`) only delivers to **your own** email, so strangers would never receive verification/reset emails. Until you do this, keep `REQUIRE_EMAIL_VERIFICATION=false`.
1. Needs a domain (Step 6). In resend.com → **Domains → Add** → add the DNS records it gives you → wait for "Verified".
2. Create a new API key. In Render set: `RESEND_API_KEY=<new key>`, `EMAIL_FROM="SAT Tutor <noreply@yourdomain.com>"`, `REQUIRE_EMAIL_VERIFICATION=true`.
3. Test: register with a real inbox, click the link, log in. Test "forgot password" too.

## STEP 8 — Before you announce it
- [ ] Old Groq/Resend keys deleted (Step 0)
- [ ] Neon: Settings → enable backups/history as your plan allows; note how to restore
- [ ] Add a Privacy Policy + Terms page (you collect names, emails and study data). Many regions have legal requirements — this is not legal advice.
- [ ] You're not claiming the practice questions are official College Board material (the bank is original; keep that wording)
- [ ] Share the link!

## Updating the live site later
Change code → `git add . && git commit -m "msg" && git push` → Render redeploys automatically. Database data is kept.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Build fails | Open Render logs; usually a missing/typo'd env var or Node error |
| `DATABASE_URL is required` | Env var missing in Render |
| `self signed certificate` / SSL error | Set `DATABASE_SSL=true` |
| Everyone gets "Too many requests" | `TRUST_PROXY` must be `true` on Render |
| AI tutor error | Check `GROQ_API_KEY`, Groq rate limits, Render logs |
| Verification emails never arrive | Step 7 (verified domain) or set `REQUIRE_EMAIL_VERIFICATION=false` |
| Out-of-memory restarts | Lower `MAX_TUTOR_AGENTS` or use a bigger instance |

## Run locally to test first (optional)
```
docker compose up --build        # needs Docker; then open http://localhost:3000
```
