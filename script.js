const USERNAME = "dipdagod";

// Cloudflare Worker that KV-caches the GitHub API response (refreshes once
// a day upstream, no matter how often "pull" is clicked here).
// Replace with your actual worker URL, e.g. https://logger.yourname.workers.dev
const WORKER_BASE = "https://logger.dhairyaplayz97.workers.dev";

const EXCLUDE = [
    "dipdagod.github.io",
    "projects-showcase",
    "Wisdom-Woods",
    "DipDaGod",
];

const SORT_BY_STARS = false;

const CACHE_KEY = "github_repo_cache"; // whatever's here is what a reload shows — reloading never fetches

const grid = document.getElementById("grid");
const subtitle = document.getElementById("subtitle");
const status = document.getElementById("status");
const refreshBtn = document.getElementById("refresh");
const uptimeEl = document.getElementById("uptime");
const helpPanel = document.getElementById("help-panel");
const helpToggle = document.getElementById("help-toggle");
const statsBar = document.getElementById("stats-bar");
const langBar = document.getElementById("lang-bar");
const langChips = document.getElementById("lang-chips");
const sortSelect = document.getElementById("sort");

let allRepos = [];
let activeLanguage = null;
let currentSort = "updated";

const PAGE_LOAD_TIME = Date.now();

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Animates a number from 0 up to `target`, writing through `render(n)` each
// frame. Used for the stats bar so it feels like the numbers are tallying
// up rather than just appearing.
function animateNumber(target, render, duration = 700){
    if(prefersReducedMotion){
        render(target);
        return;
    }

    const start = performance.now();

    function tick(now){
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
        render(Math.round(target * eased));
        if(t < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}

// -------------------------
// Boot sequence — purely cosmetic, skippable, respects reduced motion
// -------------------------
const BOOT_LINES = [
    "[    0.000000] dipdagod-kernel: booting projects-showcase",
    "[    0.041233] mounting ~/projects (ro)",
    "[    0.089510] fonts: jetbrains-mono, inter ... ok",
    "[    0.114882] checking local cache ...",
    "[    0.152007] init ui ... ok",
];

function runBootSequence(){
    const boot = document.getElementById("boot");

    if(prefersReducedMotion){
        boot.remove();
        return;
    }

    let i = 0;
    const hint = boot.querySelector(".boot-hint");

    function addLine(){
        if(i >= BOOT_LINES.length){
            const ready = document.createElement("div");
            ready.className = "boot-line boot-ready";
            ready.textContent = "ready_";
            boot.insertBefore(ready, hint);
            setTimeout(finish, 260);
            return;
        }

        const line = document.createElement("div");
        line.className = "boot-line";
        line.textContent = BOOT_LINES[i];
        boot.insertBefore(line, hint);
        i++;
        setTimeout(addLine, 90);
    }

    function finish(){
        boot.classList.add("boot-done");
        boot.removeEventListener("click", skip);
        document.removeEventListener("keydown", skip);
        setTimeout(() => boot.remove(), 320);
    }

    function skip(){
        boot.removeEventListener("click", skip);
        document.removeEventListener("keydown", skip);
        finish();
    }

    boot.addEventListener("click", skip);
    document.addEventListener("keydown", skip);

    addLine();
}

runBootSequence();

// -------------------------
// Live uptime ticker — genuine time-since-page-load, not decorative fluff
// -------------------------
function tickUptime(){
    const secs = Math.floor((Date.now() - PAGE_LOAD_TIME) / 1000);
    const m = String(Math.floor(secs / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    uptimeEl.textContent = `uptime ${m}:${s}`;
}

tickUptime();
setInterval(tickUptime, 1000);

// -------------------------
// Help panel ("?" toggles, matches the man-page vibe)
// -------------------------
function setHelpVisible(visible){
    helpPanel.hidden = !visible;
}

helpToggle.addEventListener("click", () => setHelpVisible(helpPanel.hidden));

// -------------------------
// Language colors (subset of GitHub's linguist palette)
// -------------------------
const LANG_COLORS = {
    JavaScript:"#F7DF1E", TypeScript:"#3178C6", Python:"#3572A5",
    HTML:"#E34F26", CSS:"#563D7C", Shell:"#89e051", Java:"#b07219",
    "C++":"#f34b7d", C:"#555555", "C#":"#178600", Go:"#00ADD8",
    Rust:"#dea584", PHP:"#4F5D95", Ruby:"#701516", Swift:"#F05138",
    Kotlin:"#A97BFF", Dart:"#00B4AB", Vue:"#41b883", Jupyter:"#DA5B0B"
};

const LANG_COLORS_LC = Object.fromEntries(
    Object.entries(LANG_COLORS).map(([k, v]) => [k.toLowerCase(), v])
);

// Case-insensitive since GitHub topics are lowercase but this map's keys
// aren't. Pass fallback=null to find out whether a language/topic is
// actually recognized (used to decide whether to show a dot at all).
function langColor(lang, fallback = "#8b949e"){
    return LANG_COLORS_LC[String(lang).toLowerCase()] ?? fallback;
}

// -------------------------
// Single source of truth for per-language counts — the stats bar, the
// language bar, and the filter chips all read from this instead of each
// looping the repo list themselves.
// -------------------------
function getLangBreakdown(repos){
    const counts = {};
    let total = 0;

    repos.forEach(r => {
        if(r.language){
            counts[r.language] = (counts[r.language] || 0) + 1;
            total++;
        }
    });

    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    return { counts, entries, total };
}

// -------------------------
// Stats bar — computed off the full repo set, not the filtered view.
// Repo count and star count animate up rather than snapping to place.
// -------------------------
function renderStatsBar(repos, breakdown){
    const totalStars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);
    const topLang = breakdown.entries[0]?.[0] ?? "—";

    statsBar.innerHTML = `
        <div class="stat-box">
            <span class="stat-value" id="stat-repos">0</span>
            <span class="stat-label">repositories</span>
        </div>
        <div class="stat-box">
            <span class="stat-value accent" id="stat-stars">★ 0</span>
            <span class="stat-label">total stars</span>
        </div>
        <div class="stat-box">
            <span class="stat-value">${breakdown.entries.length}</span>
            <span class="stat-label">languages</span>
        </div>
        <div class="stat-box">
            <span class="stat-value" style="color:${langColor(topLang)}">${escapeHtml(topLang)}</span>
            <span class="stat-label">top language</span>
        </div>
    `;

    const reposEl = document.getElementById("stat-repos");
    const starsEl = document.getElementById("stat-stars");

    animateNumber(repos.length, n => reposEl.textContent = n);
    animateNumber(totalStars, n => starsEl.textContent = `★ ${n}`);
}

// -------------------------
// Language distribution bar — fills left to right on render, GitHub-style.
// -------------------------
function renderLangBar(breakdown){
    if(breakdown.total === 0){
        langBar.innerHTML = "";
        return;
    }

    langBar.innerHTML = breakdown.entries.map(([lang, count]) => {
        const pct = (count / breakdown.total) * 100;
        return `<span class="lang-bar-seg" style="background:${langColor(lang)}" data-pct="${pct}" title="${escapeHtml(lang)} — ${count}"></span>`;
    }).join("");

    // Set widths on the next frame so the 0 → target change actually
    // transitions instead of rendering already-filled.
    requestAnimationFrame(() => {
        langBar.querySelectorAll(".lang-bar-seg").forEach(seg => {
            seg.style.width = `${seg.dataset.pct}%`;
        });
    });
}

// -------------------------
// Language filter chips
// -------------------------
function renderLangChips(repos, breakdown){
    if(activeLanguage && !breakdown.counts[activeLanguage]){
        activeLanguage = null; // previously active language no longer present (e.g. after a fresh pull)
    }

    const allChip = `
        <button class="chip ${activeLanguage === null ? "active" : ""}" data-lang="">
            all <span style="opacity:.6">${repos.length}</span>
        </button>
    `;

    const langChipsHtml = breakdown.entries.map(([lang, count]) => `
        <button class="chip ${activeLanguage === lang ? "active" : ""}" data-lang="${escapeHtml(lang)}">
            <span class="lang-dot" style="background:${langColor(lang)}"></span>
            ${escapeHtml(lang)} <span style="opacity:.6">${count}</span>
        </button>
    `).join("");

    langChips.innerHTML = allChip + langChipsHtml;

    langChips.querySelectorAll(".chip").forEach(chip => {
        chip.addEventListener("click", () => {
            activeLanguage = chip.dataset.lang || null;
            renderLangChips(repos, breakdown); // refresh active states
            applyFilter();
        });
    });
}

// Single call site for "recompute everything language-related off this
// repo list" — used everywhere allRepos changes, instead of three separate
// render calls copy-pasted at each call site.
function renderLangSections(repos){
    const breakdown = getLangBreakdown(repos);
    renderStatsBar(repos, breakdown);
    renderLangBar(breakdown);
    renderLangChips(repos, breakdown);
}

function clearLangSections(){
    statsBar.innerHTML = "";
    langBar.innerHTML = "";
    langChips.innerHTML = "";
}

// -------------------------
// Refresh button state
// -------------------------
function setButtonState(state){
    refreshBtn.classList.remove("loading", "success", "error");

    if(state === "loading"){
        refreshBtn.disabled = true;
        refreshBtn.classList.add("loading");
        refreshBtn.querySelector(".label").textContent = "pulling...";
        return;
    }

    refreshBtn.disabled = false;
    refreshBtn.querySelector(".label").textContent = "pull";

    if(state === "success" || state === "error"){
        refreshBtn.classList.add(state);
        setTimeout(() => refreshBtn.classList.remove(state), 1000);
    }
}

// -------------------------
// Fetch repositories — every click hits the network for real. The worker
// enforces the actual rate limit; if it 429s us, we just settle the button
// back to normal with no error — nothing to fake client-side anymore.
// -------------------------
async function fetchRepos(){

    setButtonState("loading");

    if(allRepos.length === 0){
        renderSkeleton();
    } else {
        grid.classList.add("refreshing");
    }

    try{

        const response = await fetch(
            `${WORKER_BASE}?project=showcase&path=repos`,
            { cache: "no-store" }
        );

        if(response.status === 429){
            grid.classList.remove("refreshing");
            setButtonState("success");
            return;
        }

        if(!response.ok){
            throw new Error(`Worker returned ${response.status} — check allowedOrigins / WORKER_BASE in logger.js`);
        }

        let repos = await response.json();

        repos = repos.filter(repo =>
            !repo.fork &&
            !EXCLUDE.includes(repo.name)
        );

        if(SORT_BY_STARS){
            repos.sort((a,b)=>b.stargazers_count-a.stargazers_count);
        }

        allRepos = repos;

        grid.classList.remove("refreshing");
        renderLangSections(allRepos);
        applyFilter();

        localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
                time: Date.now(),
                data: repos
            })
        );

        subtitle.textContent =
            `${repos.length} public repositories · live`;

        status.textContent =
            `last synced ${new Date().toLocaleString()}`;

        setButtonState("success");

    }
    catch(err){

        console.error(err);

        grid.classList.remove("refreshing");

        subtitle.textContent = "fatal: repo fetch failed";

        status.textContent = err.message;

        grid.innerHTML = `
            <div class="card notice">
                <strong>✗ Failed to load repositories</strong>
                <span>${escapeHtml(err.message)}</span>
            </div>
        `;

        setButtonState("error");
        return;
    }
}

