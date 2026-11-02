# Flow Localise

A local feasibility runner for recording the same Canva lesson in different languages. Start with one English test, then prepare Spanish (Argentina) and Thai. This is Phase 0: there is no dashboard yet and no live automated Canva take has been verified.

## Start on your Mac

Install Node.js 22 or later and FFmpeg (`brew install ffmpeg` if Homebrew is already installed). Open Terminal in this project folder and run:

```sh
npm ci
npx playwright install chromium
npm run build
npm run localise -- doctor
npm run localise -- login
```

Sign in in the separate Chromium window, then return to Terminal and press Return. Use a dedicated demo account and synthetic content. Login stays in `~/Library/Application Support/Flow Localise/canva-demo-profile`, outside the project. Never upload that folder. Close all runner browsers before deleting it to remove the local login.

## First English test

The user selected **Red Black Bold Graphic Designer Resume**. `recipes/english-test.json` uses controls observed in their English (Australia) Canva inspection files. It does not contain a guessed template ID. The actual ID must be read from the live preview and explicitly approved.

```sh
npm run build
npm run localise -- english-test
```

The browser performs the route and Terminal asks for separate confirmations. Type **APPROVE** only after checking the corresponding browser state:

1. Preview: correct account/workspace, English UI, `resume` search, and selected template.
2. Editor: correct resume, editable content, and readable fonts.
3. Reset: back at the clean Canva home screen.
4. Preflight: correct account, language, and start state before recording.

Preparation creates a Canva design to verify the editor. Recording creates another. These designs remain in your account. Keep the browser open during prompts and do not interact with it during the take. No approval pauses happen inside the recording.

The runner opens Templates through the sidebar, visibly searches, opens the approved template preview, and follows its customise link into a new editor tab. Search results may reorder: it finds a unique preview button by exact accessible name, then checks the template ID and design type from the live preview. A missing, ambiguous or changed template stops the run. It never picks a replacement or skips the search via a direct template URL.

When finished, Terminal prints a new output folder. Open **clip.mp4** there and check the entire route, preview, editor transition and endpoint. Technical validation does not approve language or creative suitability. No clip is automatically marked approved.

## Updating the original Mac installation

If you downloaded the initial version before the English test existed, the standalone update helper can install the changed source files without replacing your project folder or local evidence. It requires the original package/dependencies and preserves the private browser profile.

```sh
curl -fL https://raw.githubusercontent.com/jberg3923/localisation/main/scripts/install-english-update.mjs -o local/install-english-update.mjs
node local/install-english-update.mjs
npm run build
```

The helper checks known source hashes before writing and backs up replaced files under `local/update-backups/`. If you changed a source file yourself, it stops rather than overwriting it. It does not edit `local/` evidence files, `outputs/`, dependency declarations or lockfiles. Running it again leaves current files alone. After updating, run `npm run localise -- english-test`.

## Capture and outputs

Each attempt has a new folder under `outputs/<recipe-hash>/<locale>/<attempt-id>/` containing:

- `source-frames/` and `frames.json`: native JPEG frames and monotonic host-receipt timestamps, with the page index.
- `source.webm`: a constant-rate source assembled from that real-time frame timeline.
- `clip.mp4`: silent H.264/yuv420p, 1920 × 1080 at 25 fps.
- `steps.json`: teaching step boundaries relative to the same timeline.
- `manifest.json`: recipe hash, preparation ID, approved template identity, attempt status, capture statistics and separate pending reviews.
- `diagnostics/`: failure screenshots kept separately.

The capture adapter uses pinned Playwright 1.64.1 `page.screencast` frame callbacks. It begins at the first received home-page frame and follows the expected editor popup. Frames from the old page remain on the real-time timeline until a frame arrives from the new page. Loading time is retained, with no speed-up or trimming. Frames are resampled to 25 fps; that frame rate alone does not establish visual smoothness. Inspect actual recordings and the reported largest frame gap. Browser tab chrome and cursor decorations are not captured. Host receipt timing can lag rendering; visual timing precision and the live transition still need review.

FFmpeg checks dimensions, codec, pixel format, silence, frame rate, duration, decoding and step timing bounds. Expected preview dialogs are supported; unexpected dialogs or tabs fail the take. Editor title, editability, canvas presence and declared UI language are checked. Actual lesson correctness, account/workspace identity and visual language remain human checks.

Ctrl+C attempts to close the browser and release its account lock. Incomplete takes retain a recording/processing/failed manifest or partial source; never approve them or automatically replay them. Crash recovery and comprehensive job cancellation remain Phase 1 work. After an unclean crash, close all runner browsers before manually removing `~/Library/Application Support/Flow Localise/account.lock`.

## Other locales and inspections

The English test must work before expanding. For Spanish and Thai, inspect actual account UI settings and controls, approve queries and templates separately, and configure a copy of `recipes/example.json`. Every `CONFIGURE` placeholder must be replaced with observed evidence. Do not assume browser locale selects Canva's account language or regional catalogue. Fluent review is required.

```sh
node scripts/inspect-tabs.mjs
npm run localise -- validate local/spanish.json
npm run localise -- prepare local/spanish.json
npm run localise -- record local/spanish.json "/path/printed/by/prepare/preparation.json"
```

The tab inspector saves all readable Canva tabs to `local/editor-evidence.json`. Inspect files before sharing: they contain page text and design links. The original `inspect` command captures only its original tab. Preparation approvals last at most 24 hours and are invalidated by recipe changes. One account stays serial, guarded by an exclusive profile lock. New attempts never overwrite prior footage.

## Development and evidence

```sh
npm test
node --test scripts/inspect-tabs.test.mjs
```

On a cloud Linux machine with a trusted system Chromium, the browser fixture can use `LOCALISE_TEST_CHROMIUM=/usr/bin/chromium npm test`. Mac use defaults to the Playwright-installed Chromium. See `FEASIBILITY.md` for verified outcomes and remaining live checks.

Each cloud task is already isolated: use this checkout and do not create a Git worktree unless explicitly requested. Keep profiles, credentials, evidence and outputs outside source control. `local/`, `outputs/`, `.env` files and dependencies are ignored. Source changes are uploaded to GitHub; private account data and inspection files are not.
