# Microsoft 365: Outlook and SharePoint (optional)

Everything here is optional. Until `MS_TENANT_ID`, `MS_CLIENT_ID` and `MS_CLIENT_SECRET` are set, the
Outlook, SharePoint filing and Microsoft 365 projects menu items stay hidden.

Wave Team Pro uses one Entra app registration (e.g. **Wave Team Pro**) with app-only
(client credentials) access to Microsoft Graph.

## 1. App registration (Entra admin center → App registrations → New registration)

**API permissions** — Microsoft Graph, **Application** type, then **Grant admin consent**:

| Permission | Used for |
|---|---|
| `Calendars.ReadWrite` | Calendar invites from the shared mailbox |
| `Mail.Send` | Email updates (attachments are sent inline, so `Mail.ReadWrite` is not needed) |
| `Sites.Selected` | SharePoint filing, limited to sites explicitly granted |
| `User.Read` (Delegated) | Default, harmless |

Do not add the `.All` calendar variants or `Calendars.Read*`.

**Certificates & secrets** → new client secret (24 months). Copy the **Value** once, straight into
Vercel. Renew before it expires.

## 2. Shared mailbox

A shared mailbox, e.g. `team@yourcompany.com` (Microsoft 365 admin center → Teams & groups → Shared mailboxes). No licence.

## 3. Limit the app to that mailbox (Exchange Online PowerShell)

Application access policies need a mail-enabled security group:

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Connect-ExchangeOnline
New-DistributionGroup -Name "Team App Access" -Alias teamappaccess -PrimarySmtpAddress teamappaccess@yourcompany.com -Type Security -Members team@yourcompany.com
New-ApplicationAccessPolicy -AppId <client id> -PolicyScopeGroupId teamappaccess@yourcompany.com -AccessRight RestrictAccess -Description "Wave Team Pro"
Test-ApplicationAccessPolicy -Identity team@yourcompany.com -AppId <client id>   # Granted
```

## 4. Vercel

Environment variables (Production, Sensitive): `MS_TENANT_ID` (Directory/tenant ID),
`MS_CLIENT_ID` (Application/client ID), `MS_CLIENT_SECRET` (secret Value). Redeploy.

## 5. In the app

Group Hub → **Settings** → **Outlook**: enter `team@yourcompany.com`, Save, **Send me a test invite**. Choose which
automatic invites are on (task due dates, shifts, project assignments, approved leave).

## SharePoint (pending)

`Sites.Selected` needs a per-site write grant for the app (Graph
`POST /sites/{site-id}/permissions` by a SharePoint admin), then each company's
**SharePoint filing** page gets the site address and library.

## Troubleshooting

| Error | Cause |
|---|---|
| `403 ErrorAccessDenied` | Permission not granted, or the mailbox isn't in the access policy group |
| `The identity of the policy scope is not a security principal` | Use the security group, not the mailbox, in `-PolicyScopeGroupId` |
| `invalid_client` | Wrong or expired client secret |


## Project sync to Planner / To Do / Outlook (Admin → Microsoft 365 projects)

Per company, off by default. Once a day at 00:00 UTC and on Sync now (`/api/cron/m365-sync`, protected by `CRON_SECRET`) each *planning* or *active* project gets a private Microsoft 365 group “Project – {name}” with a Planner plan (buckets Tasks / Updates / Dates). Ids live in `project_m365_links` and `task_m365_links`.

**Application permissions** (Microsoft Graph, Application type, admin consent):

| Permission | Used for |
|---|---|
| `Group.ReadWrite.All` | create the private group, rename it, add/remove members |
| `GroupMember.ReadWrite.All` | add/remove group members |
| `Tasks.ReadWrite.All` | Planner plans, buckets, tasks, task notes (Planner supports app-only with this permission) |
| `User.Read.All` | look people up by email to find out who is in the tenant |

(`Group.Create` alone is not enough: the sync also renames groups and manages members.) No other permission is needed; nothing here uses mailboxes, group calendars or Teams.

**Who is added:** members, leads, the manager and people whose assigned project is this one, if active, not PA/HR (job title, role name or role key matching PA / Personal Assistant / HR / Human Resources, case-insensitive) and found in the tenant by email. Others (e.g. Gmail addresses) are skipped and listed in the admin report. The sync only ever removes people it added itself.

**What is mirrored:** Hub tasks → Planner tasks (title, due date, priority, assignees, notes; assigned tasks appear in To Do under *Assigned to me*). Completion is two-way (todo=0, in progress/review=50, done=100); if both sides changed since the last sync the later change wins (Hub `updated_at` vs Planner completion time, or when the sync noticed the Planner change, because Planner exposes no modified time). Other edits in Planner are overwritten by the Hub; tasks created only in Planner are not imported. Archived Hub tasks are deleted from Planner.

**Project log and dates — why Planner tasks:** Graph does *not* support application permissions for creating group calendar events (`POST /groups/{id}/events`) or group conversation threads (`POST /groups/{id}/threads`) — both list Application: “Not supported”. So the project log is a pinned task “Project updates” (newest entries, rendered into its notes) and the start / end dates are two tasks with start/due dates assigned to the group members, which show in Planner, To Do and Outlook's task list. Calendar *invites* for assignments/shifts continue through the existing Outlook shared-mailbox integration.
