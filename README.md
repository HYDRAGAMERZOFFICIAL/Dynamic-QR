# Dynamic QR

**One QR code. Content that can change.**

Dynamic QR is a web application for creating permanent, customizable QR codes and managing the content behind them. Owners can update drafts, publish a new version, and keep using the same printed QR code.

## Product scope

- Universal audience: personal users, students, professionals and businesses.
- QR Studio with scan-safe 2D, artistic 2D and 3D-inspired presentations.
- Three active QR codes per account. Paused or archived codes do not count toward the active limit.
- Content sections for profile/contact details, social links, business information, images, documents and custom links.
- Draft and explicit Publish workflow. Public visitors only see the latest published snapshot.
- Optional password protection per QR code.
- Fully customizable public landing pages.
- PNG/SVG downloads and mobile-first public pages.

## Stack

- React 19 + TypeScript + Vite
- Tailwind-ready CSS architecture with custom design tokens
- Supabase Auth, Postgres, Row Level Security and private Storage
- qr-code-styling for configurable QR rendering

## Getting started

1. Install Node.js 20.19+ or 22.12+.
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env.local`.
4. For backend mode, create a Supabase project and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Apply the database migration: `npx supabase db push` (after linking your project), or run `supabase/migrations/202611110001_initial_schema.sql` in the Supabase SQL editor.
6. Deploy the public asset signer: `supabase functions deploy public-qr-content` (the function uses Supabase's server-side service-role environment variable).\n7. Start the app: `npm run dev`.

Without Supabase credentials, the app runs in local demo mode and stores demo content in the current browser. Demo mode is for UI evaluation only: it does not provide multi-device sync, secure account isolation, or server-enforced password protection. Configure Supabase before production use.

## Security and publishing model

The QR payload contains only a stable URL such as `https://your-domain/q/<slug>`, never user data. Editing changes `draft_content`; the public route reads `published_content`. The `publish_qr` database function snapshots and swaps the published content atomically.

The database migration enables RLS, keeps uploaded assets in a private bucket, serializes QR creation per user, and provides a password verification RPC that never returns the stored password hash. Do not expose a Supabase service-role key in the browser.

## Scripts

- `npm run dev` — development server
- `npm run typecheck` — TypeScript checks
- `npm run build` — production build
- `npm run preview` — preview production output

## Deployment

Deploy the Vite app to any static hosting provider with SPA fallback enabled. Configure the Supabase URL and publishable/anon key as build-time environment variables. Configure the custom domain used for permanent QR URLs before printing codes; changing that domain later will break already printed QR codes unless redirects are retained.
