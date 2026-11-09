# Notes for maintainers (and AI agents)

Read this before changing anything. The README is for visitors; this file is for whoever maintains the repo.

## Background

- The grass, lighting and drifting effects were first built for Vic Chen's portfolio site, therapist-160.github.io.
  That site's source is private. This repo holds **only the effects**, rewritten as standalone files with English
  comments, plus a demo page.
- Deliberately left out: the portfolio's page layout and interactions (inspired by theboringblog.ai, so not ours to
  open-source), client work images, and the characters that sit on the field.
- Goal: exposure and sharing. The demo page links back to the portfolio.

## Decisions (2026-11-09, Vic)

- Personal account `Vic-Chen-160`, public, MIT licence.
- **Raw source only**: no npm package and no one-line embed. People take the files apart themselves, so keep the
  files readable and independent.
- Credit theboringblog.ai for the painted-grass inspiration in the README.
- The demo is served by GitHub Pages from the repo root (`index.html`).

## How it fits together

- `field.js` reads `window.SUNLIGHT` every frame. `sunlight.js` writes it. Neither file requires the other.
- `sunlight.js` sets page colour CSS variables on `<html>` (removed again in daytime) and adds a `.sun` overlay
  after the element passed as `after`, plus a `.sky__night` canvas inside `sky`.
- Field size follows the canvas **height** only (`zoom × height`), so portrait phones get a close-up on purpose.
- The glow post-process only runs when `SUNLIGHT.bloom` or `.mist` > 0, so daytime costs the same as no glow.

## Checking changes

- Preview: `python3 -m http.server 8010` in the repo, open http://localhost:8010/ (`?time=19:30` to pin a time).
- Check 390×844, 844×390, 820×1180, 1180×820, 1280×720 and 1920×1080. The header links and the dial buttons must fit
  on one line at 390 wide (`.wide` spans hide below 30rem).
- `media/preview.gif` (README) and `media/cover.png` (link preview, referenced by `og:image`) are screenshots of the
  demo. Re-capture them if the look changes.

## Status

- 2026-11-09: built locally, waiting for Vic's review before the repo is created and made public.
- After it's public: enable GitHub Pages (main branch, root), then post on X with the repo link in the main post.
