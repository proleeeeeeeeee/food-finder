# 吃啥呢？🍜 Food Finder

A nearby-food **random picker** for people with decision paralysis. Get your
location → it finds nearby restaurants → spin a 3D dice or run a this-or-that
face-off to decide what to eat. Bold **Neo-Pop** style.

Built with **Next.js 16 · React 19 · Tailwind v4 · Three.js**.

## Features

- 📍 Precise geolocation (refines the GPS fix, shows accuracy)
- 🎲 3D dice "spin to decide" + ⚔️ this-or-that elimination bracket
- 📳 Shake-to-spin on mobile (DeviceMotion)
- 🔥 Heavy / 🥗 Light flavor, venue type, and open-now filters; precise distance slider
- 🗺️ Hybrid data: free **OpenStreetMap** + optional **Google Places** (auto-fallback to OSM)
- 🔗 Deep-links to the Google Maps place page for menu / ratings / price / photos

## Local development

```bash
npm install
npm run dev   # http://localhost:3000
```

## Google Places (optional — richer mall/indoor coverage)

Without a key the app uses free OpenStreetMap automatically. To enable Google:

1. Google Cloud → enable **Places API (New)** → create an API key.
2. Copy `.env.example` to `.env.local` and set `GOOGLE_PLACES_API_KEY`.
3. Restart `npm run dev`.

Only the cheap "Nearby Search Pro" SKU fields are requested (~5,000 free
calls/month). Rich info (ratings/menu/price) is shown by deep-linking to Google
Maps rather than paying for those fields. See `.env.example` for details.

## Deploy (Vercel)

This app has a **server-side API route**, so it needs a host that runs
serverless functions — **GitHub Pages won't work** (static only).

1. Push this repo to GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new) — Next.js is auto-detected, no config needed.
3. (Optional) add a `GOOGLE_PLACES_API_KEY` environment variable in the Vercel
   project settings. `.env.local` is git-ignored and never uploaded.
4. Deploy. HTTPS is automatic (required for geolocation & shake).
