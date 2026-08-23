(() => {
  "use strict";

  const API = (window.API_BASE || "").replace(/\/$/, "");
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const app = $("#app");

  let botUsername = null;
  let searchTimer = null;

  function toast(msg, isError = false) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    t.classList.toggle("error", isError);
    t.classList.add("show");
    clearTimeout(t._tid);
    t._tid = setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => (t.hidden = true), 250);
    }, 2800);
  }

  async function api(path, opts = {}) {
    const url = `${API}${path}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...(opts.headers || {}) },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s ?? "";
    return d.innerHTML;
  }

  function posterHTML(item, className = "card-thumb") {
    const rating =
      item.imdb_rating != null && item.imdb_rating !== ""
        ? `<span class="rating-pill">★ ${esc(String(item.imdb_rating))}</span>`
        : "";
    if (item.poster) {
      return `<div class="${className}">${rating}<img src="${esc(item.poster)}" alt="" loading="lazy" onerror="this.style.display='none';this.parentNode.insertAdjacentHTML('beforeend','<span class=placeholder-icon>🎬</span>')"/></div>`;
    }
    return `<div class="${className}">${rating}<span class="placeholder-icon">🎬</span></div>`;
  }

  function badges(item) {
    const parts = [];
    if (item.imdb_rating != null && item.imdb_rating !== "")
      parts.push(`<span class="badge quality">★ ${esc(String(item.imdb_rating))}</span>`);
    (item.quality || []).slice(0, 2).forEach((q) => {
      parts.push(`<span class="badge quality">${esc(q)}</span>`);
    });
    if (item.year) parts.push(`<span class="badge">${esc(item.year)}</span>`);
    if (item.file_size_human)
      parts.push(`<span class="badge size">${esc(item.file_size_human)}</span>`);
    (item.language || []).slice(0, 2).forEach((l) => {
      parts.push(`<span class="badge">${esc(l)}</span>`);
    });
    return parts.join("");
  }

  function cardHTML(item) {
    const title = item.imdb_title || item.title || item.file_name || "Untitled";
    return `
      <a class="card" href="#/item/${encodeURIComponent(item.id)}" data-link>
        ${posterHTML(item)}
        <div class="card-body">
          <div class="card-title">${esc(title)}</div>
          <div class="card-meta">${badges(item)}</div>
        </div>
      </a>`;
  }

  function listItemHTML(item) {
    const title = item.imdb_title || item.title || item.file_name || "Untitled";
    return `
      <a class="list-item" href="#/item/${encodeURIComponent(item.id)}" data-link>
        ${posterHTML(item, "list-thumb")}
        <div class="list-body">
          <div class="list-title">${esc(title)}</div>
          <div class="list-sub">${esc(item.file_name || "")}</div>
          <div class="card-meta" style="margin-top:6px">${badges(item)}</div>
        </div>
      </a>`;
  }

  function skeletonGrid(n = 8) {
    return `<div class="grid">${Array.from({ length: n }, () => `<div class="skeleton skel-card"></div>`).join("")}</div>`;
  }

  function setNav(active) {
    $$(".nav-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.nav === active);
    });
  }

  async function fetchLinks(fileId) {
    return api(`/api/items/${encodeURIComponent(fileId)}/links`);
  }

  // ─── views ───
  async function viewHome() {
    setNav("home");
    app.innerHTML = `
      <section class="hero">
        <h1>MoviesHub</h1>
        <p>Search, stream online & download — no Telegram redirect needed.</p>
        <form class="search-box" id="hero-search">
          <input type="search" name="q" placeholder="Search movies, series…" autocomplete="off" enterkeyhint="search" />
          <button type="submit" class="search-go" aria-label="Search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          </button>
        </form>
        <div class="quick-chips">
          <button type="button" class="chip" data-q="1080p">1080p</button>
          <button type="button" class="chip" data-q="720p">720p</button>
          <button type="button" class="chip" data-q="hindi">Hindi</button>
          <button type="button" class="chip" data-q="english">English</button>
          <button type="button" class="chip" data-q="webrip">WEBRip</button>
        </div>
        <div class="stats-row" id="home-stats"></div>
      </section>
      <section class="section">
        <div class="section-head">
          <h2>⭐ Top IMDb</h2>
          <a href="#/top" data-link>See all</a>
        </div>
        <p class="section-sub">High-rated picks from recent library (IMDb 7+)</p>
        <div id="top-grid">${skeletonGrid(6)}</div>
      </section>
      <section class="section">
        <div class="section-head">
          <h2>🆕 Latest</h2>
          <a href="#/latest" data-link>See all</a>
        </div>
        <div id="latest-grid">${skeletonGrid(6)}</div>
      </section>`;

    $("#hero-search").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = e.target.q.value.trim();
      if (q.length >= 2) location.hash = `#/search?q=${encodeURIComponent(q)}`;
    });
    $$(".chip").forEach((c) =>
      c.addEventListener("click", () => {
        location.hash = `#/search?q=${encodeURIComponent(c.dataset.q)}`;
      })
    );

    try {
      const [latest, top, stats] = await Promise.all([
        api("/api/items/latest?limit=12"),
        api("/api/top-rated?limit=12&min_rating=7").catch(() => ({ results: [] })),
        api("/api/stats").catch(() => null),
      ]);
      if (stats?.ok) {
        $("#home-stats").innerHTML = `
          <div class="stat-pill"><strong>${(stats.stats.total_files || 0).toLocaleString()}</strong> files</div>
          <div class="stat-pill"><strong>${(stats.stats.total_users || 0).toLocaleString()}</strong> users</div>`;
      }
      const lg = $("#latest-grid");
      const tg = $("#top-grid");
      if (!latest.results?.length) {
        lg.innerHTML = `<div class="state-box"><div class="icon">📭</div><h3>No files yet</h3></div>`;
      } else {
        lg.innerHTML = `<div class="grid">${latest.results.map(cardHTML).join("")}</div>`;
      }
      if (!top.results?.length) {
        tg.innerHTML = `<div class="state-box"><div class="icon">⭐</div><h3>No rated titles yet</h3><p>IMDb data loads as items are viewed.</p></div>`;
      } else {
        tg.innerHTML = `<div class="grid">${top.results.map(cardHTML).join("")}</div>`;
      }
    } catch (e) {
      $("#latest-grid").innerHTML = `<div class="state-box"><h3>Couldn’t load</h3><p>${esc(e.message)}</p></div>`;
      $("#top-grid").innerHTML = "";
    }
  }

  async function viewSearch(params) {
    setNav("search");
    const q0 = params.get("q") || "";
    app.innerHTML = `
      <div class="search-page-bar">
        <form class="search-box" id="search-form">
          <input type="search" name="q" id="search-input" value="${esc(q0)}" placeholder="Search…" autocomplete="off" enterkeyhint="search" />
          <button type="submit" class="search-go" aria-label="Search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          </button>
        </form>
      </div>
      <div id="search-results">${q0 ? skeletonGrid(6) : `<div class="state-box"><div class="icon">🔍</div><h3>Search MoviesHub</h3><p>Type at least 2 characters.</p></div>`}</div>
      <button type="button" class="load-more" id="load-more" hidden>Load more</button>
      <div class="sentinel" id="sentinel"></div>`;

    const input = $("#search-input");
    const resultsEl = $("#search-results");
    const loadMore = $("#load-more");
    let page = 1, hasNext = false, currentQ = q0, loading = false;

    async function runSearch(reset = true) {
      if (!currentQ || currentQ.length < 2) {
        resultsEl.innerHTML = `<div class="state-box"><div class="icon">🔍</div><h3>Search MoviesHub</h3></div>`;
        loadMore.hidden = true;
        return;
      }
      if (loading) return;
      loading = true;
      if (reset) {
        page = 1;
        resultsEl.innerHTML = skeletonGrid(6);
      } else {
        loadMore.disabled = true;
        loadMore.textContent = "Loading…";
      }
      try {
        const data = await api(`/api/search?q=${encodeURIComponent(currentQ)}&page=${page}&limit=20`);
        hasNext = data.pagination?.has_next;
        if (reset) {
          resultsEl.innerHTML = data.results?.length
            ? `<div class="list">${data.results.map(listItemHTML).join("")}</div>`
            : `<div class="state-box"><div class="icon">😕</div><h3>No results</h3><p>Nothing matched “${esc(currentQ)}”.</p></div>`;
        } else if (data.results?.length) {
          if (!resultsEl.querySelector(".list")) resultsEl.innerHTML = `<div class="list"></div>`;
          resultsEl.querySelector(".list").insertAdjacentHTML("beforeend", data.results.map(listItemHTML).join(""));
        }
        loadMore.hidden = !hasNext;
        loadMore.disabled = false;
        loadMore.textContent = "Load more";
      } catch (e) {
        if (reset) resultsEl.innerHTML = `<div class="state-box"><h3>Search failed</h3><p>${esc(e.message)}</p></div>`;
        else toast(e.message, true);
        loadMore.hidden = true;
      } finally {
        loading = false;
      }
    }

    $("#search-form").addEventListener("submit", (e) => {
      e.preventDefault();
      currentQ = input.value.trim();
      history.replaceState(null, "", `#/search?q=${encodeURIComponent(currentQ)}`);
      runSearch(true);
    });
    input.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        currentQ = input.value.trim();
        if (currentQ.length >= 2 || currentQ.length === 0) {
          history.replaceState(null, "", currentQ ? `#/search?q=${encodeURIComponent(currentQ)}` : "#/search");
          runSearch(true);
        }
      }, 400);
    });
    loadMore.addEventListener("click", () => {
      if (!hasNext) return;
      page += 1;
      runSearch(false);
    });
    new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNext && !loading) {
          page += 1;
          runSearch(false);
        }
      },
      { rootMargin: "200px" }
    ).observe($("#sentinel"));
    if (q0) runSearch(true);
  }

  async function viewLatest() {
    setNav("latest");
    app.innerHTML = `
      <div class="section-head"><h2>🆕 Latest</h2></div>
      <div id="latest-page">${skeletonGrid(12)}</div>
      <button type="button" class="load-more" id="load-more" hidden>Load more</button>`;
    let page = 1, hasNext = false, loading = false;
    const el = $("#latest-page");
    const loadMore = $("#load-more");
    async function load(reset = true) {
      if (loading) return;
      loading = true;
      if (!reset) {
        loadMore.disabled = true;
        loadMore.textContent = "Loading…";
      }
      try {
        const data = await api(`/api/items/latest?page=${page}&limit=24`);
        hasNext = data.pagination?.has_next;
        const cards = (data.results || []).map(cardHTML).join("");
        if (reset) {
          el.innerHTML = data.results?.length ? `<div class="grid">${cards}</div>` : `<div class="state-box"><h3>Empty</h3></div>`;
        } else if (data.results?.length) {
          el.querySelector(".grid").insertAdjacentHTML("beforeend", cards);
        }
        loadMore.hidden = !hasNext;
        loadMore.disabled = false;
        loadMore.textContent = "Load more";
      } catch (e) {
        if (reset) el.innerHTML = `<div class="state-box"><h3>Error</h3><p>${esc(e.message)}</p></div>`;
        else toast(e.message, true);
      } finally {
        loading = false;
      }
    }
    loadMore.addEventListener("click", () => {
      page += 1;
      load(false);
    });
    load(true);
  }

  async function viewTop() {
    setNav("top");
    app.innerHTML = `
      <div class="section-head"><h2>⭐ Top IMDb</h2></div>
      <p class="section-sub">Titles with IMDb rating 7.0 and above (from recent library)</p>
      <div id="top-page">${skeletonGrid(12)}</div>`;
    try {
      const data = await api("/api/top-rated?limit=30&min_rating=7");
      const el = $("#top-page");
      if (!data.results?.length) {
        el.innerHTML = `<div class="state-box"><div class="icon">⭐</div><h3>No high-rated titles found yet</h3><p>Open more items so IMDb cache fills, then refresh.</p></div>`;
      } else {
        el.innerHTML = `<div class="grid">${data.results.map(cardHTML).join("")}</div>`;
      }
    } catch (e) {
      $("#top-page").innerHTML = `<div class="state-box"><h3>Error</h3><p>${esc(e.message)}</p></div>`;
    }
  }

  async function viewItem(id) {
    setNav(null);
    app.innerHTML = `
      <div class="detail">
        <div class="detail-poster skeleton" style="min-height:280px"></div>
        <div>
          <div class="skeleton skel-line" style="width:70%;height:28px"></div>
          <div class="skeleton skel-line short" style="margin-top:12px"></div>
        </div>
      </div>`;

    try {
      const data = await api(`/api/items/${encodeURIComponent(id)}`);
      const item = data.item;
      if (!item) throw new Error("Not found");
      const title = item.imdb_title || item.title || item.file_name;

      app.innerHTML = `
        <div class="detail">
          ${posterHTML(item, "detail-poster")}
          <div>
            <h1>${esc(title)}</h1>
            <div class="detail-meta">${badges(item)}</div>
            ${item.genres ? `<p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:8px">${esc(item.genres)}</p>` : ""}
            ${item.plot ? `<p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:12px">${esc(item.plot)}</p>` : ""}
            <p style="color:var(--text-muted);font-size:0.8rem;word-break:break-all">${esc(item.file_name || "")}</p>
            <div class="player-actions" id="play-actions">
              <button type="button" class="btn btn-primary" id="btn-stream">▶ Stream Online</button>
              <button type="button" class="btn btn-ghost" id="btn-download">⬇ Download</button>
            </div>
            <div id="player-area" hidden></div>
            <p style="margin-top:12px;font-size:0.75rem;color:var(--text-muted)">Stream/download uses your data via the server. STREAM_MODE must be on.</p>
          </div>
        </div>
        ${
          item.related?.length
            ? `<section class="section"><div class="section-head"><h2>Related</h2></div><div class="grid">${item.related.map(cardHTML).join("")}</div></section>`
            : ""
        }`;

      const btnStream = $("#btn-stream");
      const btnDl = $("#btn-download");
      const playerArea = $("#player-area");
      let links = null;

      async function ensureLinks() {
        if (links) return links;
        btnStream.classList.add("btn-loading");
        btnDl.classList.add("btn-loading");
        btnStream.textContent = "Generating…";
        try {
          links = await fetchLinks(id);
          return links;
        } finally {
          btnStream.classList.remove("btn-loading");
          btnDl.classList.remove("btn-loading");
          btnStream.textContent = "▶ Stream Online";
        }
      }

      btnStream.addEventListener("click", async () => {
        try {
          const l = await ensureLinks();
          playerArea.hidden = false;
          playerArea.innerHTML = `
            <div class="player-wrap">
              <video controls autoplay playsinline src="${esc(l.stream_url || l.download_url)}"></video>
            </div>
            <p style="font-size:0.8rem;color:var(--text-muted)">If video doesn’t play, <a href="${esc(l.stream_url)}" target="_blank" rel="noopener">open player page</a>.</p>`;
          // Prefer watch page in iframe if stream_url is watch HTML
          if (l.stream_url && l.stream_url.includes("/watch/")) {
            playerArea.innerHTML = `
              <div class="player-wrap">
                <iframe src="${esc(l.stream_url)}" allowfullscreen allow="autoplay; fullscreen"></iframe>
              </div>`;
          }
        } catch (e) {
          toast(e.message || "Stream failed", true);
        }
      });

      btnDl.addEventListener("click", async () => {
        try {
          const l = await ensureLinks();
          // Direct download URL (raw media) — opens in new tab / starts download
          const a = document.createElement("a");
          a.href = l.download_url;
          a.target = "_blank";
          a.rel = "noopener";
          a.download = "";
          document.body.appendChild(a);
          a.click();
          a.remove();
          toast("Download started");
        } catch (e) {
          toast(e.message || "Download failed", true);
        }
      });
    } catch (e) {
      app.innerHTML = `<div class="state-box"><div class="icon">⚠️</div><h3>Not found</h3><p>${esc(e.message)}</p>
        <a class="btn btn-ghost" style="margin-top:16px" href="#/" data-link>Go home</a></div>`;
    }
  }

  function parseHash() {
    const h = location.hash.slice(1) || "/";
    const [path, qs] = h.split("?");
    return { path: path || "/", params: new URLSearchParams(qs || "") };
  }

  async function route() {
    const { path, params } = parseHash();
    if (path === "/" || path === "") return viewHome();
    if (path === "/search") return viewSearch(params);
    if (path === "/latest") return viewLatest();
    if (path === "/top") return viewTop();
    if (path.startsWith("/item/")) return viewItem(decodeURIComponent(path.slice(6)));
    app.innerHTML = `<div class="state-box"><h3>404</h3><a href="#/" data-link>Home</a></div>`;
  }

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-link]");
    if (a && a.getAttribute("href")?.startsWith("#")) {
      e.preventDefault();
      location.hash = a.getAttribute("href");
    }
  });
  $("#btn-search-toggle")?.addEventListener("click", () => {
    location.hash = "#/search";
  });
  window.addEventListener("hashchange", route);

  (async () => {
    try {
      const health = await api("/api/health");
      botUsername = health.bot || null;
      const tg = $("#telegram-header");
      if (tg) tg.href = botUsername ? `https://t.me/${botUsername}` : "https://t.me/";
    } catch {
      /* offline preview */
    }
    route();
  })();
})();
