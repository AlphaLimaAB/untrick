# AGENTS.md

Instructions for AI agents (and humans) working in this repository. Read this file before every task.

## What this is

The public website for a consumer-law compliance monitor for Nordic e-commerce and subscription businesses (working name **Klarkoll**; the final name may change). The site offers a free scan: a visitor enters their website and email, and receives a report on the withdrawal button, misleading design (dark patterns) and subscription flows.

Owner: Alpha Lima AB (Anton). The site is static: plain HTML, CSS and a small script, built by a Node script with no dependencies.

**The product sells compliance, so this site must itself be compliant.** No cookies, no third-party tracking, no pre-ticked boxes, no fake urgency, no hidden costs, no manipulative wording. If a change would fail our own scan, don't make it.

## Repository map

| Path | What it holds | Who edits |
| --- | --- | --- |
| `content/sv.json`, `content/en.json` | All visible text, one file per language, identical structure | Agents, freely (rules below) |
| `content/site.json` | Brand name, company details, base URL, contact email, form provider and endpoint | Humans only, or agents with explicit approval |
| `src/templates.mjs` | HTML layout; no visible text lives here | Agents, with care |
| `src/assets/styles.css`, `src/assets/main.js` | Styling and the form script | Agents, with care |
| `scripts/build.mjs` | Builds `dist/` from content + templates | Rarely |
| `scripts/check-*.mjs` | Automatic checks | Only to add checks, never to weaken them |
| `.github/workflows/checks.yml` | Runs the checks on every pull request | Only to add checks, never to weaken them |
| `statichost.yml` | Deployment build settings for statichost.eu | Humans only |
| `dist/` | Build output, not committed | Never edit by hand |

## Commands

```sh
npm ci                                  # install check tools (only needed for checks)
npm run build                           # build the site into dist/
npm run check                           # all checks: content, build, HTML, links, accessibility
npm run serve                           # preview dist/ locally
```

The accessibility check needs a browser: run `npx playwright install chromium` once, or set `CHROME_PATH` to an installed Chrome.

## How to change text

1. Edit the same key in **both** `content/sv.json` and `content/en.json`. The check fails if the structure differs or a text is empty.
2. Swedish is the default language (served at `/`); English is served at `/en/`.
3. Write plain, short sentences. Swedish texts use Swedish conventions (e.g. "1 500 kr"); English uses "SEK 1,500".
4. Use placeholders instead of hard-coding: `{name}` (brand), `{company}`, `{orgNr}`, `{address}`. Only these are allowed.
5. Never put HTML in content files; all text is escaped.
6. Only state facts about laws that are true on the day you write them, and keep dates exact (e.g. withdrawal button: in force since 19 June 2026; Digital Fairness Act: proposed 11 November 2026, not yet law). If unsure, don't change legal statements; flag them in the pull request.

## How to work

- One change per pull request, small and described with the template. Never push directly to `main`.
- Run `npm run check` before opening a pull request. CI runs the same checks and must be green.
- Merging to `main` deploys automatically to the live site through statichost.eu.
- Keep the site fast and simple: no frameworks, no external fonts, no CDNs, no new runtime dependencies without approval.
- Accessibility target: WCAG 2.1 AA. Every input has a visible label; links say where they go.

## Needs human approval (open the pull request, then stop)

- Anything in `content/site.json` (company details, form endpoint, brand name, base URL).
- Legal texts: the privacy policy, consent wording, the "not legal advice" answer, and any claim about what a law requires.
- Prices and plan contents.
- New pages, new third-party services, or anything that sends visitor data somewhere new.
- Changes to checks, CI, `statichost.yml` or this file.

## Never

- Add cookies, analytics, pixels, chat widgets or any third-party script.
- Pre-tick consent boxes or make the "no" option harder to find than "yes".
- Commit secrets, API keys, `.env` files or visitor data. Form submissions live with the form provider, never in this repository.
- Weaken, skip or delete a check to make CI pass. Fix the cause instead.
- Force-push, rewrite history on `main`, or change repository settings, DNS, domains or billing.

## Launch checklist (current status: pre-launch)

- [ ] Final brand name chosen; trademark (PRV/EUIPO) and domain checked; `content/site.json` → `name`
- [ ] Domain connected in statichost.eu; `baseUrl` set
- [ ] Form endpoint set (`form.provider` + `form.endpoint`) and a test submission received
- [ ] `contactEmail` set
- [ ] Privacy policy reviewed by the legal partner; remove `draftNotice` from both languages
- [ ] Legal partner named on the page only after written approval