// -------------------------
// Skeleton placeholders (shown while loading with no existing data yet)
// -------------------------
function renderSkeleton(count = 6){
    grid.innerHTML = Array.from({ length: count }).map(() => `
        <div class="skeleton">
            <div class="skel-line" style="width:55%;height:14px;"></div>
            <div class="skel-line" style="width:90%;"></div>
            <div class="skel-line" style="width:70%;"></div>
            <div class="skel-line" style="width:40%;margin-top:auto;"></div>
        </div>
    `).join("");
}

// -------------------------
// Render
// -------------------------
function render(repos, query = ""){

    if(repos.length === 0){
        grid.innerHTML = query
            ? `<div class="empty">no matches for “${escapeHtml(query)}”</div>`
            : `<div class="empty">no repositories to show</div>`;
        return;
    }

    grid.innerHTML = repos.map((repo, i) => {

        const topics = repo.topics || [];
        const featured = topics.includes("featured");
        const tags = topics.filter(t => t !== "featured");
        if(tags.length === 0 && repo.language) tags.push(repo.language);

        const previewSrc = repo.ogImage || `https://opengraph.githubassets.com/1/${USERNAME}/${repo.name}`;

        return `
        <div class="card ${featured ? "card-featured" : ""}" style="--card-delay:${Math.min(i, 10) * 30}ms">

            <div class="card-header">
                <div class="name-row">
                    <span class="branch-icon">⌥</span>
                    <a
                        class="name"
                        href="${repo.html_url}"
                        target="_blank"
                    >
                        ${highlightMatch(repo.name, query)}
                    </a>
                </div>
                ${featured ? `<span class="featured-badge">Featured</span>` : ""}
            </div>

            <div class="card-divider"></div>

            <div class="card-preview">
                <img
                    class="card-thumb"
                    src="${previewSrc}"
                    alt=""
                    loading="lazy"
                    onerror="this.closest('.card-preview').remove()"
                >
            </div>

            <div class="card-divider"></div>

            <div class="desc">
                ${repo.description
                    ? escapeHtml(repo.description)
                    : "No description."}
            </div>

            ${
                tags.length
                    ? `
                    <div class="tech-tags">
                        ${tags.map(tag => {
                            const dotColor = langColor(tag, null);
                            return `
                            <span class="tech-tag">
                                ${dotColor ? `<span class="lang-dot" style="background:${dotColor}"></span>` : ""}
                                ${escapeHtml(tag)}
                            </span>
                            `;
                        }).join("")}
                    </div>
                    `
                    : ""
            }

            <div class="card-actions">
                ${
                    repo.homepage
                        ? `
                        <a class="visit-site-btn" href="${repo.homepage}" target="_blank">
                            <span class="arrow">↗</span> Visit Site
                        </a>
                        `
                        : ""
                }
                <a class="github-link" href="${repo.html_url}" target="_blank">Github</a>
            </div>

            <div class="meta">
                <span>★ ${repo.stargazers_count}</span>
                <span>
                    ${new Date(repo.pushed_at).toLocaleDateString()}
                </span>
            </div>

        </div>
    `}).join("");

}

