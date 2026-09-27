# MashupHost website — Sanity Studio

Edit the homepage (headline, feature groups, WinBox/VLAN section, customer points, steps, prices,
Kenya section, FAQ, footer) in Sanity instead of in code. The website reads the published
**Homepage** document; any field left empty keeps the text the site already has.

This folder is its own npm project, outside the pnpm workspace: the Studio needs React 19 and the
web app runs React 18, so they never share dependencies. Nothing here is built into the Docker images.

## One-time setup (about 10 minutes)

1. **The project** is `xmn0tjwm` (already set in this folder). In <https://www.sanity.io/manage>
   → that project → *Datasets*, make sure a dataset named `production` exists and is **public**
   (create it if not).

2. **Install and log in** (needs Node 22.12+):
   ```bash
   cd studio
   npm install
   npx sanity login
   ```

3. **Load today's homepage text** so you start from what the site shows now:
   ```bash
   npm run seed
   ```

4. **Put the Studio online** (free, at `https://mashuphost.sanity.studio` — if that name is
   taken, change `studioHost` in `sanity.cli.ts`):
   ```bash
   npm run deploy
   ```
   Or run it locally with `npm run dev` → <http://localhost:3333>.

5. **Point the website at it.** In the server's `.env.production`:
   ```
   SANITY_PROJECT_ID=xmn0tjwm
   SANITY_DATASET=production
   SANITY_REVALIDATE_SECRET=<any long random string>
   ```
   and restart the web container.

6. **Instant updates on publish.** In sanity.io/manage → your project → *API* → *Webhooks* →
   *Create webhook*:
   - URL: `https://mashuphost.tech/cms/revalidate`
   - Dataset: `production`, Trigger on: create, update, delete
   - Filter: `_type == "homepage"`
   - HTTP method: POST, Secret: the same value as `SANITY_REVALIDATE_SECRET`

   Without the webhook, changes still show within five minutes.

## Editing

Open the Studio → **Homepage** → edit a tab (Top of page, Features, Customers, Pricing, Kenya
section, FAQ, Footer) → **Publish**. Drafts are never shown on the site.

FAQ answers are also sent to Google as structured data, so keep them true to what the product does.

## When the defaults in code change

`apps/web/src/lib/landing-content.ts` and `landing-sections.ts` are the built-in text. After
changing them, refresh the seed with
`pnpm --filter @mashupkgrid/web exec tsx scripts/sanity-seed.ts` (a web test checks the seed still
matches). Running `npm run seed` again **replaces** the Homepage document in Sanity.
