# DreamX Web Frontend + API

Production web UI for the existing Auto Filter Bot.  
**The Telegram bot is unchanged** — this only adds a JSON API and a static frontend.

---

## Architecture

```
Browser (Cloudflare Pages or /app on same host)
        │
        │  GET /api/search?q=
        │  GET /api/items/latest
        │  GET /api/items/<file_id>
        │  GET /api/stats
        ▼
Python process (bot.py)
  ├── Pyrogram bot (plugins/*)     ← existing
  ├── aiohttp streaming (route.py) ← existing
  └── aiohttp JSON API (api/*)     ← new
        │
        ▼
MongoDB (Media / Media2 / users)   ← same DB
```

### Streaming note (important)

Stream URLs in this project are tied to **Telegram message IDs** in the log channel, not only to Mongo `file_id`.  
The website therefore uses **Telegram deep-links** (`t.me/Bot?start=file_...`) for reliable download/open.  
When `STREAM_MODE` is on and the bot is online, users can still generate watch links from inside the bot as before.

---

## What was added / changed

| Path | Change |
|------|--------|
| `api/` | New JSON API package |
| `web/` | Static dark-theme frontend |
| `database/ia_filterdb.py` | `bulk_save_files()` for faster indexing |
| `plugins/index.py` | Uses bulk insert + larger batches (300) |
| `plugins/__init__.py` | Mounts API + optional static `/app` |

**Bot behaviour is preserved.** Indexing is faster (bulk writes).

---

## Environment variables (new)

```env
WEB_API_KEY=your-long-random-secret   # required for /api/admin/*
CORS_ORIGINS=*                        # or https://your-frontend.pages.dev
```

All existing bot env vars stay the same. See `.env.example`.

---

## Local development

```bash
# 1. Install deps (same as bot)
pip install -r requirements.txt

# 2. Set env (copy .env.example → .env / export vars)

# 3. Run bot (starts aiohttp on PORT)
python bot.py

# 4. Open frontend
# Same host:  http://localhost:8080/app
# Or open web/index.html via any static server and set:
#   window.API_BASE = "http://localhost:8080"
```

### API smoke tests

```bash
curl http://localhost:8080/api/health
curl "http://localhost:8080/api/search?q=avengers&limit=5"
curl "http://localhost:8080/api/items/latest?limit=5"
curl http://localhost:8080/api/stats
curl -H "X-API-Key: $WEB_API_KEY" http://localhost:8080/api/admin/dashboard
```

---

## Deploy backend (VPS / Koyeb / Railway / Heroku)

Same as the original bot. Ensure:

1. `PORT`, `FQDN`, `HAS_SSL` are correct so `URL` is public HTTPS.
2. MongoDB is reachable.
3. `WEB_API_KEY` is set if you use admin endpoints.
4. `CORS_ORIGINS` includes your frontend origin if frontend is on another domain.

Docker / Procfile / heroku.yml already start `bot.py` — no change required for basic run.

---

## Deploy frontend (Cloudflare Pages)

1. Create a Pages project.
2. Upload the `web/` folder (or connect a repo that contains only the built static files).
3. In Pages → Settings → Environment variables / or edit `index.html`:

```html
<script>
  window.API_BASE = "https://YOUR-BACKEND-DOMAIN";
</script>
```

4. Custom domain optional.

Alternatively serve everything from the bot host via `/app` (already wired).

---

## Indexing speed improvements

**Before:** each file → `save_file()` → individual insert + optional size check.

**After:**

- `bulk_save_files()` prepares docs, one existence `$in` query, then `insert_many(ordered=False)`.
- Index batch size raised `200 → 300`.
- Size check runs once per batch, not per file.

Expected: **several times faster** on large channels, especially with high duplicate rates.

To re-index: use the same Telegram index flow (`/index` request → Accept).

---

## Security checklist

- [ ] `BOT_TOKEN`, `API_ID`, `API_HASH`, Mongo URIs **never** in frontend code
- [ ] `WEB_API_KEY` strong and only on server
- [ ] Admin routes require `X-API-Key`
- [ ] Rate limit: 90 req/min/IP on public API
- [ ] CORS restricted in production (`CORS_ORIGINS`)
- [ ] Input length limits on search query
- [ ] No arbitrary URL proxy / SSRF endpoints added
- [ ] Stream routes still use hash check (existing)

---

## API reference (public)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health + bot username |
| GET | `/api/search?q=&page=&limit=&type=` | Search (same regex engine as bot) |
| GET | `/api/items/latest?page=&limit=` | Latest by natural order |
| GET | `/api/items/{file_id}` | Detail + related |
| GET | `/api/stats` | File / user / chat counts |
| GET | `/api/admin/dashboard` | Admin metrics (`X-API-Key`) |
| GET | `/api/admin/users` | Recent users (`X-API-Key`) |

---

## Frontend features

- Mobile-first dark theme, glass effects
- Home: hero search, chips, latest grid, stats
- Search: debounce, skeleton, infinite scroll, empty/error states
- Detail: metadata, Open in Telegram, related
- Bottom nav (Home / Search / Latest)
- Toast notifications
- No heavy framework — vanilla JS

---

## Optional next steps

1. Telegram Login Widget for `/account` (premium status from users DB).
2. Search log collection for real “Trending”.
3. Store channel message_id at index time for permanent stream links.
4. Cloudflare cache on `GET /api/items/latest` (short TTL).
