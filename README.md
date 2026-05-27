# NearBuy 🌿

**Your cart. Bought local.**

NearBuy takes your Amazon, Walmart, or Target cart and finds the same items at nearby local stores — with values-based filtering, environmental impact scores, and a map view.

---

## Quick Start (Local Dev)

```bash
npm install
npm run dev
```

Then open http://localhost:5173

---

## Deploy to Vercel (Recommended)

1. Push this folder to a GitHub repository
2. Go to [vercel.com](https://vercel.com) and sign up with GitHub
3. Click **"Add New Project"** → select your repo
4. Vercel auto-detects Vite — just click **Deploy**
5. Done. Your app is live at `https://your-project.vercel.app`

---

## Environment Variables

The Google API key is currently hardcoded in `src/App.jsx` for prototype purposes.

Before going to production, move it to an environment variable:

1. In Vercel dashboard → your project → **Settings → Environment Variables**
2. Add: `VITE_GOOGLE_API_KEY` = your key
3. In `src/App.jsx`, replace the hardcoded key with:
   ```js
   const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
   ```

---

## Google APIs Required

Enable these in [Google Cloud Console](https://console.cloud.google.com):
- **Places API (New)**
- **Maps JavaScript API**
- **Geocoding API** (optional — app has built-in city lookup fallback)

---

## Tech Stack

- React 18 + Vite
- Google Maps JavaScript API (map view)
- Google Places API New (nearby store search)
- Anthropic Claude API (cart screenshot parsing + item matching)
- OpenStreetMap Nominatim fallback for geocoding

---

## Features

- 📸 Screenshot import — upload your Amazon/Walmart/Target cart, Claude parses it
- ✏️ Manual cart editing — fix or add items after import
- 🗺️ Map + list view of nearby stores
- 🏪 Filter by store type: mom & pop / chain / big box
- 📍 Distance slider (1–25 miles)
- 🤖 Claude-powered item matching and alternative suggestions
- 🌿 Environmental + local economic impact card per search

---

Built with Claude by Anthropic.
