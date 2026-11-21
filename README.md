# Wave Team Pro

A multi-company workspace for staff, time, projects, expenses and company communications. One
platform runs several legal entities (companies) side by side, each with its own people, roles,
projects, timesheets, leave, expenses, settings, logo and reports; people can work in more than
one. People who run more than one company get the **Group Hub**: the whole group in one place.

Wave Team Pro is a white-label product: every deployment sets its own name, logo and companies,
and keeps its own data in its own Supabase project. Nothing in this repository belongs to any
customer.

| | |
|---|---|
| Stack | Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4, Zod 4 |
| Backend | Supabase (Auth, Postgres 17 with row-level security on every table, private Storage) |
| Hosting | Vercel (any region; `vercel.json` ships with `sin1`, change it to the region nearest your Supabase project) |
| Optional integrations | Microsoft 365 (Outlook invites and email from a shared mailbox, SharePoint filing, Planner / To Do project sync) via Microsoft Graph app-only; Xero expense export; AI receipt reading (Anthropic or OpenAI) |
| Tests | Vitest — unit, and integration against a real Postgres with every migration applied (RLS and escalation suites); Playwright E2E |

**Help:** the complete guide to deployment, integrations and updates is [HELP.md](HELP.md). The short versions are in [Help](#help) below.

## Your brand

Set these in the hosting environment (Vercel → Settings → Environment Variables); they are built
into the pages, so redeploy after changing them. Logos are uploaded in the app (Group Hub →
Settings for the group, Admin → Settings for each company).

| Variable | Default | Used for |
|---|---|---|
| `NEXT_PUBLIC_PRODUCT_NAME` | `Wave Team Pro` | Page titles, emails, reports, app name |
| `NEXT_PUBLIC_HUB_NAME` | `Group Hub` | The group-wide view |
| `NEXT_PUBLIC_GROUP_NAME` | `Group` | Short group name where a company name is missing |
| `NEXT_PUBLIC_EXAMPLE_DOMAIN` | `example.com` | Example email domain in forms |
| `NEXT_PUBLIC_EXAMPLE_COMPANY` | `Acme Ltd` | Example company name in forms |
| `NEXT_PUBLIC_DEMO_MODE` | off | `1` on a sales demo site (see docs/deploy/demo.md) |

## Modules

| Module | Default | How to switch it on |
|---|---|---|
| People, roles, time, leave, timesheets, tasks, projects, expenses, chat, announcements, documents, Company Communications | On | — |
| **Systems integration toolkit** (site imports, cables & patch panels, devices, switches, VLANs & IPs, racks, lighting loads, Lutron integration, drawings with layers, QR labels, client handover document) | Off | Per company: Admin → Settings → Modules → *Systems integration toolkit* |
| **Microsoft 365** (Outlook, SharePoint filing, Planner / To Do project sync) | Hidden | Add `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` ([docs/deploy/microsoft-365.md](docs/deploy/microsoft-365.md)); then switch on per company |
| **Email** (invitations, notifications, weekly timesheets) | Supabase built-in emails only | Add `EMAIL_PROVIDER_API_KEY` and `EMAIL_FROM` (Resend) |
| **AI receipt reading** | Manual entry | Add `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` |
| **Xero export** | Available in Expenses → Bookkeeping | — (file export, no keys needed) |

## Features

### Group Hub (group view, `/hub`)
For platform admins and anyone who manages staff in two or more companies. They land here on sign-in.

- **Overview** — every company with staff counts, who's clocked in, timesheets and expenses waiting, latest updates; live **Today's attendance** panel (clocked in / on break / clocked out, hidden when nobody has clocked in).
- **Group Hub clock** — choose company and project before clocking in; switch any time; the same status everywhere.
- **Attendance** — every clock-in and clock-out in all companies, day by day, live.
- **Updates** — notifications and announcements from every company.
- **All staff** — everyone, their companies, roles, departments, teams and status; add registered people straight into another company (no invitation); resend or copy invitation links (WhatsApp / email) for people who haven't joined.
- **Tasks** — every employee's tasks in every company, grouped by person, filterable by person, status, company and who added them (the employee or management).
- **Projects** — every company's projects; create a project in any company and staff it from the whole group; edit, set country, move a project between companies (copied if time or expenses were already booked).
- **Timesheets** — everyone's week, plus **Waiting for approval** across all weeks and companies with Approve / Return; Excel and PDF downloads for the whole group. Super admins may approve their own timesheets.
- **Expenses** — claims from every company with per-company totals.
- **Company Communications** — calendar invites and email updates (see below).
- **Settings** (super admins) — platform logo; **Outlook** (shared mailbox, automatic invites) when Microsoft 365 is set up.
- Mobile: bottom bar Overview · Clock · Updates · Staff · More; **Back** button on every page.
- **Hide menu** (bottom of the left menu, computers) gives the page the full width; **Menu** (top left) brings it back. Remembered per device. Pages use up to 1600 px of width.

### Inside each company (`/o/<company>`)
- Home dashboard with the clock, tasks, leave balance, expenses and announcements.
- **People & admin** — members, invitations (multi-company), roles with fine-grained permissions, departments, teams, audit log, settings, company logo (shown in the menu and on every PDF/Excel report).
- **Projects & tasks** — tasks assigned by management to one or more people (with notification); staff add notes and photos and report **Completed / In progress / Not completed** with reasoning; managers are notified. Every employee can also **add their own tasks** (personal, or on a project they work on). **Team tasks** shows management every employee's tasks, per person.
- **Project log** on every project: deliveries received, orders placed, issues, meetings and notes, each with date and time, supplier, reference, amount and photos or PDFs.
- **Project report** (Excel or PDF) per project: summary against budget, every task with assignees, status and what was reported, the project log, hours by person and expenses.
- **Systems integration toolkit (optional module).** The sections below (Site … QR labels) appear when a company switches the toolkit on in Admin → Settings → Modules.
- **Every project, in every company, has the same sections** — listed down the left of every project page (a sideways strip on phones): Overview; Site & imports, Cables & patch panels, Devices, Switches, VLANs & IPs, Racks, Lighting loads, Lutron integration; Drawings, QR labels, Passwords and Export. New projects get them automatically; there is nothing to set up per project.
- **Site** — imports a network spreadsheet (devices, patch panels, switch sheets, IP scheme, racks) and Lutron Designer's Integration Report and Load Schedule (PDF). Re-importing keeps what was typed in the app where the spreadsheet cell is blank. Usernames and passwords in spreadsheets are never imported.
- **Cables & patch panels** — columns start with Deck, Room / area, Cable, Patch panel · port, Cable no. Type straight into any cell (Enter saves, Esc cancels); test result dropdown (Not tested, Passed, Failed, Needs review, Re-test required) recorded as tested by you, today; length; full change history. Tick rows, or a whole patch panel, to set a common room, deck, cable type, system or test result; project managers can remove cables. **Tested by** is a drop-down of the project team (members + project manager) with a tick box per person, so a cable can be tested by several people; nobody ticked = whoever records the result. Tick rows and use **Set tested by…** for many at once. Excel, the project pack and the cable's history list everyone.
- **Devices** — same in-cell editing and bulk "set common value"; manufacturer picked from common AV / IT brands or the project's own (or typed); **Add a device** for anything not in the spreadsheet; status (planned → tested / fault); project managers can remove devices.
- **Switches** — every switch, router, firewall and PBX with its ports. Type into any port cell (port name, VLAN, patch port, location, end device, PoE W, IP, notes) or tick ports to set a common VLAN / location / device; **Edit switch details** (name, model, hostname, management IP, MAC, serial, firmware, location, PoE budget; renaming moves its ports); **+ Add a switch, router, firewall or PBX** with a numbered run of ports; **+ Add ports** (e.g. `Te1/1/` 1–4). The project team edits; only the project manager removes ports or switches.
- **Passwords** — usernames, passwords and login details for devices, networks, Wi-Fi, servers and online platforms, per project only (project → Passwords), optionally linked to a project device. Passwords are encrypted in Supabase Vault and only returned by `reveal_credential()` when someone presses the eye (hidden again after 30 s; copy buttons for username and password); every add, change, reveal and removal is logged and shown to managers. Permissions `credentials.view` / `credentials.manage` (sensitive; Super Admin and Project Manager by default, grant others in Roles & permissions). Never included in exports, the project pack, QR pages or the spreadsheet import (which still ignores the spreadsheet's username/password columns).
- **VLANs & IPs, Lighting loads, Lutron integration** — switch ports with PoE, VLANs and IPs with duplicate check, lighting loads (panel/module/loop, DALI address, status, bulk update) and the Lutron integration schedule (keypads, buttons, LEDs, zones, areas, scenes with integration IDs and engravings).
- **Racks** — built from the spreadsheet's rack sheet, or added by hand. Click or drag to move equipment between U positions; set height (1–20U), type, manufacturer and model; link to a project device; move between racks. Side panel lists every project device (and which rack it's in) plus parts: shelves, blanks, brush plates, patch panels, PDUs, UPSs, fan trays, or anything custom. Overlaps and items that don't fit are refused.
- **Drawings** — GA and discipline drawings as PDF, PNG, JPEG or WebP (images become a one-page PDF in the browser, turned upright from phone EXIF), up to 50 MB, with revisions, in a zoomable viewer that stays sharp on large sheets. **Layers** per drawing (e.g. Access points, Keypads, Speakers): create, rename, show/hide, "show only this", draw on the active layer. Place keypads, touch panels, access points, speakers, TVs, cameras… or a specific project device / Lutron keypad; drag to move. **Download** the drawing as a PDF with the ticked layers marked on it (correct on rotated CAD sheets) and a **device legend** by default: the symbols used with how many of each, then every device on the sheet — tag/label, type, linked project device (name, make and model, deck/room, IP) or Lutron keypad (model, engraving) and the marker's notes, sorted by type and number. The sheet is made bigger and the legend goes in a white panel beside the drawing (to the right, or below a long wide sheet such as a deck GA), so it never covers the drawing, with the project company's logo at the top of the panel (and on the extra legend pages); a list too long for the panel continues on A3 legend pages at the end of the PDF. Untick **Device legend** for just the symbol key. The project pack uses the same legend.
- **How the drawing saves** — what you place, move or draw shows at once and is saved in the background, in the order you did it (new items get their id in the browser, so they can be dragged, connected or edited straight away). The page's data is only refreshed once saving has been quiet for a moment and nothing is being dragged, so a save never redraws the sheet or moves anything under the pointer. If a save fails, a red message says so and the drawing reloads what was actually saved. Drags are drawn once per screen frame; a symbol is anchored on its centre (the label sits beside it), and a faint preview shows what the next click will place or snap onto.
- **Control boxes, lighting panels and racks** — besides round device dots, a drawing can carry square boxes: **Shades** (Lutron shade control box, SH), **Lighting panels** (distribution-board style, LP) and **Racks** (R). Add them from the layer buttons (**+ Shades**, **+ Lighting panels**, **+ Racks**) or **Place a…**; the **Racks & panels** tab lists the project's racks and the lighting panels from the load schedule to place each one by name. A rack on the drawing can be linked to a project rack (Edit marker → Project rack), and a cable drawn to a linked rack is set to "goes to" that rack automatically. Boxes export as squares in the PDF and legend.
- **Cable runs (line schematics)** — on each layer, **Draw cables** draws the cabling in that system's colour (the layer's colour; click the colour dot to change it — devices and cables on the layer follow it). Click a device (or anywhere) to start, click to add bends, click devices to chain them (keypad → keypad → keypad), double-click or Enter to finish. **Straight lines (90°)** is on by default: every run is horizontal / vertical with right-angle bends, and nearly-straight clicks are lined up; hold Shift for a free angle, F flips which way a bend turns, Backspace undoes a point, Esc cancels. Clicks snap onto devices and onto other runs' bends. A run connected to a device follows it when the device is dragged. Click a run to select it: a bar above the drawing shows what it connects with **Edit details**, **Extend from end / start** (carry on drawing from either end), **Delete** (or the Delete key; Esc deselects). In the edit box, name it, set the cable type (CAT6A, Lutron QS, DALI, speaker cable…), the **rack it goes to** (shown as "→ Rack 3" at its end), notes or another layer; drag its white squares (bends) or white bars (straight parts) to re-route (the run stays square), double-click a square to remove the bend. Runs show, hide and download with their layer: the PDF draws them in colour under the devices and lists them in the legend (label, type, devices connected, rack). Stored in `drawing_cables` (migration `20261114000100_drawing_cables`).
- **QR labels** — printable QR stickers (A4 sheets: 21 small or 8 large) for the project, racks, patch panels, switches, lighting panels and drawings, with the company logo. Scanning opens the live page: a rack shows its elevation, its patch panels (with their schedules) and the switches in that room; a patch panel shows its cable schedule; a lighting panel shows every module, output and load on it. Codes are short links (`/q/<code>`) that only open for signed-in people on the project.
- **Export** — one branded **project pack** PDF (project managers and super admins): cover with the company logo and project details, contents with page numbers, project report, every schedule above, rack elevations drawn to scale and each current drawing with its layers. Pick sections with tick boxes; hours and expenses are off by default for client packs. Excel exports remain on each schedule page.
- **Time** — schedule (shifts), attendance with corrections, clock-in by project, timesheets filled from clock-ins, approvals, weekly all-staff timesheets (emailed every Monday, Excel and PDF).
- **Leave** — requests, balances, approvals.
- **Expenses** — receipt capture with AI reading, approvals, reimbursements, company cards, Xero export, bookkeeping periods.
- **Chat, announcements, documents, notifications.**
- **SharePoint filing** — receipts, expense months, timesheets and Xero exports saved into a per-company folder structure.
- **Microsoft 365 projects** — each project gets a private Microsoft 365 group and Planner plan; tasks, the project log and dates show up in Planner, To Do and Outlook for the project team (never PAs or HR).

