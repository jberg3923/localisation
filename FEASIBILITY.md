# Phase 0 evidence

This repository contains an initial runner, not proof of a completed Canva workflow.

Verified in the cloud development environment:

- Locked Node dependency installation and TypeScript build.
- FFmpeg/ffprobe availability.
- Rejection of unconfigured recipes, invalid timing bounds, and recipe hashes changing when queries change.
- A synthetic source was encoded and decoded as silent H.264/yuv420p, 1920 × 1080 at 25 fps with valid step timings. All four non-browser tests passed. This does not establish browser capture quality.

Blocked in this environment:

- Playwright Chromium download returned HTTP 403 `Domain forbidden` for `cdn.playwright.dev`.
- Consequently the real browser fixture (including duplicate-target rejection, identity after reordering, and screencast output) cannot execute yet. It is not a passing test.
- The draft adds that download domain. Saving the draft does not apply the policy; review and save environment settings, then retry installation before publication. Further download destinations may be reported by Playwright after access is restored.

Not run:

- A live Canva preparation or take, on either target locale.
- Mac installation or headed browser checks, repeat resets, tab transitions, account locale mapping, Thai font rendering, readability, cursor acceptance, or mode comparison.

No Canva selector, template identity, local query or review decision has been invented. The example intentionally fails validation until real evidence replaces its placeholders. No clips are approved, no GitHub push has occurred, and no environment publication is claimed. The current same-page adapter must be extended if the observed Canva route uses modal dialogs or a new editor tab. Do not hide these limitations by changing the lesson route.