// -------------------------
// Escape HTML
// -------------------------
function escapeHtml(str){

    return String(str).replace(/[&<>"']/g, m => ({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        "\"":"&quot;",
        "'":"&#39;"
    })[m]);

}

// Wraps the matched substring of a repo name in <mark>, case-insensitively.
function highlightMatch(name, query){
    if(!query) return escapeHtml(name);

    const idx = name.toLowerCase().indexOf(query.toLowerCase());
    if(idx === -1) return escapeHtml(name);

    const before = escapeHtml(name.slice(0, idx));
    const match = escapeHtml(name.slice(idx, idx + query.length));
    const after = escapeHtml(name.slice(idx + query.length));

    return `${before}<mark>${match}</mark>${after}`;
}

// -------------------------
// Filter
// -------------------------
const filterInput = document.getElementById("filter");
const filterClear = document.getElementById("filter-clear");

let filterDebounce;

// -------------------------
// Sort + filter pipeline
// -------------------------
function getVisibleRepos(){
    let repos = [...allRepos];

    if(currentSort === "stars"){
        repos.sort((a, b) => b.stargazers_count - a.stargazers_count);
    } else if(currentSort === "name"){
        repos.sort((a, b) => a.name.localeCompare(b.name));
    } else {
        repos.sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));
    }

    if(activeLanguage){
        repos = repos.filter(r => r.language === activeLanguage);
    }

    const q = filterInput.value.trim().toLowerCase();
    if(q){
        repos = repos.filter(r => r.name.toLowerCase().includes(q));
    }

    return repos;
}