### Basic staff accounts
Employees see only what they need: clock in (their project is assigned by management), timesheets,
leave, expenses, their tasks (and tasks they add for themselves) and Company Communications sent
to them. They can't assign tasks to others, pick projects or edit what management assigned.
Their own tasks are visible to them and to management (Super Admin, Admin / PA, Director,
HR Manager, Project Manager, Team Leader — permission `tasks.view.all`), not to colleagues.

### Company Communications and Outlook (with Microsoft 365)
Sent from one shared mailbox (set in Group Hub → Settings → Outlook) through Microsoft Graph.

- **Travel information** — from, to, departure and arrival (each in its own time zone), transport, accommodation, notes → calendar invite.
- **Meeting** — date, time, place or Teams link, agenda → calendar invite.
- **Company update / Project update** — title and notes → email (recipients blind-copied).
- Recipients: everyone in chosen companies, project teams, and/or named people.
- Attachments (up to 5 files, 3 MB each), a saved **email signature** per sender, full time zone picker grouped by region.
- **Automatic invites** (switchable): task due dates, shifts, project assignments, approved leave — with updates and cancellations when they change.
- Who can send: Super Admin, Admin / Virtual Assistant (PA), Director, HR Manager, Project Manager, Team Leader. Everyone receives.

- **Other spreadsheet layouts**: the same import (Project → Site → Import → "Network spreadsheet or cable schedule") also reads patch panels stacked on one sheet under "Patch Panel <name>" titles, a WLAN sheet keyed by cable number, a CCTV camera sheet, and an IP scheme with named VLANs (the VLAN number is taken from the address range, e.g. 192.168.90.x → 90). A separate **cable schedule** (FROM / TO columns) is matched to the project's cables by cable number: blanks never overwrite, a cable already on the platform keeps its patch panel and port (a different one in the schedule is written in its notes), and new cables are added at the schedule's patch panel port. Import the network spreadsheet first, then the cable schedule. LOGIN sheets and username/password columns are never read.

