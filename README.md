# World Cup 2026 Simulator

Simple Vite + React simulator for the FIFA World Cup 2026.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Predictor Setup

Create a Supabase project, disable email confirmation for the simplest friend-group signup flow, then run `supabase/schema.sql` in the Supabase SQL editor.

Add these Vite env vars locally:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

## Data

The app fetches the public ESPN World Cup scoreboard endpoint on load and falls back to the bundled snapshot in `src/data/snapshot.ts` if the request fails. The 495 third-place bracket combinations are generated from the public knockout-stage table into `src/data/thirdPlaceMap.ts`.

Refresh bundled data with:

```bash
npm run update:data
```

## Verify

```bash
npm test
npm run build
npm run test:e2e
```
