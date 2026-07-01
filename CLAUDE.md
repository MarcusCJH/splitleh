# SplitSia

A mobile-first PWA for scanning receipts, splitting costs, and sharing results with friends. Fully static — no backend, no login, no server.

## Goal

Let users photograph a receipt, extract items via in-browser OCR, assign items to people, split GST/service charge fairly, and share the final breakdown as plain text.

## Constraints

- V1 must deploy as a static site on GitHub Pages. Do not add a backend.
- Do not add login or authentication of any kind.
- Do not use paid APIs or any API that requires a key.
- Receipt images must never leave the user's device.
- OCR must run entirely in the browser (Tesseract.js).
- Every screen must be designed mobile-first. Desktop is a secondary concern.
- Correction must be easy — OCR output will always have errors. Every extracted item must be editable before splitting.

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | React 18 |
| Build tool | Vite 6 |
| Language | TypeScript (strict) |
| OCR | Tesseract.js (browser) |
| Persistence | localStorage (draft + history) |
| Routing | react-router-dom v6, HashRouter |
| Styles | CSS Modules + global CSS variables |
| Deployment | GitHub Pages (`npm run deploy`) |

Do not introduce new major dependencies without asking first.

## Project Structure

```
src/
  types/          # Shared TypeScript types (receipt.ts)
  store/          # React Context + useReducer state (ReceiptContext.tsx)
  utils/          # Pure business logic: storage.ts, split.ts
  components/     # Reusable UI: AppShell, BottomNav
  pages/          # One folder per route: Home, Scan, Review, Split, Result
```

Keep components small and focused. Business logic belongs in `src/utils/`, not inside components.

## Key User Flow

1. **Home** — start a new split or resume a draft session.
2. **Scan** — upload or photograph the receipt; image stays on device.
3. OCR runs in-browser via Tesseract.js; raw text is stored in state.
4. **Review** — edit extracted item names and prices; add/remove items; set tax and tip amounts.
5. **Split** — add people by name; assign items to one or more people; shared items are divided equally among assignees.
6. GST/service charge is split proportionally to each person's subtotal.
7. **Result** — view per-person totals with itemised breakdown; copy as plain text to share.
8. Save session to localStorage history; draft auto-saves on every change.

## State Architecture

All session state flows through `ReceiptContext` (Context + useReducer). The active draft persists to localStorage automatically. Completed sessions are saved separately and shown on the Home page.

```
ReceiptSession
  ├── items[]       ReceiptItem { id, name, price, quantity, assignedTo[] }
  ├── people[]      Person { id, name, color }
  ├── tax           number
  ├── tip           number
  └── rawImageDataUrl?  stored locally, never uploaded
```

## Coding Style

- Use clear, explicit TypeScript types. Avoid `any`.
- Keep components under ~150 lines. Extract logic to `src/utils/` when it grows.
- No comments unless the *why* is non-obvious from the code itself.
- CSS Modules for component styles; CSS custom properties (`--color-primary`, etc.) for the design system.
- Avoid over-engineering. Three similar lines is fine; premature abstractions are not.

## GitHub Pages Deployment

`vite.config.ts` sets `base: '/splitsia/'`. HashRouter avoids 404s without a custom `404.html`. To deploy:

```bash
npm run deploy   # builds then pushes dist/ to the gh-pages branch
```

Update `base` in `vite.config.ts` and `start_url` / `scope` in `public/manifest.json` if the repo name changes.

## Local Development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
npm run preview  # preview the production build locally
```