### Staff calendar and travel

- **Group Hub → Staff calendar** (`/hub/staffing`) shows every company in one month view; each company has its own (**Staff calendar** in the left menu). Each day lists who is **assigned** to which project (outlined dot), who is assigned **and clocked in** there (filled dot) and who clocked in on a project without an assignment (dashed). Approved leave and travel bookings show on the same days. Filter by company, project or person; click a day for the full list.
- **Assign staff** (under the calendar): company → project → tick people → first and last day → notes. Before saving it warns if someone is already on another project or on approved leave ("Assign anyway" saves regardless). Each person gets an Outlook calendar invite from the shared mailbox; changing the dates updates it, removing them cancels it.
- **Needs travel & accommodation**: the project company's travel coordinators get one email request (leads in To, others copied) and a **Travel** badge in the menu. They open the request, add each flight, hotel, train, car or transfer (local times and time zones, booking reference, confirmation PDF) and each booking becomes an Outlook invite for the traveller with the confirmation attached. Date changes and cancellations are emailed to the coordinators automatically.
- **Changing or cancelling a trip**: people assigned together are one trip. Under the calendar, **Trips in <month>** lists them with **Change** and **Cancel trip**; on an assignment, choose "Everyone on this trip" or "Only <name>". Outlook invites update or cancel; new dates send the travel team, travellers and requester one email listing the bookings to change (and the request page shows "The dates of this trip changed"); a cancellation cancels the request and every booking invite and emails the same people. Coordinators adding, changing or removing a booking email the travel team and requester (the traveller gets the Outlook invite/update/cancellation); setting **Booked — all done** emails the traveller the full trip, copied to the travel team and requester.
- **Who handles travel**: Company → Travel → "Who handles travel" (company admins).
- Permissions (Admin → Roles): `staffing.view` (super admin, director, project manager, HR manager, admin/VA), `staffing.assign` (super admin, director, project manager), `travel.manage` (super admin, admin/VA). Travel coordinators can handle travel even without `travel.manage`.

