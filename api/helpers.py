"""Shared helpers for the public API — parsing, formatting, rate-limit helpers."""
import re
from typing import Any, Dict, List, Optional

from info import LANGUAGES, QUALITIES

# Quality / language patterns (same spirit as bot)
_QUALITY_RE = re.compile(
    r"\b(360p|480p|720p|1080p|1440p|2160p|4K|HDRip|WEBRip|WEB-DL|BluRay|BRRip|BDRip|HDTV|CAM|TS|DVDRip|HEVC|x264|x265)\b",
    re.I,
)
_YEAR_RE = re.compile(r"(?<![A-Za-z0-9])((?:19|20)\d{2})(?![A-Za-z0-9])")
_LANG_LIST = [l for l in LANGUAGES if l]


def human_size(size: int) -> str:
    if not size:
        return "N/A"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024:
            return f"{size:.1f} {unit}" if unit != "B" else f"{size} B"
        size /= 1024
    return f"{size:.1f} PB"


def parse_meta(file_name: str) -> Dict[str, Any]:
    """Extract display metadata from filename (no DB fields exist for these)."""
    name = file_name or ""
    qualities = list({m.group(0).upper() for m in _QUALITY_RE.finditer(name)})
    years = _YEAR_RE.findall(name)
    langs = []
    lower = name.lower()
    for lang in _LANG_LIST:
        if lang and lang.lower() in lower:
            langs.append(lang.title())
    # clean title roughly
    title = re.sub(r"[_\.\-]+", " ", name)
    title = _QUALITY_RE.sub("", title)
    title = _YEAR_RE.sub("", title)
    title = re.sub(r"\s+", " ", title).strip(" .-_")
    return {
        "title": title or name,
        "year": years[0] if years else None,
        "quality": qualities[:3],
        "language": langs[:4],
    }


def media_to_dict(m, bot_username: Optional[str] = None) -> Dict[str, Any]:
    """Serialize a Media/Media2 document for JSON API."""
    fid = getattr(m, "file_id", None) or getattr(m, "pk", None) or str(getattr(m, "_id", ""))
    fname = getattr(m, "file_name", "") or ""
    meta = parse_meta(fname)
    size = getattr(m, "file_size", 0) or 0
    out = {
        "id": fid,
        "file_name": fname,
        "title": meta["title"],
        "year": meta["year"],
        "quality": meta["quality"],
        "language": meta["language"],
        "file_size": size,
        "file_size_human": human_size(size),
        "file_type": getattr(m, "file_type", None),
        "mime_type": getattr(m, "mime_type", None),
        "caption": getattr(m, "caption", None),
    }
    if bot_username:
        # Deep link — user opens bot and receives the file
        out["telegram_url"] = f"https://t.me/{bot_username}?start=file_0_{fid}"
    return out


def paginate(total: int, page: int, limit: int) -> Dict[str, Any]:
    pages = max(1, (total + limit - 1) // limit)
    return {
        "page": page,
        "limit": limit,
        "total": total,
        "pages": pages,
        "has_next": page < pages,
        "has_prev": page > 1,
    }
