# Wave Team Pro — Help

The complete guide to installing, connecting, running and updating Wave Team Pro.
Follow the parts in order the first time; after that, jump to what you need.

**Contents**

1. [How it fits together](#1-how-it-fits-together)
2. [What you need before you start](#2-what-you-need-before-you-start)
3. [Deployment: setting up a new customer](#3-deployment-setting-up-a-new-customer)
4. [First sign-in and company setup](#4-first-sign-in-and-company-setup)
5. [Integrations](#5-integrations)
6. [Updates](#6-updates)
7. [Backups and rollback](#7-backups-and-rollback)
8. [Everyday use: quick help for admins and staff](#8-everyday-use-quick-help-for-admins-and-staff)
9. [Troubleshooting](#9-troubleshooting)
10. [Reference: every setting](#10-reference-every-setting)

---

## 1. How it fits together

| Piece | What it is | One per |
|---|---|---|
| **GitHub repository** (`Wave-Team-Pro`) | The code. Every customer runs the same code. | — (one for everyone) |
| **Supabase project** | The customer's database, sign-in accounts and stored files (receipts, drawings, logos). | Customer |
| **Vercel project** | The customer's website, built from the GitHub code, with the customer's settings. | Customer |
| **Domain** | The address staff open, e.g. `team.acme.com`. | Customer |

Inside one customer's site:

- A **company** is one legal entity (its own staff, roles, projects, timesheets, expenses, logo).
  A customer can have one company or many.
- The **Group Hub** (`/hub`) shows every company together, for people who run more than one.
- A **platform owner** can create companies. Nobody else can.

Customers never share a database or a website, so one customer can never see another's data.

---

## 2. What you need before you start

| Account | Plan | Why |
|---|---|---|
| GitHub (with access to `Wave-Team-Pro`) | Any | Holds the code; Vercel builds from it |
| Supabase — https://supabase.com | **Pro** for paying customers | Free projects pause after a week without use and have no daily backups |
| Vercel — https://vercel.com | **Pro** for paying customers | The free Hobby plan is for non-commercial use only |
| Resend — https://resend.com (recommended) | Free tier is fine to start | Sends invitations, password resets and notifications |
| The customer's domain (DNS access) | — | So staff open `team.theircompany.com` |

On your computer (only needed for the command-line steps): **Node.js 22**, **pnpm 10**
(`npm install -g pnpm`), and **Git**.

---

## 3. Deployment: setting up a new customer

About an hour. Do the steps in this order.

### 3.1 Create the Supabase project

1. Open https://supabase.com/dashboard and click **New project** (top right).
2. **Organization**: yours. **Project name**: the customer, e.g. `acme-team`.
   **Database password**: click **Generate a password**, then save it in your password manager.
   **Region**: the one nearest the customer's staff.
3. Click **Create new project** and wait about 2 minutes until the dashboard opens.

### 3.2 Set up sign-in

1. In the left menu click **Authentication**, then **Sign In / Providers**.
2. Click **Email**. Switch **off** "Allow new users to sign up" (only invited people can join).
   Switch **on** "Confirm email". Click **Save**.
3. In the left menu (still under Authentication) click **URL Configuration**.
   - **Site URL**: the customer's address, e.g. `https://team.acme.com` (no slash at the end).
   - Under **Redirect URLs** click **Add URL** and enter `https://team.acme.com/auth/confirm`. Save.
4. Click **Emails** (under Authentication), then the **Templates** tab. For each template below,
   open it, replace the subject and body with the file from the repository, and click **Save**:

   | Supabase template | File in the repository | Suggested subject |
   |---|---|---|
   | Invite user | `supabase/templates/invite.html` | You're invited to Wave Team Pro |
   | Reset password | `supabase/templates/recovery.html` | Reset your Wave Team Pro password |
   | Confirm signup | `supabase/templates/confirmation.html` | Confirm your email for Wave Team Pro |

   If the customer uses their own product name, change "Wave Team Pro" in the subject and body.
5. Still in **Emails**, open the **SMTP Settings** tab and set up a real sender (see
   [5.1 Email](#51-email-resend)). Without it Supabase sends only a few emails per hour.
6. In the left menu click **Authentication → Multi-Factor** and make sure **TOTP (App
   Authenticator)** is enabled.

### 3.3 Create the database tables

Use **one** of these two ways.

**Way A — command line (recommended: Supabase then remembers what's applied, which makes updates easy)**

1. Open a terminal in your copy of the repository (`git clone https://github.com/adriankobsin/Wave-Team-Pro`, then `cd Wave-Team-Pro`).
2. Run `npx supabase login` and approve in the browser.
3. Find the **project ref**: in Supabase click **Project Settings** (cog, bottom of the left
   menu) → **General**; copy **Project ID**.
4. Run `npx supabase link --project-ref <Project ID>` and enter the database password from 3.1.
5. Run `npx supabase db push` and answer **Y**. It applies every file in `supabase/migrations/`.

**Way B — copy and paste**

1. In Supabase click **SQL Editor** in the left menu, then **+ New query**.
2. Open the first file in `supabase/migrations/` (they are named by date; start with the oldest),
   copy all of it, paste it into the editor and click **Run** (bottom right). It should say
   "Success".
3. Repeat for every file, in name order, one at a time.
4. Keep a note of the last file you ran — you'll need it for updates (see [6.3](#63-releasing-an-update-step-by-step), step 5).

Never run `supabase/seed.sql` or anything in `supabase/demo/` on a customer's project: they
create fake people.

Finally, in the left menu click **Advisors → Security Advisor** and check there are no errors.

### 3.4 Copy the Supabase keys

1. Click **Project Settings** (cog) → **API Keys** (in newer dashboards; older ones say **API**).
2. Copy and keep for the next step:
   - **Project URL** (also under **Project Settings → Data API**), e.g. `https://abcd1234.supabase.co`
   - **anon / publishable** key
   - **service_role / secret** key — this one can read everything; never put it anywhere except Vercel.

### 3.5 Create the Vercel project

1. Open https://vercel.com/new.
2. Under **Import Git Repository**, find **Wave-Team-Pro** and click **Import**. (First time:
   click **Install** / **Adjust GitHub App Permissions** and allow Vercel to see the repository.)
3. **Project Name**: the customer, e.g. `acme-team`. **Framework Preset**: Next.js (detected
   automatically). Leave the build settings as they are.
4. Open **Environment Variables** on the same page and add these (Key, then Value, then **Add**):

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL from 3.4 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key |
   | `APP_BASE_URL` | `https://team.acme.com` (no slash at the end) |
   | `RATE_LIMIT_SALT` | a random value (see below) |
   | `CRON_SECRET` | a different random value |

   For a random value run `openssl rand -hex 32` in a terminal, or use a password generator with
   64 letters and numbers.

   Optional now or later: your brand (see [10](#10-reference-every-setting)), email
   ([5.1](#51-email-resend)), receipt reading ([5.2](#52-ai-receipt-reading)), Microsoft 365
   ([5.4](#54-microsoft-365-outlook-sharepoint-planner)).
5. Click **Deploy** and wait for "Congratulations" (about 3 minutes).
6. Open the project, then **Settings** (top tabs) → **Environment Variables**. Click the
   **⋯** next to `SUPABASE_SERVICE_ROLE_KEY` → **Edit** → tick **Sensitive** → **Save**.
7. **Settings → Functions → Function Region**: choose the region nearest the Supabase project
   (the repository's `vercel.json` sets `sin1`, Singapore; Vercel uses that unless you change it
   in `vercel.json` for everyone). Save, then redeploy (see 3.7).

### 3.6 Add the customer's domain

1. In the Vercel project click **Settings → Domains → Add Domain**.
2. Enter `team.acme.com` and click **Add**.
3. Vercel shows a DNS record (usually a **CNAME** to `cname.vercel-dns.com`). Ask whoever runs
   the customer's DNS to add it. It turns green within minutes to a few hours.
4. Make sure `APP_BASE_URL` (Vercel) and **Site URL** (Supabase, 3.2) both use this address.

### 3.7 Redeploy after changing settings

Settings are only picked up by a new build. In Vercel: **Deployments** tab → the **⋯** on the
newest deployment → **Redeploy** → **Redeploy**.

---

## 4. First sign-in and company setup

### 4.1 Make yourself (or the customer) the platform owner

1. Supabase → **Authentication → Users** → **Add user** (top right) → **Create new user**.
   Enter the email and a password, tick **Auto Confirm User**, click **Create user**.
2. Supabase → **SQL Editor → + New query**, paste (with that email) and click **Run**:

   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = 'owner@acme.com';
   ```

### 4.2 Create the companies

1. Open the customer's address and sign in as the platform owner.
2. Open `https://team.acme.com/platform`.
3. For each company fill in **Name**, **Web address** (short, e.g. `acme-uk`; can't be changed
   later), **Country**, **Base currency**, **Time zone**, and the **first Super Admin**'s name and
   email. Click **Create organization and send invitation**. The Super Admin gets an invitation email.

### 4.3 What each company's Super Admin does next

1. Accepts the invitation, sets a password (and, if asked, two-step verification).
2. **Admin → Settings**: uploads the **Company logo**; checks country, currency and time zone;
   sets **Leave types** and **Public holidays**.
3. **Admin → Settings → Modules**: ticks **Systems integration toolkit** if the company installs
   AV, IT, security or lighting systems. Click **Save settings**.
4. **Admin → Structure**: adds departments and teams.
5. **Admin → Roles**: reviews what each role may do.
6. **Admin → Invitations**: invites staff (they can be in several companies at once).
7. Group logo (people who run several companies): **Group Hub → Settings → Platform logo**.

### 4.4 Checks before handing over

- [ ] An invitation email arrives and its link opens the customer's address (not localhost).
- [ ] "Forgot password" sends an email that works.
- [ ] A basic employee account sees no **Admin** menu.
- [ ] Clock in, clock out and submit a timesheet as a test employee; approve it as a manager.
- [ ] Supabase **Advisors → Security Advisor** shows no errors.
- [ ] Supabase **Database → Backups** shows daily backups (Pro plan).

---

## 5. Integrations

Everything here is optional. Each one stays switched off or hidden until it is set up.

### 5.1 Email (Resend)

Used for invitations, management alerts, weekly timesheets and travel requests.

1. Sign in at https://resend.com → **Domains → Add Domain** → enter the customer's domain
   (e.g. `acme.com`) → add the DNS records Resend shows → wait for **Verified**.
2. **API Keys → Create API Key** → name it after the customer, permission **Sending access** →
   copy the key (starts with `re_`).
3. In Vercel (**Settings → Environment Variables**) add:
   - `EMAIL_PROVIDER_API_KEY` = the key (tick **Sensitive**)
   - `EMAIL_FROM` = `Acme Team <team@acme.com>` (an address on the verified domain)
4. Also give Supabase the same sender for sign-in emails: Supabase → **Authentication → Emails →
   SMTP Settings** → **Enable Custom SMTP**:
   - Sender email `team@acme.com`, Sender name `Acme Team`
   - Host `smtp.resend.com`, Port `465`, Username `resend`, Password = the Resend API key
   - **Save**.
5. Redeploy Vercel (3.7). Test: invite yourself from **Admin → Invitations**.

### 5.2 AI receipt reading

Staff photograph a receipt and the merchant, date, amounts and VAT are filled in for them.
Receipts are sent to the provider you choose; staff see a notice saying so.

1. Get an API key from Anthropic (https://console.anthropic.com → **API Keys**) or OpenAI.
2. In Vercel add:
   - `AI_PROVIDER` = `anthropic` or `openai`
   - `AI_API_KEY` = the key (tick **Sensitive**)
   - `AI_MODEL` = a current vision-capable model id from the provider's documentation
     (for example `claude-sonnet-5-5` for Anthropic)
   - `AI_BASE_URL` = only if you use a proxy or compatible service; otherwise leave it out.
3. Redeploy. Test: **Expenses → New expense** → take or upload a receipt photo.

### 5.3 Xero (expenses)

No keys needed — it's a file export.

1. In a company open **Expenses** → **Bookkeeping** (button at the top right; needs the
   *expenses export* permission, e.g. Bookkeeper or Super Admin).
2. Fix anything under **Needs attention**, then click **Export to Xero**.
3. In Xero: **Business → Bills to pay → Import**, choose the file and **Tax inclusive**. Card
   statement files: **Accounting → Bank accounts →** the card → **Import a statement**.
4. VAT rates and account codes are matched by name/code as set on the Bookkeeping page
   (**VAT & accounts**).

### 5.4 Microsoft 365 (Outlook, SharePoint, Planner)

Three features share one Microsoft app registration:

| Feature | What it does |
|---|---|
| **Outlook** | Calendar invites and email updates from one shared mailbox (Company Communications, task due dates, shifts, project assignments, approved leave) |
| **SharePoint filing** | Files receipts, monthly expenses, timesheets and Xero exports into the customer's SharePoint |
| **Microsoft 365 projects** | Each project gets a private Microsoft 365 group with a Planner plan; tasks appear in To Do |

The customer's **Microsoft 365 administrator** does steps 1–4.

**Step 1 — Register the app**

1. Open https://entra.microsoft.com → **Identity → Applications → App registrations** →
   **+ New registration**.
2. **Name**: `Wave Team Pro` (or the customer's product name). **Supported account types**:
   *Accounts in this organizational directory only*. Leave Redirect URI empty. Click **Register**.
3. On the app's **Overview** page copy the **Application (client) ID** and
   **Directory (tenant) ID**.
4. **Certificates & secrets → Client secrets → + New client secret** → expiry 24 months → **Add**.
   Copy the **Value** immediately (it is shown once). Put a reminder in the calendar to renew it.

**Step 2 — Give it permissions**

1. On the app click **API permissions → + Add a permission → Microsoft Graph →
   Application permissions**.
2. Tick only what the customer will use:

   | For | Permissions |
   |---|---|
   | Outlook | `Calendars.ReadWrite`, `Mail.Send` |
   | SharePoint filing | `Sites.Selected` |
   | Microsoft 365 projects | `Group.ReadWrite.All`, `GroupMember.ReadWrite.All`, `Tasks.ReadWrite.All`, `User.Read.All` |

3. Click **Add permissions**, then **Grant admin consent for <organisation>** → **Yes**. Every
   line should show a green tick.

**Step 3 — Outlook: shared mailbox, limited to the app**

1. Microsoft 365 admin center → **Teams & groups → Shared mailboxes → + Add a shared mailbox**,
   e.g. `team@acme.com` (no licence needed).
2. Limit the app to that mailbox only (Exchange Online PowerShell):

   ```powershell
   Install-Module ExchangeOnlineManagement -Scope CurrentUser
   Connect-ExchangeOnline
   New-DistributionGroup -Name "Team App Access" -Alias teamappaccess -PrimarySmtpAddress teamappaccess@acme.com -Type Security -Members team@acme.com
   New-ApplicationAccessPolicy -AppId <client id> -PolicyScopeGroupId teamappaccess@acme.com -AccessRight RestrictAccess -Description "Wave Team Pro"
   Test-ApplicationAccessPolicy -Identity team@acme.com -AppId <client id>   # should say Granted
   ```

**Step 4 — SharePoint: allow the app into one site**

`Sites.Selected` gives no access until a site is granted. With PnP PowerShell:

```powershell
Install-Module PnP.PowerShell -Scope CurrentUser
Connect-PnPOnline -Url https://acme.sharepoint.com/sites/Finance -Interactive
Grant-PnPAzureADAppSitePermission -AppId <client id> -DisplayName "Wave Team Pro" -Site https://acme.sharepoint.com/sites/Finance -Permissions Write
```

**Step 5 — Connect Wave Team Pro (you)**

1. In Vercel add `MS_TENANT_ID`, `MS_CLIENT_ID` and `MS_CLIENT_SECRET` (tick **Sensitive** on the
   secret), then redeploy (3.7). The Microsoft menus now appear.
2. **Outlook**: Group Hub → **Settings** → **Outlook** → enter the shared mailbox → **Save** →
   **Send me a test invite**. Choose which automatic invites are on.
3. **SharePoint filing** (per company): **Admin → SharePoint filing** → tick *File <company>'s
   documents to SharePoint* → **SharePoint site address** (copy from the browser up to the site
   name), **Document library** (usually `Documents`), **Company folder** → choose what is filed
   and the file names → **Save SharePoint settings** → use **Check and run**.
4. **Microsoft 365 projects** (per company): **Admin → Microsoft 365 projects** → tick *Sync …
   projects to Microsoft 365* → **Save** → **Sync now** → read the **Sync report**. Only people
   with an account in the customer's Microsoft 365 are added; PAs and HR are never added.

Scheduled jobs: SharePoint filing and Outlook retries run daily (00:30 UTC), the Microsoft 365
project sync daily (00:00 UTC). After adding new Microsoft permissions, redeploy so the app picks
them up. More detail: [docs/deploy/microsoft-365.md](docs/deploy/microsoft-365.md).

### 5.5 Android app (optional)

A small app that opens the customer's site full screen, from Google Play.

1. GitHub → **Wave-Team-Pro** → **Actions** tab → **Android app** (left) → **Run workflow**
   (right). Enter the site's host name (`team.acme.com`), an Android package id
   (`com.acme.team`) and the name under the icon. Click **Run workflow**.
2. When it finishes, open **Releases** (right side of the repository's front page) →
   `android-build-<n>` and download the `.aab`, `.apk` and `apksigner.jar`.
3. Sign them with the customer's own upload key (commands in the README, **Android app**).
4. Put the package id and the SHA-256 fingerprint of the upload key (and later Google's app
   signing key from Play Console → **Test and release → App integrity → App signing**) into
   `public/.well-known/assetlinks.json`. Note: this file is shared by every customer built from
   the same branch; for more than one Android customer, keep each customer's app on its own
   branch (see [6.6](#66-customer-specific-changes)).
5. Upload the `.aab` in Google Play Console. Store graphics are in `android/store/`.

### 5.6 Brand and logos

- Product name, hub name and examples: environment variables (see [10](#10-reference-every-setting)),
  then redeploy.
- Logos: uploaded in the app — **Admin → Settings → Company logo** for each company, **Group Hub →
  Settings** for the group. They appear in the menu and on every PDF and Excel report.
- App icons (`public/icons/`) and email templates (`supabase/templates/`) are shared by every
  customer. Change them only if you want a different look for everyone.

---

## 6. Updates

### 6.1 How updates reach customers

Every customer's Vercel project builds from the same GitHub repository. An update has two parts:

1. **Code** — reaches each customer when their Vercel project rebuilds from GitHub.
2. **Database changes** — new files in `supabase/migrations/`. These must be applied to **each
   customer's Supabase project**, *before* the new code goes live there.

### 6.2 Recommended setup: a `release` branch

So that work-in-progress on `Main` never reaches customers by accident:

1. Create the branch once: GitHub → **Wave-Team-Pro** → branch menu (top left, says **Main**) →
   type `release` → **Create branch release from Main**.
2. In **each** customer's Vercel project: **Settings → Environments → Production** → **Branch
   Tracking** → change the branch to `release` → **Save**. (Older dashboards: **Settings → Git →
   Production Branch**.)

Now pushes to `Main` only make preview builds; customers update when you move `release`.

### 6.3 Releasing an update, step by step

1. **Make and test the change on `Main`**:
   ```bash
   git checkout Main && git pull
   pnpm install
   pnpm check            # type check, lint, unit tests and a production build
   pnpm db:test && TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/wbh_test pnpm test:integration
   ```
2. **Write it down**: add a section at the top of `CHANGELOG.md` (version, date, what changed,
   and the names of any new migration files). Bump `"version"` in `package.json`.
3. **Commit and tag**:
   ```bash
   git commit -am "Release 1.1.0"
   git tag v1.1.0
   git push origin Main --tags
   ```
4. **Back up** each customer's database if the release has migrations (see [7.1](#71-backups)).
5. **Apply database changes to every customer** (skip if no new migration files):
   - Command line (Way A): for each customer
     ```bash
     npx supabase link --project-ref <customer's Project ID>
     npx supabase migration list     # shows which files are not applied yet
     npx supabase db push
     ```
   - Copy and paste (Way B): in each customer's **SQL Editor**, run only the migration files newer
     than the last one you ran there, in name order. Update your note.
   Migrations only add things, so the old code keeps working against the new database.
6. **Publish the code**:
   ```bash
   git checkout release && git merge --ff-only Main && git push origin release
   git checkout Main
   ```
   (Or on GitHub: **Pull requests → New pull request** → base `release`, compare `Main` →
   **Create** → **Merge**.) Every customer's Vercel project rebuilds automatically.
7. **Check**: in each Vercel project, **Deployments** shows the new build as **Ready**. Open the
   site and sign in. Open pages reload themselves to the new version.

### 6.4 Updating one customer only, or out of turn

Vercel project → **Deployments** → the build you want → **⋯** → **Promote** (or **Redeploy**).
Apply that release's migrations to the customer's database first.

### 6.5 Keeping dependencies up to date

Every month, or whenever `pnpm build` or GitHub warns about a security issue:

```bash
pnpm outdated                     # what has newer versions
pnpm update --latest next react react-dom eslint-config-next   # framework updates
pnpm check                        # must pass before releasing
```

Then release as in 6.3. Read Next.js upgrade notes before a new **major** version
(`node_modules/next/dist/docs/`).

### 6.6 Customer-specific changes

Keep one codebase. Prefer settings (environment variables, company settings, modules) over code
changes. If a customer truly needs different code, give them a branch (`customer/acme`) that you
regularly merge `release` into, and set their Vercel **Branch Tracking** to that branch.

### 6.7 Bringing changes over from another copy of the code

If a feature was built in a separate private repository first:

```bash
git remote add source https://github.com/<owner>/<other-repo>   # once
git fetch source
git log source/Main --oneline                                   # find the commits you want
git cherry-pick <commit id>                                     # repeat per commit
```

Then, before committing: remove any company names, people, email addresses, domains and
client project names from the new code, tests and texts; run `node scripts/i18n-extract.mjs`
and add translations for new phrases (README, **Languages**); and run `pnpm check`.

---

## 7. Backups and rollback

### 7.1 Backups

- **Supabase Pro** keeps daily backups: **Database → Backups**. Turn on **Point in Time
  Recovery** (add-on) for customers who can't lose a day.
- Before a release with migrations, take your own copy:
  ```bash
  npx supabase link --project-ref <Project ID>
  npx supabase db dump -f backup-acme-$(date +%F).sql
  ```
  Store it somewhere safe (it contains personal data).
- Files (receipts, drawings, logos) live in Supabase **Storage** and are not in the database dump.

### 7.2 Rolling back the website

Vercel project → **Deployments** → the last good deployment → **⋯** → **Instant Rollback**
(or **Promote**). Takes seconds.

### 7.3 Rolling back the database

Migrations aren't undone automatically. Either write a new migration that reverses the change,
or restore a backup: **Database → Backups → Restore** (this replaces all data since the backup —
last resort).

---

## 8. Everyday use: quick help for admins and staff

| I want to… | Where |
|---|---|
| Invite someone | **Admin → Invitations** → fill in name, email, role → **Send invitation** |
| Add someone who already has an account to another company | **Group Hub → All staff** → the person → choose the company → **Add now** |
| Change what a role can do | **Admin → Roles** |
| Clock in / out | **Home** (or Group Hub **Clock**) → choose project → **Clock in** |
| Fill in / submit my timesheet | **Timesheets** → the week → **Submit** |
| Approve timesheets, leave, expenses | **Approvals** (or Group Hub **Timesheets → Waiting for approval**) |
| Request leave | **Leave → Request leave** |
| Claim an expense | **Expenses → New expense** (top right) → photo of the receipt |
| Close the month / export to Xero | **Expenses → Bookkeeping** |
| Assign a task | **Projects** → the project → **Add task** → choose people |
| Plan who works where | **Staff calendar → Assign staff** |
| Send a meeting invite or company update | Group Hub → **Company Communications** (Microsoft 365 needed) |
| Turn on site schedules, drawings and QR labels | **Admin → Settings → Modules → Systems integration toolkit** |
| Change the company logo | **Admin → Settings → Company logo** |
| Change language | Language picker in the top bar (English, ไทย, Română, Suomi) |
| Turn on two-step verification | **Profile → Security** |

More detail on every feature: [README.md](README.md#features).

---

## 9. Troubleshooting

| Problem | Cause and fix |
|---|---|
| Site shows "Missing or invalid environment variables" | A required variable is missing or mistyped in Vercel. Check all six in 3.5, then redeploy. |
| "RATE_LIMIT_SALT must be set in production" | Add `RATE_LIMIT_SALT` (random, 16+ characters) and redeploy. |
| Invitation link opens `localhost` or the wrong site | `APP_BASE_URL` (Vercel) or **Site URL** / **Redirect URLs** (Supabase 3.2) is wrong. |
| Invitation emails don't arrive | No custom SMTP in Supabase (built-in sender is limited); set up 5.1. Check spam. Use **Copy link** on the invitation meanwhile. |
| "Email rate limit exceeded" | Same as above: set up custom SMTP. |
| Sign-in works but the page says no access | The person has no active membership in that company, or the company is suspended. |
| Error mentioning a missing column or function (e.g. `PGRST202`, `42703`) | A database migration wasn't applied to this customer. Run 6.3 step 5. |
| Systems integration pages give "not found" | The company hasn't switched on the toolkit (**Admin → Settings → Modules**). |
| Outlook / SharePoint / Microsoft 365 menus are missing | `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` not set, or not redeployed. |
| Outlook: `403 ErrorAccessDenied` | Permission not granted with admin consent, or the mailbox isn't in the access policy group. |
| Microsoft: `invalid_client` | Client secret wrong or expired — make a new one (5.4 step 1.4), update Vercel, redeploy. |
| SharePoint: access denied | The site wasn't granted to the app (5.4 step 4). |
| Weekly timesheet emails / daily jobs don't run | `CRON_SECRET` missing; check Vercel → **Settings → Cron Jobs**. |
| Receipt reading does nothing | `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` missing or the model id is wrong. |
| Site is slow | Vercel function region far from the Supabase region (3.5 step 7). |
| Supabase project "paused" | Free plan pauses inactive projects. Restore it in the dashboard; use Pro for customers. |
| Vercel build "Blocked" | On the Hobby plan Vercel blocks commits by unknown authors. Use Pro, or commit as a member of the Vercel team. |
| Build stops with a Next.js security warning | Update Next.js (6.5) and release. |

Where to look for errors: Vercel project → **Logs** (live errors), Supabase → **Logs**
(database and sign-in), and inside the app **Admin → Audit log**.

---

## 10. Reference: every setting

Set in Vercel → **Settings → Environment Variables**. Redeploy after any change.

| Variable | Required | Example / notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | `https://abcd1234.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | secret key — **Sensitive** |
| `APP_BASE_URL` | Yes | `https://team.acme.com`, no trailing slash |
| `RATE_LIMIT_SALT` | Yes | random, 32+ characters |
| `CRON_SECRET` | Yes | random; Vercel sends it to the scheduled jobs |
| `NEXT_PUBLIC_PRODUCT_NAME` | No | default `Wave Team Pro` |
| `NEXT_PUBLIC_HUB_NAME` | No | default `Group Hub` |
| `NEXT_PUBLIC_GROUP_NAME` | No | default `Group` |
| `NEXT_PUBLIC_EXAMPLE_DOMAIN` | No | default `example.com` |
| `NEXT_PUBLIC_EXAMPLE_COMPANY` | No | default `Acme Ltd` |
| `NEXT_PUBLIC_DEMO_MODE`, `DEMO_PASSWORD` | No | sales demo sites only ([docs/deploy/demo.md](docs/deploy/demo.md)) |
| `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM` | No | Resend ([5.1](#51-email-resend)) |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` | No | receipt reading ([5.2](#52-ai-receipt-reading)) |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | No | Microsoft 365 ([5.4](#54-microsoft-365-outlook-sharepoint-planner)) |

Scheduled jobs (`vercel.json`): weekly timesheets Mondays 06:00 UTC; SharePoint filing and
Outlook retries daily 00:30 UTC; Microsoft 365 project sync daily 00:00 UTC.

Other guides: [local development](docs/deploy/local-development.md) ·
[production checklist](docs/deploy/production.md) · [Microsoft 365 detail](docs/deploy/microsoft-365.md) ·
[demo site](docs/deploy/demo.md) · [security model](docs/security/security-model.md) ·
[architecture](docs/architecture/overview.md)