### Microsoft 365 projects (Planner / To Do)
Switched on per company in **Hub → Settings → Microsoft 365 projects** (or **Admin → Microsoft 365 projects** inside a company); off by default.

- Every *planning* or *active* project gets a private Microsoft 365 group **“Project – {name}”** with a Planner plan and three buckets: **Tasks**, **Updates**, **Dates**.
- **Members**: the project's team (project members, the manager and staff assigned to the project) who have an account in your Microsoft 365 tenant. **PAs and HR are never added**; people without a tenant account (e.g. Gmail) are skipped and listed in the sync report. The sync only removes members it added itself.
- **Tasks**: Hub tasks become Planner tasks (title, due date, priority, assignees, notes), so they appear in each person's **Microsoft To Do → Assigned to me**. Completion is two-way: ticking a task done in To Do / Planner / Teams marks it done in the Hub and vice versa (latest change wins). Other fields follow the Hub.
- **Updates**: the project log is mirrored into a pinned **“📌 Project updates”** task.
- **Dates**: project start and end become dated Planner tasks (shown in To Do and Outlook). Group calendars and group conversations can't be written with app-only permissions, so they aren't used.
- **Pilot**: `m365_sync_settings.project_ids` limits the sync to listed projects (null = all eligible projects).
- **Schedule**: daily at 00:00 UTC (`/api/cron/m365-sync`, Vercel Hobby allows daily crons only) and on **Sync now**.
- **Microsoft Graph application permissions** (admin consent): `Group.ReadWrite.All`, `GroupMember.ReadWrite.All`, `Tasks.ReadWrite.All`, `User.Read.All`. After granting new permissions, redeploy so the cached app token is refreshed.

