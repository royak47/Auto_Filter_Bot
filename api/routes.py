"""
Public JSON API for the web frontend.
Mounted on the same aiohttp app as streaming routes.
Never exposes BOT_TOKEN, Mongo URI, or admin secrets.
"""
import asyncio
import logging
import os
import time
from collections import defaultdict
from typing import Optional

from aiohttp import web

from database.ia_filterdb import Media, Media2, get_search_results, get_file_details
from database.users_chats_db import db as users_db
from info import ADMINS, STREAM_MODE, MULTIPLE_DB, URL as BASE_URL, LOG_CHANNEL
from utils import temp
from .helpers import media_to_dict, paginate, human_size
from .meta_cache import enrich_items, get_imdb_meta
from urllib.parse import quote_plus

logger = logging.getLogger(__name__)

api_routes = web.RouteTableDef()

# Simple in-memory rate limit: ip -> [timestamps]
_rate: dict = defaultdict(list)
_RATE_WINDOW = 60
_RATE_MAX = 90  # requests per minute per IP

# Optional admin API key (set WEB_API_KEY in env)
WEB_API_KEY = os.environ.get("WEB_API_KEY", "").strip()


def _client_ip(request: web.Request) -> str:
    return (
        request.headers.get("CF-Connecting-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.remote
        or "0.0.0.0"
    )


def _rate_limit(request: web.Request) -> Optional[web.Response]:
    ip = _client_ip(request)
    now = time.time()
    hits = _rate[ip]
    _rate[ip] = [t for t in hits if now - t < _RATE_WINDOW]
    if len(_rate[ip]) >= _RATE_MAX:
        return web.json_response(
            {"ok": False, "error": "Rate limit exceeded. Try again shortly."},
            status=429,
        )
    _rate[ip].append(now)
    return None


def _bot_username() -> Optional[str]:
    return getattr(temp, "U_NAME", None)


def _require_admin(request: web.Request) -> Optional[web.Response]:
    if not WEB_API_KEY:
        return web.json_response(
            {"ok": False, "error": "Admin API not configured (WEB_API_KEY)"},
            status=503,
        )
    key = request.headers.get("X-API-Key") or request.rel_url.query.get("api_key")
    if key != WEB_API_KEY:
        return web.json_response({"ok": False, "error": "Unauthorized"}, status=401)
    return None


# ───────────────────────── CORS ─────────────────────────

@web.middleware
async def cors_middleware(request: web.Request, handler):
    if request.method == "OPTIONS":
        resp = web.Response(status=204)
    else:
        try:
            resp = await handler(request)
        except web.HTTPException as e:
            resp = e
        except Exception as e:
            logger.exception("API error")
            resp = web.json_response({"ok": False, "error": "Internal server error"}, status=500)
    origin = request.headers.get("Origin", "*")
    # Allow configured frontend origins; default *
    allowed = os.environ.get("CORS_ORIGINS", "*")
    if allowed == "*" or origin in [o.strip() for o in allowed.split(",")]:
        resp.headers["Access-Control-Allow-Origin"] = origin if allowed != "*" else "*"
    else:
        resp.headers["Access-Control-Allow-Origin"] = allowed.split(",")[0].strip()
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-API-Key"
    resp.headers["Access-Control-Max-Age"] = "86400"
    return resp


# ───────────────────────── Health ─────────────────────────

@api_routes.get("/api/health")
async def api_health(request: web.Request):
    return web.json_response({
        "ok": True,
        "service": "dreamxbotz-api",
        "stream_mode": bool(STREAM_MODE),
        "bot": _bot_username(),
    })


# ───────────────────────── Search ─────────────────────────

@api_routes.get("/api/search")
async def api_search(request: web.Request):
    if limited := _rate_limit(request):
        return limited

    q = (request.rel_url.query.get("q") or "").strip()
    if not q or len(q) < 2:
        return web.json_response(
            {"ok": False, "error": "Query must be at least 2 characters"},
            status=400,
        )
    if len(q) > 120:
        q = q[:120]

    try:
        page = max(1, int(request.rel_url.query.get("page", "1")))
        limit = min(50, max(1, int(request.rel_url.query.get("limit", "20"))))
    except ValueError:
        return web.json_response({"ok": False, "error": "Invalid page/limit"}, status=400)

    file_type = request.rel_url.query.get("type")  # video / document / audio
    offset = (page - 1) * limit

    try:
        files, next_offset, total = await get_search_results(
            chat_id=None,
            query=q,
            file_type=file_type,
            max_results=limit,
            offset=offset,
            filter=True,
        )
    except Exception as e:
        logger.exception("search failed")
        return web.json_response({"ok": False, "error": "Search failed"}, status=500)

    bot_user = _bot_username()
    results = [media_to_dict(f, bot_user) for f in files]
    await enrich_items(results, limit=len(results))

    return web.json_response({
        "ok": True,
        "query": q,
        "results": results,
        "pagination": paginate(total, page, limit),
        "next_offset": next_offset if next_offset != "" else None,
    })


# ───────────────────────── Latest ─────────────────────────

@api_routes.get("/api/items/latest")
async def api_latest(request: web.Request):
    if limited := _rate_limit(request):
        return limited

    try:
        page = max(1, int(request.rel_url.query.get("page", "1")))
        limit = min(50, max(1, int(request.rel_url.query.get("limit", "24"))))
    except ValueError:
        return web.json_response({"ok": False, "error": "Invalid page/limit"}, status=400)

    offset = (page - 1) * limit
    try:
        # Natural order = insertion order ≈ latest
        cursor1 = Media.find({}).sort("$natural", -1).skip(offset).limit(limit)
        files1 = await cursor1.to_list(length=limit)
        total = await Media.count_documents({})
        if MULTIPLE_DB:
            total += await Media2.count_documents({})
            remaining = limit - len(files1)
            if remaining > 0:
                # If primary exhausted, pull from secondary
                skip2 = max(0, offset - await Media.count_documents({}))
                cursor2 = Media2.find({}).sort("$natural", -1).skip(skip2).limit(remaining)
                files2 = await cursor2.to_list(length=remaining)
                files1 = files1 + files2
        files = files1
    except Exception:
        logger.exception("latest failed")
        return web.json_response({"ok": False, "error": "Failed to load latest"}, status=500)

    bot_user = _bot_username()
    results = [media_to_dict(f, bot_user) for f in files]
    await enrich_items(results, limit=len(results))
    return web.json_response({
        "ok": True,
        "results": results,
        "pagination": paginate(total, page, limit),
    })


# ───────────────────────── Item detail ─────────────────────────

@api_routes.get("/api/items/{file_id}")
async def api_item(request: web.Request):
    if limited := _rate_limit(request):
        return limited

    file_id = request.match_info["file_id"]
    if not file_id or len(file_id) > 200:
        return web.json_response({"ok": False, "error": "Invalid id"}, status=400)

    try:
        files = await get_file_details(file_id)
    except Exception:
        logger.exception("item detail failed")
        return web.json_response({"ok": False, "error": "Lookup failed"}, status=500)

    if not files:
        return web.json_response({"ok": False, "error": "Not found"}, status=404)

    f = files[0]
    bot_user = _bot_username()
    item = media_to_dict(f, bot_user)

    # Related: search by first meaningful tokens of title
    related = []
    try:
        title = item.get("title") or item.get("file_name") or ""
        tokens = [t for t in title.split() if len(t) > 2][:3]
        if tokens:
            q = " ".join(tokens)
            rel_files, _, _ = await get_search_results(
                None, q, max_results=8, offset=0, filter=True
            )
            related = [
                media_to_dict(r, bot_user)
                for r in rel_files
                if getattr(r, "file_id", None) != file_id
            ][:6]
    except Exception:
        pass

    item["related"] = related
    item["stream_supported"] = bool(STREAM_MODE)
    meta = await get_imdb_meta(item.get("file_name") or "", item.get("title") or "")
    if meta.get("poster"):
        item["poster"] = meta["poster"]
    if meta.get("rating") and str(meta.get("rating")) not in ("None", "N/A", ""):
        try:
            item["imdb_rating"] = float(meta["rating"])
        except (TypeError, ValueError):
            item["imdb_rating"] = meta["rating"]
    if meta.get("plot"):
        item["plot"] = meta["plot"]
    if meta.get("imdb_title"):
        item["imdb_title"] = meta["imdb_title"]
    if meta.get("genres"):
        item["genres"] = meta["genres"]
    await enrich_items(related, limit=len(related))
    return web.json_response({"ok": True, "item": item})


# ───────────────────────── Stats (public limited) ─────────────────────────

@api_routes.get("/api/stats")
async def api_stats(request: web.Request):
    if limited := _rate_limit(request):
        return limited
    try:
        total_files = await Media.count_documents({})
        if MULTIPLE_DB:
            total_files += await Media2.count_documents({})
        total_users = await users_db.total_users_count()
        total_chats = await users_db.total_chat_count()
    except Exception:
        logger.exception("stats failed")
        return web.json_response({"ok": False, "error": "Stats unavailable"}, status=500)

    return web.json_response({
        "ok": True,
        "stats": {
            "total_files": total_files,
            "total_users": total_users,
            "total_chats": total_chats,
        },
    })


# ───────────────────────── Admin ─────────────────────────

@api_routes.get("/api/admin/dashboard")
async def api_admin_dashboard(request: web.Request):
    if err := _require_admin(request):
        return err
    try:
        total_files = await Media.count_documents({})
        if MULTIPLE_DB:
            total_files += await Media2.count_documents({})
        total_users = await users_db.total_users_count()
        total_chats = await users_db.total_chat_count()
        banned_users, banned_chats = await users_db.get_banned()
        banned_u = await banned_users.to_list(length=5000)
        banned_c = await banned_chats.to_list(length=1000)
    except Exception:
        logger.exception("admin dashboard failed")
        return web.json_response({"ok": False, "error": "Failed"}, status=500)

    return web.json_response({
        "ok": True,
        "dashboard": {
            "total_files": total_files,
            "total_users": total_users,
            "total_chats": total_chats,
            "banned_users": len(banned_u),
            "banned_chats": len(banned_c),
            "bot_username": _bot_username(),
            "stream_mode": bool(STREAM_MODE),
            "multiple_db": bool(MULTIPLE_DB),
        },
    })


@api_routes.get("/api/admin/users")
async def api_admin_users(request: web.Request):
    if err := _require_admin(request):
        return err
    try:
        limit = min(100, max(1, int(request.rel_url.query.get("limit", "50"))))
        cursor = users_db.get_all_users()
        users = await cursor.to_list(length=limit)
        # strip sensitive-ish fields if any
        safe = []
        for u in users:
            safe.append({
                "id": u.get("id"),
                "name": u.get("name"),
                "ban_status": u.get("ban_status"),
            })
        return web.json_response({"ok": True, "users": safe})
    except Exception:
        logger.exception("admin users failed")
        return web.json_response({"ok": False, "error": "Failed"}, status=500)


# ───────────────────────── Stream / Download links ─────────────────────────

@api_routes.post("/api/items/{file_id}/links")
@api_routes.get("/api/items/{file_id}/links")
async def api_item_links(request: web.Request):
    """Generate watch + download URLs via LOG_CHANNEL (same as bot stream)."""
    if limited := _rate_limit(request):
        return limited

    if not STREAM_MODE:
        return web.json_response(
            {"ok": False, "error": "Streaming is disabled on this server"},
            status=503,
        )

    file_id = request.match_info["file_id"]
    if not file_id or len(file_id) > 200:
        return web.json_response({"ok": False, "error": "Invalid id"}, status=400)

    # Verify file exists in DB
    try:
        files = await get_file_details(file_id)
    except Exception:
        files = None
    if not files:
        return web.json_response({"ok": False, "error": "Not found"}, status=404)

    try:
        from dreamxbotz.Bot import dreamxbotz, multi_clients
        from dreamxbotz.util.file_properties import get_hash, get_name

        client = dreamxbotz
        if multi_clients:
            try:
                index = min(multi_clients, key=lambda k: 0)
                # multi_clients is dict id->client; prefer main bot
                client = dreamxbotz
            except Exception:
                client = dreamxbotz

        log_msg = await client.send_cached_media(chat_id=LOG_CHANNEL, file_id=file_id)
        name = get_name(log_msg) or "file"
        h = get_hash(log_msg)
        base = (BASE_URL or "").rstrip("/") + "/"
        stream_url = f"{base}watch/{log_msg.id}/{quote_plus(name)}?hash={h}"
        download_url = f"{base}{log_msg.id}/{quote_plus(name)}?hash={h}"
        return web.json_response({
            "ok": True,
            "stream_url": stream_url,
            "download_url": download_url,
            "message_id": log_msg.id,
        })
    except Exception as e:
        logger.exception("link generation failed")
        return web.json_response(
            {"ok": False, "error": f"Could not generate links: {type(e).__name__}"},
            status=500,
        )


# ───────────────────────── Top rated (IMDB) ─────────────────────────

@api_routes.get("/api/top-rated")
async def api_top_rated(request: web.Request):
    """Latest files enriched with IMDB, filtered to rating >= min_rating."""
    if limited := _rate_limit(request):
        return limited
    try:
        limit = min(40, max(1, int(request.rel_url.query.get("limit", "20"))))
        min_rating = float(request.rel_url.query.get("min_rating", "7.0"))
    except ValueError:
        return web.json_response({"ok": False, "error": "Invalid params"}, status=400)

    try:
        # Pull a larger recent pool, then filter by rating
        pool = 80
        cursor1 = Media.find({}).sort("$natural", -1).limit(pool)
        files1 = await cursor1.to_list(length=pool)
        if MULTIPLE_DB and len(files1) < pool:
            cursor2 = Media2.find({}).sort("$natural", -1).limit(pool - len(files1))
            files1 = files1 + await cursor2.to_list(length=pool - len(files1))
    except Exception:
        logger.exception("top-rated fetch failed")
        return web.json_response({"ok": False, "error": "Failed"}, status=500)

    bot_user = _bot_username()
    results = [media_to_dict(f, bot_user) for f in files1]
    await enrich_items(results, limit=len(results))

    top = []
    for it in results:
        r = it.get("imdb_rating")
        try:
            rf = float(r) if r is not None else 0
        except (TypeError, ValueError):
            rf = 0
        if rf >= min_rating:
            it["_sort_rating"] = rf
            top.append(it)

    top.sort(key=lambda x: x.get("_sort_rating", 0), reverse=True)
    for it in top:
        it.pop("_sort_rating", None)

    return web.json_response({
        "ok": True,
        "results": top[:limit],
        "min_rating": min_rating,
    })
