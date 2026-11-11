# Dynamic QR — Production Setup & Deployment Runbook

This document is the handover guide for configuring, deploying, securing, and testing the Dynamic QR application. Follow the stages in order. It describes the repository as it exists today; it does **not** mean that a live Supabase project or production deployment has already been configured.

- Repository: https://github.com/HYDRAGAMERZOFFICIAL/Dynamic-QR
- Production branch: `main`
- Frontend: React 19, TypeScript, Vite
- Backend: Supabase Auth, Postgres, Row Level Security, private Storage, Edge Functions
- Current database migrations:
  - `supabase/migrations/202611110001_initial_schema.sql`
  - `supabase/migrations/202611110002_scan_analytics.sql`
- Edge Function: `public-qr-content`
- Storage bucket: `qr-assets` (private)

> **Important:** The QR code contains a permanent destination URL. Decide and configure the production domain before distributing or printing QR codes. Changing `VITE_APP_URL` later changes newly generated QR destinations; old printed QR codes continue to work only if the old domain remains active or redirects are maintained.

---

## 0. Preflight checklist

Have access to:

- [ ] GitHub repository and permission to push/merge changes.
- [ ] Supabase account and production project access.
- [ ] Hosting provider account (Vercel is one option).
- [ ] Domain registrar / DNS access.
- [ ] A secure password manager for credentials.

Choose these values before proceeding:

| Item | Example / guidance |
|---|---|
| Production domain | `https://qr.example.com` or `https://example.com` |
| Supabase project | Dedicated production project, not a development project |
| Supabase region | Select a region suitable for your users and data requirements |
| Hosting project | Import this GitHub repository |
| Production branch | `main` |

Never commit secrets, database passwords, service-role keys, access tokens, or populated environment files.

## 1. Review the repository and local prerequisites

Install:

- Node.js **20.19+** or **22.12+**.
- npm (bundled with Node.js).
- Git.
- Supabase CLI (the repository commands below use `npx supabase`).

Clone and install:

```bash
git clone https://github.com/HYDRAGAMERZOFFICIAL/Dynamic-QR.git
cd Dynamic-QR
npm install
```

Check available scripts in `package.json`:

```bash
npm run dev
npm run typecheck
npm run build
npm run preview
```

The application can run without Supabase credentials in **local demo mode**. Demo mode uses browser-local storage and is only for UI evaluation. It does not provide multi-device sync, real account isolation, or server-enforced password protection. Do not use demo mode as a production deployment.

## 2. Create the production Supabase project

1. Open https://supabase.com/dashboard.
2. Create a new project dedicated to production.
3. Choose the project name and a region appropriate for the intended user base.
4. Generate a strong database password and store it in a password manager.
5. Wait until the project is ready.

From Project Settings, collect:

- Project URL.
- Publishable key (or legacy anon key, if that is what the project exposes).
- Project reference ID.

The frontend currently reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `src/lib/supabase.ts`. Use the publishable/anon client key here. **Never put the service-role/secret key or database password in a Vite variable.** Vite variables are bundled into browser code.

The Edge Function obtains its server-side credentials from the Supabase function environment. Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions; do not copy the service-role key into the frontend.

## 3. Configure local environment variables

The repository includes `.env.example`. Create a local-only file:

**macOS / Linux**
```bash
cp .env.example .env.local
```

**Windows PowerShell**
```powershell
Copy-Item .env.example .env.local
```