function applyFilter(){
    const raw = filterInput.value.trim();
    const q = raw.toLowerCase();

    filterClear.classList.toggle("visible", filterInput.value.length > 0);

    if(q === "sudo"){
        grid.innerHTML = `
            <div class="empty">
                Permission denied
                <span style="font-size:.72rem;opacity:.55;">
                    (dipdagod is not in the sudoers file. this incident will be reported.)
                </span>
            </div>
        `;
        return;
    }

    render(getVisibleRepos(), raw);
}

sortSelect.addEventListener("change", () => {
    currentSort = sortSelect.value;
    applyFilter();
});

filterInput.addEventListener("input", () => {
    clearTimeout(filterDebounce);
    filterDebounce = setTimeout(applyFilter, 120);
});

filterClear.addEventListener("click", () => {
    filterInput.value = "";
    applyFilter();
    filterInput.focus();
});

document.addEventListener("keydown", e => {
    const tag = document.activeElement.tagName;
    const isTyping = tag === "INPUT" || tag === "TEXTAREA";

    if(e.key === "/" && !isTyping){
        e.preventDefault();
        filterInput.focus();
    }

    if(e.key === "?" && !isTyping){
        setHelpVisible(helpPanel.hidden);
    }

    if(e.key === "Escape"){
        if(!helpPanel.hidden){
            setHelpVisible(false);
            return;
        }

        if(document.activeElement === filterInput){
            filterInput.value = "";
            applyFilter();
            filterInput.blur();
        }
    }
});

// -------------------------
// Refresh button
// -------------------------
refreshBtn.addEventListener("click", () => {
    fetchRepos();
});

// -------------------------
// Initial load — reload does nothing. Just show whatever's cached, if
// anything. Only the pull button ever talks to the network.
// -------------------------
(function loadFromCache(){
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");

    if(cache && cache.data && cache.data.length){
        allRepos = cache.data;
        renderLangSections(allRepos);
        applyFilter();

        subtitle.textContent =
            `${allRepos.length} public repositories · cached`;

        status.textContent =
            `last synced ${new Date(cache.time).toLocaleString()}`;
    } else {
        subtitle.textContent = "no cached data yet";
        status.textContent = "hit pull to load repositories";
        clearLangSections();
        grid.innerHTML = `
            <div class="empty">
                <span>no data yet</span>
                <button class="cta-btn" id="empty-pull">⟳ pull now</button>
            </div>
        `;
        document.getElementById("empty-pull").addEventListener("click", fetchRepos);
    }
})();