### Languages
The **language picker** in the top bar (and on the sign-in pages) switches the whole interface between **English, ไทย (Thai), Română and Suomi (Finnish)**. The choice is remembered on that device (cookie `wbh-lang`, one year).

- How it works: every interface phrase is extracted from the source into `src/lib/i18n/ui/source.json`; translations live in `src/lib/i18n/ui/{th,ro,fi}/NN.json` and are built into `public/i18n/{lang}.json`. A small client script (`src/components/layout/ui-translator.tsx`) translates the page as it renders, including text that appears later (dialogs, toasts, new rows). The page is hidden for a moment until it is translated, so English never flashes.
- **Not translated**: data people type (project names, notes, messages, device names), emails and calendar invites, and downloaded reports (PDF / Excel / Xero files) — these stay in English so everyone receives the same document.
- **Adding or changing interface text**: run `node scripts/i18n-extract.mjs`, then `node scripts/i18n-build.mjs --chunk` to list the new phrases, add their translations (`node scripts/i18n-split.mjs NN.json` for `[en, th, ro, fi]` rows), and `node scripts/i18n-build.mjs`. A phrase with no translation simply shows in English.

## Android app

`android/` is an optional Android app: a Trusted Web Activity that opens your deployment full screen,
with links to it (QR stickers, emails) opening in the app. Everything stays in the web app.

