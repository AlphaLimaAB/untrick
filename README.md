# Untrick website (untrick.eu)

Landing page for a free automated check of online shops against EU consumer rules (withdrawal button, dark patterns, subscription flows, Digital Fairness Act readiness). Swedish at `/`, English at `/en/`. The start page is one search field and a three-step flow; "How it works", "Pricing", "FAQ" and the privacy policy are separate pages reached from the menu.

- All visible text: `content/sv.json` and `content/en.json`
- Brand, company details and form settings: `content/site.json`
- Instructions for AI agents: [AGENTS.md](AGENTS.md)

## Run locally

```sh
npm ci
npx playwright install chromium
npm run check      # builds the site and runs every check
npm run serve      # preview at http://localhost:3000
```

## One-time setup (owner)

### 1. GitHub: protect `main`

Settings → Branches → Add branch ruleset (or classic branch protection) for `main`:

- Require a pull request before merging
- Require status checks to pass: **Content, HTML, links and accessibility**
- Block force pushes and deletions

This makes the checks mandatory: nothing reaches the live site without passing them.

### 2. Hosting: statichost.eu

1. Create an account at statichost.eu and add a site from this GitHub repository (private repos need the deploy key that statichost shows you; add it under GitHub → Settings → Deploy keys, read-only).
2. Branch: `main`. The build settings are read from `statichost.yml`.
3. Turn on automatic deploys (webhook) so every merge to `main` goes live.
4. Add your domain and point DNS as statichost instructs. Then set `baseUrl` in `content/site.json`.

### 3. Form: Forminit (EU-hosted)

1. Create an account at forminit.com and create one form in **public** mode.
2. Copy the form ID. Set in `content/site.json`:
   ```json
   "form": { "provider": "forminit", "endpoint": "https://forminit.com/f/YOUR_FORM_ID" }
   ```
3. Turn on email notifications in Forminit, sign their DPA, and set a retention period that matches the privacy policy (12 months).
4. Submit a test from the live site and confirm it arrives.

The form sends `fi-sender-email`, `fi-url-website`, `fi-text-language` and `fi-text-consent`. To switch to our own API later, set `"provider": "json"` and point `endpoint` at it; the script then posts JSON `{ url, email, lang, consent }`.