Set the values:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
VITE_APP_URL=http://localhost:5173
```

Use the exact variable names above; they are read by the current source code. Keep `.env.local` out of Git. Confirm it is ignored by `.gitignore` before proceeding.

Start the local application:

```bash
npm run dev
```

With valid Supabase values, the sign-in / registration interface should be enabled. Without them, the app displays the local demo entry point.

## 4. Apply database migrations

The production database must receive both migrations in order:

1. `202611110001_initial_schema.sql` — profiles, QR records, private password hashes, content versions, files, scans, RLS, database RPCs, and the private `qr-assets` Storage bucket and policies.
2. `202611110002_scan_analytics.sql` — scan lookup index, updated public content RPC that records bounded user-agent metadata, and owner-scoped analytics RPC.

Do not skip the initial migration. The analytics migration is additive and assumes the initial schema already exists.

### Recommended: Supabase CLI

From the repository root:

```bash
npx supabase --version
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase migration list
npx supabase db push
npx supabase migration list
```

Review the project reference and migration plan before confirming the push. The final migration list should show both repository migrations applied to the intended production project.

### Alternative: SQL Editor

Use this only when you are deliberately managing migrations manually:

1. Open Supabase Dashboard → SQL Editor.
2. Run the complete contents of `202611110001_initial_schema.sql`.
3. Confirm it completed successfully.
4. Run the complete contents of `202611110002_scan_analytics.sql`.
5. Check the schema, functions, policies, and bucket.

Do not run the same migration again manually if the CLI has already applied it. Keep migration history consistent.

### Database objects to verify

The migrations create or configure:

- Tables: `profiles`, `qr_codes`, `qr_content_versions`, `qr_files`, `qr_scans`.
- Private schema/table: `private.qr_passwords`.
- RPCs: `create_qr`, `publish_qr`, `set_qr_status`, `get_qr_content`, `set_qr_password`, `get_qr_analytics`.
- Private Storage bucket: `qr-assets`.
- Row Level Security and ownership policies.

The database enforces a maximum of three active QR codes per account through serialized database functions. Verify this in the live project; do not rely only on the visual counter in the UI.

## 5. Configure Supabase Authentication

Open Supabase Dashboard → Authentication → URL Configuration.

Set:

- **Site URL:** the final production origin, e.g. `https://qr.example.com`.
- **Redirect URLs:** add the exact production and local callback destinations required by the current auth flow.

For local development, allow the local origin, for example:

```text
http://localhost:5173/**
```

For production, allow the final domain and any callback paths actually used by the app, for example:

```text
https://qr.example.com/**
```

Use the least permissive redirect list practical. Do not add arbitrary wildcard domains.

The current sign-up flow calls Supabase `auth.signUp`; if email confirmation is enabled, the user must confirm the email before signing in. Configure SMTP / an email provider if you want reliable production email delivery. Test the actual confirmation link and return path.

Authentication checks:

- [ ] Sign up with a new email address.
- [ ] Confirm the email, if confirmation is enabled.
- [ ] Sign in with valid credentials.
- [ ] Confirm invalid credentials are rejected.
- [ ] Refresh the browser and confirm session handling.
- [ ] Sign out and confirm protected workspace data is no longer available.
- [ ] Confirm user A cannot read or modify user B's QR records.
- [ ] Confirm the production Site URL and redirect URLs are correct.

Do not assume password-reset or other account-management screens exist unless they are present in the current application. Add and test any required flows separately.

## 6. Configure and verify Supabase Storage

The initial migration creates the private bucket named `qr-assets` with a 25 MiB file-size limit and allowed MIME types:

- PDF: `application/pdf`
- DOC: `application/msword`
- DOCX: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- PNG: `image/png`
- JPEG: `image/jpeg`
- WEBP: `image/webp`

The application validates uploads at 25 MB maximum and uses a 3 MB limit in local demo mode.

In Supabase Dashboard → Storage:

1. Confirm that `qr-assets` exists.
2. Confirm it is **private**, not public.
3. Confirm the bucket file-size and MIME restrictions match the migration.
4. Inspect Storage policies created by the migration.
5. Test uploads using an authenticated account.

Current object paths are scoped by user and QR, in this form:

```text
<user-id>/<qr-id>/<generated-file-name>
```

Verify that users can upload only into their own permitted folder and cannot read, overwrite, or delete another user's objects. Public visitors should not be able to list or directly read the private bucket.

The Edge Function creates short-lived signed URLs for published files after the public QR content/password check. Test those URLs from a logged-out browser. A password-protected QR page is not protected if its files can be fetched from a permanent public URL.

## 7. Deploy the public QR Edge Function

The function source is:

```text
supabase/functions/public-qr-content/index.ts
```

The function:

- Accepts POST requests (and CORS preflight OPTIONS requests).
- Validates the QR slug.
- Calls the database `get_qr_content` RPC.
- Returns no content for unavailable/unpublished destinations.
- Returns a password-required response when the supplied password is missing or incorrect.
- Generates 10-minute signed URLs for files in the published content.
- Passes a bounded user-agent value for scan analytics.

The repository's `supabase/config.toml` sets:

```toml
[functions.public-qr-content]
verify_jwt = false
```

This endpoint is intentionally callable by visitors who are not logged in. Keep the database RPC's password check, slug validation, private storage, and signed URL handling in place. Do not disable security checks in the function or database.

Deploy:

```bash
npx supabase functions deploy public-qr-content --project-ref YOUR_PROJECT_REF
```

The deployed function uses Supabase-provided server-side environment variables. Do not expose or embed `SUPABASE_SERVICE_ROLE_KEY` in frontend code, source control, or build variables.

After deployment:

- [ ] Confirm the function appears in Supabase → Edge Functions.
- [ ] Confirm its deployment logs show no startup/runtime errors.
- [ ] Invoke it with a valid published QR slug.
- [ ] Try a nonexistent slug.
- [ ] Try an unpublished QR.
- [ ] Try a password-protected QR with no password, a wrong password, and the correct password.
- [ ] Confirm signed file URLs are time-limited and files are inaccessible through the raw private storage path.
- [ ] Confirm successful scans appear in analytics.

Do not paste service-role credentials into chat, tickets, source files, or screenshots.

## 8. Configure the frontend host (Vercel example)

The application is a Vite single-page frontend. Vercel is one suitable hosting option; another static host can be used if it supports SPA route fallback.

1. Open https://vercel.com/dashboard.
2. Import the GitHub repository `HYDRAGAMERZOFFICIAL/Dynamic-QR`.
3. Select `main) as the production branch.
4. Configure the build:

| Setting | Value |
|---|---|
| Framework | Vite |
| Install command | `npm install` |
| Build command | `npm run build` |
| Output directory | `dist` |

5. Add the public frontend environment variables:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
VITE_APP_URL=https://YOUR_FINAL_DOMAIN
```

6. Add the variables to the Production environment. Add Preview/Development values only if those environments should connect to a Supabase project.
7. Deploy the production branch.
8. Review build logs and browser console errors.

**Critical:** `VITE_APP_URL` is used by the app to construct QR destination URLs. It must be the stable HTTPS origin that you intend to keep. Do not use a temporary preview URL for QR codes you intend to distribute.

For any non-Vercel static host, configure SPA fallback so direct navigation to `/q/<slug>` serves the app entry point instead of returning a host-level 404.

## 9. Configure the permanent domain and HTTPS

1. Decide the final domain or subdomain before printing QR codes.
2. In the hosting provider, add the domain to the project.
3. Copy the exact DNS records supplied by the host.
4. Add those records at the domain registrar/DNS provider.
5. Wait for DNS verification and certificate provisioning.
6. Confirm the site loads over HTTPS.
7. Set the canonical production domain.
8. Update Vercel's `VITE_APP_URL` to the final origin and redeploy.
9. Update Supabase Authentication Site URL and redirect allowlist.
10. Test the same public QR URL from mobile data and a separate browser.

Example final origin:

```text
https://qr.example.com
```

Preserve the domain for the lifetime of printed QR codes. If changing domains is unavoidable, keep the old domain and redirect the old QR paths to the new domain.

## 10. Security and production hardening

Complete this review before opening registration to the public.

### Identity and database access

- [ ] RLS is enabled on all user-owned tables.
- [ ] Policies restrict reads/writes to the authenticated owner.
- [ ] Private password hashes are inaccessible to anon/authenticated clients.
- [ ] Privileged database functions validate `auth.uid()` and QR ownership.
- [ ] The three-active-QR limit is enforced atomically in the database.
- [ ] Analytics RPC is callable only by authenticated owners and returns only their data.
- [ ] Public content RPC returns only active, published content.
- [ ] Draft content is never returned by the public endpoint.

### Password protection and public files

- [ ] Passwords are stored as hashes, not plaintext.
- [ ] Wrong or missing passwords do not reveal protected content.
- [ ] Password checks occur server-side before signed file URLs are issued.
- [ ] Private bucket is not made public as a shortcut.
- [ ] Signed URLs expire as intended (current function uses 600 seconds).
- [ ] Consider rate limiting / abuse protection for public password attempts and function invocation.
- [ ] Avoid exposing raw internal error messages to public clients; review function error responses before launch.

### Uploads, privacy and monitoring

- [ ] MIME types and size limits are checked by the application and bucket.
- [ ] User-supplied filenames are sanitized for storage paths.
- [ ] Users cannot access other users' files.
- [ ] No secrets are present in Git history, frontend bundles, or deployment logs.
- [ ] Scan analytics do not collect visitor IP addresses in the current migration.
- [ ] Review privacy notice and retention requirements before collecting analytics.
- [ ] Review Supabase logs, hosting logs, and usage/billing alerts.

If any security test fails, pause launch and fix it before enabling public use.

## 11. End-to-end acceptance tests

Run these against the deployed production domain, ideally with two separate test accounts and a logged-out/private browser.

### A. Account and ownership

- [ ] Create account A and account B.
- [ ] Sign in as A and create a QR.
- [ ] Sign in as B and verify B cannot see, edit, archive, or access A's QR.
- [ ] Sign out and verify workspace access is blocked.
- [ ] Confirm account sessions behave correctly after refresh.

