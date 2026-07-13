# Deploying the GAA World Games companion

Static site (plain `<script>` tags) hosted free on **GitHub Pages**, with a
scheduled **GitHub Action** that pulls live scores and commits them back so Pages
serves fresh data. No server, no build step, no database.

The live feed is **confirmed working**: `fetch_results.py` reads Foireann's public
open-data API (`open-data-prod.gaaservers.net/v1/fixtures`) using the publishable
read key baked into Foireann's own website. **No login, no token to capture.**

---

## 1. Create a GitHub repo and push

```bash
cd "/Users/alvn/Documents/Allocation Project/worldgames"

# Already a git repo with a commit. Create the GitHub repo, then push:
# Option A — GitHub CLI (if you install it):
gh repo create worldgames --public --source=. --remote=origin --push

# Option B — no gh: make an empty PUBLIC repo at https://github.com/new
#   (named worldgames, no README), then:
git remote add origin https://github.com/<you>/worldgames.git
git branch -M main
git push -u origin main
```

## 2. Enable GitHub Pages

Repo → **Settings → Pages** → **Source: Deploy from a branch** → **Branch: `main`,
Folder: `/ (root)`** → Save. Live in ~1 min at:
`https://<you>.github.io/worldgames/`

## 3. Let the Action write scores back

Repo → **Settings → Actions → General → Workflow permissions** → select
**Read and write permissions** → Save. (The workflow also declares
`permissions: contents: write`.)

## 4. Test the live pull now

Repo → **Actions → Poll live scores → Run workflow** (manual trigger). Open the run:
- **Fetch results** step should log `wrote=14 …`.
- If any scores changed, **Commit changed scores** pushes them; Pages updates within
  a minute and the app shows them (it auto-refreshes every 2 min).

The scheduled runs fire automatically **13–17 July 2026** (every 10 min ~08:00–18:00
Irish, plus a sweep ~19:00). Cron is UTC; Irish is UTC+1 in July.

> **Note:** GitHub disables scheduled workflows after 60 days of repo inactivity.
> Push a commit near the tournament to keep them live.

---

## How the data flows

```
Action (cron)          fetch_results.py             GitHub Pages           browser
  every 10 min  ──▶  pull fixtures + results  ──▶  serves data/live/*.json ──▶ app
                     write data/live/<slug>.json   (committed by the bot)   auto-refresh /2min
```
- `data/intl-camogie-1.json` = hand-authored baked schedule (pools, seeds). **Never overwritten.**
- `data/live/<slug>.json` = what the fetcher writes (all divisions). The app merges
  live scores onto the baked camogie schedule by date+time+pitch, and populates the
  other divisions wholesale.

## Manual score entry (always-available fallback)

If the API is ever down, use **Enter score** mode in the app for Camogie Div 1, or
edit `data/live/<slug>.json` by hand (a `fixtures` array of
`{id, home:{goals,points}, away:{…}, status:"final"}`) and push. The app merges it.

## If Foireann rotates the public key

`fetch_results.py` has the key as a default; override without editing code by setting
a repo secret **`WG_API_KEY`** (Settings → Secrets and variables → Actions). The
workflow already passes it through.

## Local preview

```bash
cd "/Users/alvn/Documents/Allocation Project/worldgames"
python3 fetch_results.py            # refresh data/live/*.json from Foireann
python3 -m http.server 8000         # open http://localhost:8000
```