- **Build**: GitHub → Actions → *Android app* → *Run workflow*, entering your site's host name, an
  Android package id (e.g. `com.yourcompany.team`) and the name under the icon. It attaches an
  **unsigned** `.aab` and `.apk` (plus `apksigner.jar`) to a pre-release `android-build-<n>`.
- **Sign** with your own upload key (never store it in GitHub):
  `java -jar apksigner.jar sign --ks upload-key.jks --ks-key-alias upload --out App.apk wave-team-pro-unsigned.apk`
  and `jarsigner -keystore upload-key.jks -sigalg SHA256withRSA -digestalg SHA-256 App.aab upload`.
- **Full screen** needs `public/.well-known/assetlinks.json` to hold your package id and the SHA-256 of
  every key the app is signed with: your upload key and, after the first Play upload, Google's **app
  signing key** (Play Console → Test and release → App integrity → App signing → SHA-256). Without a
  match the app still works but shows a small browser bar.
- Play listing graphics: `android/store/` (512 px icon, 1024×500 feature graphic) — replace with your own.

## Roadmap

Agreed next steps, not built yet:

- **Offline / on-site server**: a local copy on the site's network so pages and QR codes open
  without internet, syncing when the connection is back.
- **Snags on drawings**: pin a defect on a drawing with a photo, owner and due date.
- **Fluke cable-test import**: read tester result files and fill in test results and lengths.
- **Commissioning checklists** per system, with sign-off.
- **Equipment library and bill of materials** from devices and rack contents.
- **Photo progress** per room / area.
- **Project dashboard**: cables tested, devices installed, loads commissioned, open snags.
- **Weekly client email** with progress.
- **SharePoint link** for the project pack and drawings.
- **Project templates** (racks, layers, checklists) for new projects.
- **Global search** across cables, devices, racks and drawings.

## Roles

| Role | Typical use |
|---|---|
| Super Admin | Everything in the company; cannot be edited; one per company minimum |
| Admin / Virtual Assistant | PA: invites people, structure, announcements, communications |
| Director | Oversight: reports, all attendance and expenses, approvals |
| HR Manager | People records, leave approvals, HR files |
| Project Manager | Projects, tasks, project time approval |
| Team Leader | Team attendance, leave and timesheet approvals |
| Bookkeeper | Expense review, export and reimbursement |
| Employee | Basic account (see above) |

Roles are per company; a person can hold several. Permissions are enforced in Postgres (RLS and
security-definer functions), not only in the UI.

## Configuration (Vercel → Settings → Environment Variables)