### B. QR creation, limits and design

- [ ] Create a QR using each relevant starter template.
- [ ] Test 2D and 3D-inspired presentation styles.
- [ ] Download PNG and SVG and scan both.
- [ ] Create three active QR codes.
- [ ] Attempt to create a fourth; it must be rejected by the backend.
- [ ] Pause/archive one and verify a new active QR can be created.
- [ ] Test concurrent create attempts to confirm the database limit holds.

### C. Draft and publish

- [ ] Create a QR draft.
- [ ] Publish it and scan the code.
- [ ] Edit the draft without publishing.
- [ ] Scan again and confirm the public page still shows the previous published snapshot.
- [ ] Publish again and confirm the same QR URL shows the new content.
- [ ] Pause the QR and confirm its public destination is unavailable.
- [ ] Confirm the slug does not change when content is edited or published.

### D. Password protection

- [ ] Set a password meeting the current minimum of eight characters.
- [ ] Scan without a password.
- [ ] Try an incorrect password.
- [ ] Try the correct password.
- [ ] Confirm protected content and files are visible only after successful verification.
- [ ] Remove the password and verify the page becomes public as intended.

### E. File delivery

- [ ] Upload PDF, DOC, DOCX, PNG, JPEG, and WEBP test files.
- [ ] Confirm uploaded images appear in the public image gallery after publishing.
- [ ] Confirm documents can be downloaded from the public page.
- [ ] Attempt an unsupported MIME type.
- [ ] Attempt a file larger than 25 MB.
- [ ] Attempt to access a private object URL without a signed URL.
- [ ] Confirm signed URLs expire and can be refreshed by reopening the QR page.

### F. Analytics

- [ ] Scan a published QR from a mobile device.
- [ ] Open the destination from a separate browser.
- [ ] Confirm successful scans increment analytics.
- [ ] Confirm password failures/unpublished destinations do not count as successful scans.
- [ ] Verify total scans, per-QR counts, and the 14-day chart.
- [ ] Confirm account B cannot see account A's analytics.

### G. Responsive and operational tests

- [ ] Test current Android and iOS browsers.
- [ ] Test desktop Chrome, Firefox, and Safari where available.
- [ ] Test slow/mobile network behavior.
- [ ] Test direct navigation to a QR URL (not only in-app navigation).
- [ ] Check browser console, Edge Function logs, and database logs.
- [ ] Confirm the production build contains no missing environment variable errors.

## 12. Final verification commands

Run from the repository root after changes:

```bash
npm install
npm run typecheck
npm run build
```

Optionally preview the production bundle locally:

```bash
npm run preview
```

Check GitHub Actions:

https://github.com/HYDRAGAMERZOFFICIAL/Dynamic-QR/actions

Confirm the latest workflow for `main` passes. A successful frontend build does not prove that Supabase migrations, authentication, Storage policies, or Edge Functions are correctly deployed; verify those separately.

## 13. Launch checklist

- [ ] Production Supabase project created.
- [ ] Both migrations applied in order.
- [ ] Database schema, RPCs, and RLS verified.
- [ ] Authentication URLs and email confirmation tested.
- [ ] Private `qr-assets` bucket and policies verified.
- [ ] `public-qr-content` Edge Function deployed and tested.
- [ ] Frontend production environment variables configured.
- [ ] Frontend deployed from `main`.
- [ ] Permanent domain and HTTPS verified.
- [ ] `VITE_APP_URL` matches the permanent domain.
- [ ] Security audit passed.
- [ ] End-to-end acceptance tests passed.
- [ ] GitHub Actions passed.
- [ ] Privacy notice, support contact, and terms are ready before public launch.
- [ ] Backups, monitoring, and billing alerts reviewed.

## 14. Official documentation

- Supabase Dashboard: https://supabase.com/dashboard
- Supabase CLI: https://supabase.com/docs/guides/cli
- Supabase migrations: https://supabase.com/docs/guides/deployment/database-migrations
- Supabase Auth: https://supabase.com/docs/guides/auth
- Supabase Storage: https://supabase.com/docs/guides/storage
- Supabase Edge Functions: https://supabase.com/docs/guides/functions
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Vercel deployment: https://vercel.com/docs/deployments/overview
- Vercel domains: https://vercel.com/docs/domains/working-with-domains

---

## Handover note

Complete the steps in order and keep a record of which checklist items have been verified. Do not share credentials in this document or commit them to the repository. If the live project differs from this guide, inspect the current migrations and source code before changing production settings.
