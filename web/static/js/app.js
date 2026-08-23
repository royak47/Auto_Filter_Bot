(() => {
  "use strict";

  const API = (window.API_BASE || "").replace(/\/$/, "");
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const app = $("#app");

  let botUsername = null;
  let searchTimer = null;

  // ─── utils ───
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
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", ...(opts.headers || {}) },
        ...opts,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return data;
    } catch (e) {
      if (e.name === "TypeError") throw new Error("Network error — is the API online?");
      throw e;
    }
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s ?? "";
    return d.innerHTML;
  }

  function badges(item) {
    const parts = [];
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
    const title = item.title || item.file_name || "Untitled";
    return `
      <a class="card" href="#/item/${encodeURIComponent(item.id)}" data-link>
        <div class="card-thumb"><span class="placeholder-icon">🎬</span></div>
        <div class="card-body">
          <div class="card-title">${esc(title)}</div>
          <div class="card-meta">${badges(item)}</div>
        </div>
      </a>`;
  }

  function listItemHTML(item) {
    const title = item.title || item.file_name || "Untitled";
    return `
      <a class="list-item" href="#/item/${encodeURIComponent(item.id)}" data-link>
        <div class="list-thumb">🎬</div>
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

  // ─── views ───
  async function viewHome() {
    setNav("home");
    app.innerHTML = `
      <section class="hero">
        <h1>Find files instantly</h1>
        <p>Search the indexed library. Open results in Telegram to download or stream.</p>
        <form class="search-box" id="hero-search">
          <input type="search" name="q" placeholder="Search movies, series, files…" autocomplete="off" enterkeyhint="search" />
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
          <h2>Latest</h2>
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
      const [latest, stats] = await Promise.all([
        api("/api/items/latest?limit=12"),
        api("/api/stats").catch(() => null),
      ]);
      if (stats?.ok) {
        $("#home-stats").innerHTML = `
          <div class="stat-pill"><strong>${stats.stats.total_files?.toLocaleString?.() ?? "—"}</strong> files</div>
          <div class="stat-pill"><strong>${stats.stats.total_users?.toLocaleString?.() ?? "—"}</strong> users</div>`;
      }
      const grid = $("#latest-grid");
      if (!latest.results?.length) {
        grid.innerHTML = `<div class="state-box"><div class="icon">📭</div><h3>No files yet</h3><p>Index content via the Telegram bot.</p></div>`;
      } else {
        grid.innerHTML = `<div class="grid">${latest.results.map(cardHTML).join("")}</div>`;
      }
    } catch (e) {
      $("#latest-grid").innerHTML = `<div class="state-box"><div class="icon">⚠️</div><h3>Couldn’t load</h3><p>${esc(e.message)}</p></div>`;
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
      <div id="search-results">${q0 ? skeletonGrid(6) : `<div class="state-box"><div class="icon">🔍</div><h3>Search the library</h3><p>Type at least 2 characters.</p></div>`}</div>
      <button type="button" class="load-more" id="load-more" hidden>Load more</button>
      <div class="sentinel" id="sentinel"></div>`;

    const input = $("#search-input");
    const resultsEl = $("#search-results");
    const loadMore = $("#load-more");
    let page = 1;
    let hasNext = false;
    let currentQ = q0;
    let loading = false;

    async function runSearch(reset = true) {
      if (!currentQ || currentQ.length < 2) {
        resultsEl.innerHTML = `<div class="state-box"><div class="icon">🔍</div><h3>Search the library</h3><p>Type at least 2 characters.</p></div>`;
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
        const data = await api(
          `/api/search?q=${encodeURIComponent(currentQ)}&page=${page}&limit=20`
        );
        hasNext = data.pagination?.has_next;
        const html = data.results?.length
          ? `<div class="list">${data.results.map(listItemHTML).join("")}</div>`
          : `<div class="state-box"><div class="icon">😕</div><h3>No results</h3><p>Nothing matched “${esc(currentQ)}”.</p></div>`;
        if (reset) {
          resultsEl.innerHTML = html;
        } else if (data.results?.length) {
          const list = resultsEl.querySelector(".list") || resultsEl;
          if (!resultsEl.querySelector(".list")) resultsEl.innerHTML = `<div class="list"></div>`;
          resultsEl.querySelector(".list").insertAdjacentHTML(
            "beforeend",
            data.results.map(listItemHTML).join("")
          );
        }
        loadMore.hidden = !hasNext;
        loadMore.disabled = false;
        loadMore.textContent = "Load more";
      } catch (e) {
        if (reset) {
          resultsEl.innerHTML = `<div class="state-box"><div class="icon">⚠️</div><h3>Search failed</h3><p>${esc(e.message)}</p></div>`;
        } else toast(e.message, true);
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

    // infinite scroll
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNext && !loading) {
          page += 1;
          runSearch(false);
        }
      },
      { rootMargin: "200px" }
    );
    io.observe($("#sentinel"));

    if (q0) runSearch(true);
  }

  async function viewLatest() {
    setNav("latest");
    app.innerHTML = `
      <div class="section-head"><h2>Latest files</h2></div>
      <div id="latest-page">${skeletonGrid(12)}</div>
      <button type="button" class="load-more" id="load-more" hidden>Load more</button>`;

    let page = 1;
    let hasNext = false;
    let loading = false;
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
        const cards = data.results?.map(cardHTML).join("") || "";
        if (reset) {
          el.innerHTML = data.results?.length
            ? `<div class="grid">${cards}</div>`
            : `<div class="state-box"><div class="icon">📭</div><h3>Empty</h3></div>`;
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

  async function viewItem(id) {
    setNav(null);
    app.innerHTML = `
      <div class="detail">
        <div class="detail-poster skeleton" style="min-height:280px"></div>
        <div>
          <div class="skeleton skel-line" style="width:70%;height:28px"></div>
          <div class="skeleton skel-line short" style="margin-top:12px"></div>
          <div class="skeleton skel-line short" style="margin-top:8px;width:40%"></div>
        </div>
      </div>`;

    try {
      const data = await api(`/api/items/${encodeURIComponent(id)}`);
      const item = data.item;
      if (!item) throw new Error("Not found");

      const tgUrl = item.telegram_url || (botUsername ? `https://t.me/${botUsername}` : "#");
      app.innerHTML = `
        <div class="detail">
          <div class="detail-poster">🎬</div>
          <div>
            <h1>${esc(item.title || item.file_name)}</h1>
            <div class="detail-meta">${badges(item)}</div>
            <p style="color:var(--text-muted);font-size:0.9rem;word-break:break-all">${esc(item.file_name || "")}</p>
            ${item.caption ? `<div class="detail-caption">${esc(item.caption)}</div>` : ""}
            <div class="detail-actions">
              <a class="btn btn-primary" href="${esc(tgUrl)}" target="_blank" rel="noopener">Open in Telegram</a>
              <a class="btn btn-ghost" href="#/search?q=${encodeURIComponent((item.title || "").split(" ").slice(0, 3).join(" "))}" data-link>Similar search</a>
            </div>
            ${
              item.stream_supported
                ? `<p style="margin-top:12px;font-size:0.8rem;color:var(--text-muted)">Streaming is available via the bot when online. Use “Open in Telegram” for the most reliable access.</p>`
                : ""
            }
          </div>
        </div>
        ${
          item.related?.length
            ? `<section class="section"><div class="section-head"><h2>Related</h2></div><div class="grid">${item.related.map(cardHTML).join("")}</div></section>`
            : ""
        }`;
    } catch (e) {
      app.innerHTML = `<div class="state-box"><div class="icon">⚠️</div><h3>Not found</h3><p>${esc(e.message)}</p>
        <a class="btn btn-ghost" style="margin-top:16px" href="#/" data-link>Go home</a></div>`;
    }
  }

  // ─── router ───
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
    if (path.startsWith("/item/")) {
      const id = decodeURIComponent(path.slice(6));
      return viewItem(id);
    }
    app.innerHTML = `<div class="state-box"><h3>404</h3><a href="#/" data-link>Home</a></div>`;
  }

  // intercept in-app links
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-link]");
    if (a && a.getAttribute("href")?.startsWith("#")) {
      e.preventDefault();
      location.hash = a.getAttribute("href").slice(1) ? a.getAttribute("href") : "#/";
    }
  });

  $("#btn-search-toggle")?.addEventListener("click", () => {
    location.hash = "#/search";
  });

  window.addEventListener("hashchange", route);

  // boot
  (async () => {
    try {
      const health = await api("/api/health");
      botUsername = health.bot || null;
      const tg = $("#telegram-header");
      if (tg && botUsername) {
        tg.href = `https://t.me/${botUsername}`;
      } else if (tg) {
        tg.href = "https://t.me/";
      }
    } catch {
      /* API may be on another host during static preview */
    }
    route();
  })();
})();
