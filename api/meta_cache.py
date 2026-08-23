"""In-memory + optional Mongo cache for IMDB poster/rating lookups."""
import asyncio
import logging
import re
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# title_key -> {poster, rating, imdb_title, year, ts}
_cache: Dict[str, Dict[str, Any]] = {}
_CACHE_TTL = 60 * 60 * 24 * 7  # 7 days
_lock = asyncio.Lock()
_inflight: Dict[str, asyncio.Future] = {}


def _clean_title(name: str) -> str:
    if not name:
        return ""
    t = re.sub(r"[_\.\-]+", " ", name)
    t = re.sub(
        r"\b(480p|720p|1080p|2160p|4k|webrip|web-dl|bluray|brrip|hdrip|hdts|cam|x264|x265|hevc|aac|ddp|hindi|english|tamil|telugu|malayalam|kannada|dual|audio|esub|mkv|mp4)\b",
        " ",
        t,
        flags=re.I,
    )
    t = re.sub(r"\s+", " ", t).strip(" .-_")
    # keep first ~6 words for search
    parts = t.split()
    return " ".join(parts[:6]).lower()


async def get_imdb_meta(file_name: str, title_hint: str = "") -> Dict[str, Any]:
    """Return {poster, rating, imdb_title, year, plot} — cached."""
    key = _clean_title(title_hint or file_name)
    if not key or len(key) < 2:
        return {}

    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit.get("ts", 0) < _CACHE_TTL:
        return hit

    async with _lock:
        hit = _cache.get(key)
        if hit and now - hit.get("ts", 0) < _CACHE_TTL:
            return hit
        if key in _inflight:
            fut = _inflight[key]
        else:
            fut = asyncio.get_event_loop().create_future()
            _inflight[key] = fut
            asyncio.create_task(_fetch_and_resolve(key, file_name, title_hint, fut))

    try:
        return await asyncio.wait_for(fut, timeout=8)
    except Exception:
        return hit or {}


async def _fetch_and_resolve(key: str, file_name: str, title_hint: str, fut: asyncio.Future):
    data: Dict[str, Any] = {"ts": time.time()}
    try:
        from utils import get_poster

        query = title_hint or _clean_title(file_name)
        search_q = re.sub(r"(19|20)\d{2}", "", query).strip()
        info = await get_poster(search_q or query, file=file_name)
        if info:
            data = {
                "poster": info.get("poster"),
                "rating": info.get("rating"),
                "imdb_title": info.get("title"),
                "year": info.get("year"),
                "plot": info.get("plot"),
                "imdb_id": info.get("imdb_id"),
                "genres": info.get("genres"),
                "ts": time.time(),
            }
    except Exception as e:
        logger.debug("imdb meta fail for %s: %s", key, e)

    _cache[key] = data
    if key in _inflight:
        del _inflight[key]
    if not fut.done():
        fut.set_result(data)


async def enrich_items(items: list, limit: int = 24) -> list:
    """Attach poster/rating to list of dict items (in place)."""
    tasks = []
    for it in items[:limit]:
        tasks.append(get_imdb_meta(it.get("file_name") or "", it.get("title") or ""))
    if not tasks:
        return items
    metas = await asyncio.gather(*tasks, return_exceptions=True)
    for it, meta in zip(items[:limit], metas):
        if isinstance(meta, dict) and meta:
            if meta.get("poster"):
                it["poster"] = meta["poster"]
            if meta.get("rating") and meta["rating"] not in (None, "None", "N/A"):
                try:
                    it["imdb_rating"] = float(meta["rating"])
                except (TypeError, ValueError):
                    it["imdb_rating"] = meta["rating"]
            if meta.get("imdb_title"):
                it["imdb_title"] = meta["imdb_title"]
            if meta.get("plot"):
                it["plot"] = meta["plot"]
    return items
