# Flow Localise

A first feasibility runner for recording an approved Canva lesson in Spanish (Argentina) and Thai. This is **Phase 0**, not a completed screen recording app. It has no dashboard yet. No live Canva workflow has been verified.

## Start on your Mac

You do not need an existing app. This folder is the start of it. Install Node.js 22 or later from nodejs.org. Install FFmpeg using `brew install ffmpeg` if you already use Homebrew. If you do not have Homebrew, ask for help with that step rather than running an unfamiliar installer.

Open Terminal in this project folder, then run:

```sh
npm ci
npx playwright install chromium
npm run build
npm run localise -- doctor
npm run localise -- login
```

A separate Chromium browser opens for manual sign-in. Use a dedicated Canva demo account with synthetic content. Your login is stored only in `~/Library/Application Support/Flow Localise/canva-demo-profile`, outside the repository. Do not upload that folder or inspection evidence to GitHub. Delete that folder to remove the local session after closing all runner browsers.

## Configure one lesson with live evidence

The example is intentionally incomplete: it does not pretend to know Canva's current controls or template identities. We need to inspect your real browser before completing it. The runner currently supports only a four-step, same-tab route where the selected template is an accessible link. If Canva uses other controls or opens a new editor tab, stop and adapt the engine; do not invent selectors or force links to stay in the same tab.

```sh
mkdir -p local
cp recipes/example.json local/spanish.json
npm run localise -- inspect local/spanish-evidence.json
```

In the browser, set the Canva account language and navigate to the relevant screen. Inspection saves local accessible names, links and the observed page language. Repeat inspection for each screen as needed. Replace every `CONFIGURE` value with observed evidence, including the template's exact accessible name and URL. Spanish (Argentina) is the requested market; Canva may expose only a general Spanish language. Record the actual mapping rather than claiming a regional catalogue. Use a separate `local/thai.json` recipe with `locale: th-TH` and observed Thai labels/query. A fluent reviewer must confirm terminology and suitability.

```sh
npm run localise -- validate local/spanish.json
npm run localise -- prepare local/spanish.json
```

Preparation visits the real search route, saves a candidate crop privately, asks you to approve the account, locale, query and template, opens the editor, and asks you to verify the endpoint and reset. It saves `preparation.json` outside GitHub. Approval lasts at most 24 hours and is invalidated by recipe changes. Browser language settings alone do not establish the actual Canva language: the runner also checks the page's declared language and requires your visual confirmation. Account/workspace identity and semantic editor correctness are operator checks in this prototype.

```sh
npm run localise -- record local/spanish.json "/absolute/path/printed/by/prepare/preparation.json"
```

The runner revalidates the template identity, resets, asks for a final preflight check, then records without approval pauses. It writes a new attempt under `outputs/<recipe-hash>/<locale>/<attempt-id>/`: source WebM, silent H.264 MP4, step timings and a manifest. Failed attempts retain diagnostics and never receive approval. Each successful attempt still requires visual inspection and separate creative/language review; the prototype does not export approved deliveries or mark those reviews complete.

Use the same commands serially for Thai. Never change the shared account language while another run is active. The shared profile has an exclusive lock. After an unclean crash, close the runner and its browsers before manually deleting `~/Library/Application Support/Flow Localise/account.lock`. An interrupted take may have only a partial source and no final manifest; never treat it as complete or automatically replay it. Ctrl+C currently relies on process termination; graceful cancellation and crash recovery are Phase 1 work.

## Capture and current limits

For inspecting an editor that opens in a new tab, run `node scripts/inspect-tabs.mjs` from the project folder. After opening the editor, press Return in Terminal. This saves every readable Canva tab to `local/editor-evidence.json`, labels failures explicitly, and excludes other sites. Multi-tab inspection does **not** yet enable multi-tab production recording. The original `inspect` command captures only its original page.

Pinned Playwright 1.64.1 exposes `page.screencast.start/stop`, `size` and `fps`; the installed official API definitions are used directly. Capture is 1920 × 1080 at 25 fps. FFmpeg encodes silent H.264/yuv420p and checks dimensions, rate, duration, decoding and timing bounds. Capture starts after the clean state is ready and retains the complete route without trimming. Timing uses a monotonic clock immediately after capture starts; visual alignment still needs inspection on actual footage.

Only headed Chromium and same-page recording are supported in the user CLI. Unexpected tabs fail the take: this adapter cannot yet prove Canva's editor transition. Cursor decoration is currently omitted and needs a visual acceptance decision. New dialogs, duplicate targets, missing/changed templates and language mismatches stop execution. This is deliberately a narrow adapter; modal-based template flows may need explicit supported actions before a real Canva take can run.

Required live checks still outstanding: Canva access, actual Spanish/Thai mappings, approval of queries/templates, repeated reset, tab handling, Thai glyphs, smoothness/readability, cursor treatment and headless-versus-headed comparison. Local fixture tests establish runner mechanics, not Canva feasibility. Do not proceed to the dashboard until both actual clips pass review.

## Development

```sh
npm ci
npx playwright install chromium
npm test
```

Each cloud task is already isolated: use this checkout rather than creating a Git worktree. Keep browser profiles and evidence outside source control. `outputs/`, `local/`, `.env` files and dependencies are ignored. Never commit credentials, recordings containing private material or session data.

GitHub stores the source code. No code has been pushed automatically. Once reviewed, the first commit can be made and pushed to `main`; the account login and generated footage must remain local.