Never commit values. Mark secrets **Sensitive**.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only trusted writes |
| `APP_BASE_URL` | Links in emails and invites |
| `RATE_LIMIT_SALT`, `CRON_SECRET` | Rate limiting, cron authentication |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | Microsoft 365 (Outlook, SharePoint and project sync) |
| `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM` | Transactional email (Resend) |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` | Receipt reading |

Microsoft 365 setup is in [HELP.md §5.4](HELP.md#54-microsoft-365-outlook-sharepoint-planner) and [docs/deploy/microsoft-365.md](docs/deploy/microsoft-365.md).

Scheduled jobs (`vercel.json`): weekly timesheets every Monday 06:00 UTC; SharePoint filing and
Outlook retries daily 00:30 UTC; Microsoft 365 project sync daily 00:00 UTC. Outlook changes are otherwise sent within seconds.

## Help

Full step-by-step instructions, click by click: **[HELP.md](HELP.md)**.

### Deployment (new customer) — short version
1. **Supabase**: New project → Authentication → Sign In / Providers → Email: sign-up **off**,
   confirm email **on** → URL Configuration: Site URL and `/auth/confirm` redirect → Emails →
   Templates: paste `supabase/templates/*.html` → SMTP Settings: your sender.
2. **Database**: `npx supabase link --project-ref <ref>` then `npx supabase db push`
   (or run every file in `supabase/migrations/` in order in the SQL Editor). Never run the seed or demo files.
3. **Vercel**: New project from this repository → add `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_BASE_URL`, `RATE_LIMIT_SALT`,
   `CRON_SECRET` → **Deploy** → Settings → Domains: add the customer's address.
4. **First sign-in**: create the owner in Supabase → Authentication → Users, make them platform
   owner with SQL (HELP.md 4.1) → sign in → `/platform` → create each company and invite its Super Admin.
5. Check invitations, password reset and a basic employee account (HELP.md 4.4).

Details: [HELP.md §3–4](HELP.md#3-deployment-setting-up-a-new-customer).

### Integrations — short version
| Integration | Turn it on |
|---|---|
| Email | Resend domain + API key → `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`; same sender in Supabase SMTP ([HELP §5.1](HELP.md#51-email-resend)) |
| AI receipt reading | `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` ([§5.2](HELP.md#52-ai-receipt-reading)) |
| Xero | Nothing to set up: Expenses → Bookkeeping → **Export to Xero** ([§5.3](HELP.md#53-xero-expenses)) |
| Microsoft 365 (Outlook, SharePoint, Planner) | Entra app registration + permissions + `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, then switch on per company ([§5.4](HELP.md#54-microsoft-365-outlook-sharepoint-planner)) |
| Android app | Actions → **Android app** → **Run workflow**, sign, upload to Play ([§5.5](HELP.md#55-android-app-optional)) |
| Systems integration toolkit | Per company: Admin → Settings → Modules |

Redeploy in Vercel after changing any environment variable.

### Updates — short version
1. Change and test on `Main`: `pnpm check` and the integration tests.
2. Add the release to `CHANGELOG.md`, bump `version` in `package.json`, commit, tag `vX.Y.Z`, push.
3. Back up each customer's database if the release has new migrations.
4. Apply new migrations to **every** customer's Supabase (`npx supabase link` + `npx supabase db push` per customer).
5. Move the `release` branch to `Main` and push; every customer's Vercel project rebuilds.
6. Check each deployment is **Ready**. Roll back with Vercel → Deployments → **Instant Rollback**.

Details, the `release` branch setup and rollback: [HELP.md §6–7](HELP.md#6-updates).
Problems: [HELP.md §9 Troubleshooting](HELP.md#9-troubleshooting).

## Development

```bash
pnpm install
cp .env.example .env.local        # fill in Supabase values (see docs/deploy/local-development.md)
npx supabase start                # local Supabase (Docker)
npx supabase db reset             # applies migrations + synthetic seed
pnpm dev
```

Demo accounts after `db reset` (local only): `owner@demo.test`, `alice@demo.test`,
`bob@demo.test`, `ioana@demo.test` — password `DemoPass-2026!`.

| Command | What it does |
|---|---|
| `pnpm typecheck` | TypeScript, strict |
| `pnpm lint` | ESLint (Next.js + React Compiler rules) |
| `pnpm test:unit` | Pure logic: permissions, validation, exports, Outlook calls (mocked), time zones |
| `pnpm test:integration` | Throwaway Postgres with every migration; RLS, escalation, multi-company, tasks, Outlook queue |
| `pnpm test:e2e` | Playwright smoke suite; `E2E_SUPABASE=1` adds full journeys |
| `pnpm check` | All of the above except E2E, plus a production build |

Releasing to customers is described in [HELP.md §6](HELP.md#6-updates). Database changes are SQL migrations in
`supabase/migrations/`, applied in order.

## Layout

```
src/app/hub/               Group Hub (group view): overview, attendance, staff, projects, timesheets,
                           expenses, communications, Outlook, settings
src/app/o/[org]/           one company's workspace
src/app/(auth)/, auth/     sign-in, password reset, invitations, MFA
src/app/api/cron/          weekly timesheets, SharePoint + Outlook, Microsoft 365 project sync
src/lib/                   env, Supabase clients, auth, permissions, validation, time, time zones,
                           exports (PDF/Excel), SharePoint and Outlook (Microsoft Graph)
src/lib/import/            Network spreadsheet and Lutron PDF parsers
src/lib/drawings/          drawing markup → PDF (stamp.ts), image → PDF
src/lib/site-constants.ts  labels shared by server pages and client tables (keep plain values out of "use client" files)
src/components/site/       editable schedules, rack editor, imports, export form
src/components/drawings/   PDF viewer and drawing markup with layers
src/server/actions/        Server Actions (every one re-authorizes)
src/server/services/       data loaders (user-scoped client → RLS applies), sync workers
supabase/migrations/       schema, RLS, guards, audit, storage, triggers
tests/{unit,integration,e2e}
docs/{architecture,security,deploy}
```

Read [docs/architecture/overview.md](docs/architecture/overview.md) first.

### Company logos on exports
Every download carries the logo uploaded for the company (Admin → Settings → Company logo, or Hub → Settings): reports, timesheets, expenses, weekly reports, the project pack, QR labels, site schedules (Excel) and drawing PDFs (in the legend panel). Project exports always use the logo of **the company the project belongs to**, whichever company page it was opened from. CSV files for Xero carry no logo.

### QR stickers open PDFs
Scanning a QR sticker (`/q/<code>`) no longer opens the platform page: it opens a **PDF made at that moment from the live data**, shown in the phone's browser so it can be read or saved (`src/app/q/[code]/file/route.ts`, `src/server/services/qr-doc.ts`). Stickers already printed keep working — the code is the same, only what it opens changed.
- **Rack** → what is in each U, the cable schedule of each of its patch panels, the port schedule of the switches in that room, and the rack elevation.
- **Patch panel** → that panel's cable schedule (every port, spare ones included). **Switch** → its port schedule. **Lighting panel** → its loads by module and output.
- **Drawing** → the drawing with all its layers, cables and legend (the newest revision, even from an old sticker).
- **Project** → every site schedule and the rack elevations in one PDF (no hours, expenses or drawings).
Each PDF carries the company logo, the time it was made and the address of the live page. Sign-in and access to the project are still required, and the PDF only contains what the person scanning may see.

## Clock times follow the project's time zone

Every project has a **Time zone** (Projects → project → Edit, and on the new-project forms; a project without one
follows its company). Clock events are still stored as UTC
instants; only the display and the day boundaries change:

- the clock panel, Attendance pages, Group Hub attendance, weekly timesheet view and exports show a clock-in in the
  local time of the project it was clocked into (with the city shown next to it);
- hours per day (calendar, timesheet "clocked" column, weekly report, auto-filled timesheet lines) count a session on
  the day it started **in its project's zone**;
- management notifications and e-mails use the project's zone; without a project the company's zone is used.

Helpers: `zoneOfProject`, `punchZones`, `minutesByDayZoned` (`src/lib/time.ts`) and `projectZones` (`src/server/services/project-zones.ts`).

## Resend a travel request

If the travel team (PA) missed the request email, anyone who can assign staff (or handle travel) can send it again:
**Staffing calendar → "Trips in <month>" → Resend travel request** (all people on the trip in one email),
the same button on the assignment page's *Travel & accommodation* panel, on the travel request page, and in the
**Travel** list. It shows only while the request is *Requested* or *Being booked* and emails the coordinators
("Reminder — travel request", including bookings already made) plus an in-platform notification (`resendTravelRequest`).

## Client handover document

**Projects → project → Export → Client handover document** (also linked from the Site page) downloads a branded PDF
for the client to sign: cover and contents, the complete equipment list (grouped by system, with models and serial
numbers), and for each **system** (or, if chosen, each **area** = deck + room) a page with what the system does, the
equipment with **Installed** and **Working** tick boxes, functional checks to tick, a remarks area and a client + contractor
**signature / date block**, followed by a final acceptance page. Options: sign-off per system or per area; pre-tick
the boxes from the recorded device status (installed → Installed; commissioned/tested → Working) or leave them blank
for the site walk-round; client name for the signature blocks. Built from the Devices page by `buildHandover`
(`src/lib/handover/build.ts`), which holds standard wording for common systems (Wi-Fi, LAN/WAN, CCTV, AV, Lutron,
HVAC, telephony, antennas) and a generic text for any other system code. Project managers and super admins only.

Handover options (Export page panel): tick the **scope** (installation, system check, commissioning, programming,
technical support; decides the tick columns), the **systems** to include, and the **parts** to print (equipment list,
system functions, tick boxes, functional checks, remarks lines, signature blocks, final acceptance). Route query:
`scope=`, `sys=` (omit = all systems) and `off=` (parts left out).

## Licence

Proprietary — see [LICENSE](LICENSE). Not open source.
