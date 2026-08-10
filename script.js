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
const sortDropdown = document.getElementById("sort-dropdown");
const sortToggle = document.getElementById("sort-toggle");
const sortMenu = document.getElementById("sort-menu");
const bgGlow = document.getElementById("bg-glow");

let allRepos = [];
let activeLanguage = null;
let currentSort = "updated";

const PAGE_LOAD_TIME = Date.now();

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Touch/no-hover devices get no benefit from cursor-tracking effects — skip them entirely instead of running rAF loops for nothing.
const isTouchDevice = window.matchMedia("(hover: none), (pointer: coarse)").matches;

// Motion (motion.dev) loads via CDN in index.html. If it fails, motionAnimate stays null and every spring call below just no-ops — CSS :hover still works.
const motionAnimate = (typeof Motion !== "undefined" && Motion.animate) || null;

// Spring-animates el to `props` if Motion loaded; otherwise does nothing
// (the CSS :hover rules still apply on their own in that case).
function springTo(el, props, opts = {}){
    if(!motionAnimate || prefersReducedMotion) return;
    motionAnimate(el, props, { type: "spring", stiffness: 300, damping: 22, ...opts });
}

// Binds a springy scale-up-on-hover to one or more elements. Safe to call
// repeatedly on freshly-created DOM nodes (cards, chips) since it's just
// addEventListener on whatever's passed in.
function addHoverScale(els, hoverScale = 1.06){
    els.forEach(el => {
        el.addEventListener("mouseenter", () => springTo(el, { scale: hoverScale }));
        el.addEventListener("mouseleave", () => springTo(el, { scale: 1 }));
    });
}

// Ambient background — cursor-following glow, rAF-throttled.
(function initBackgroundMotion(){
    if(!motionAnimate || prefersReducedMotion || isTouchDevice) return;

    const glowRadius = 380; // half of #bg-glow's 760px width/height, for centering

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let queued = false;

    function update(){
        motionAnimate(bgGlow,
            { x: mouseX - glowRadius, y: mouseY - glowRadius },
            { type: "spring", stiffness: 26, damping: 24, mass: 0.6 }
        );

        queued = false;
    }

    window.addEventListener("mousemove", e => {
        mouseX = e.clientX;
        mouseY = e.clientY;

        if(!queued){
            queued = true;
            requestAnimationFrame(update);
        }
    });
})();

// ASCII flow field — glyphs bend toward the cursor and ease back. Canvas-based (not per-glyph DOM) for perf across hundreds of cells.
(function initAsciiFlowField(){
    const canvas = document.getElementById("ascii-flow");
    const ctx = canvas && canvas.getContext("2d");
    if(!ctx) return;

    const GLYPH = "·";
    const SPACING = 34;              // px between glyph centers
    const INFLUENCE_RADIUS = 200;    // px — how far the cursor's pull reaches
    const MAX_ROTATION = Math.PI / 3;
    const REST_OPACITY = 0.16;
    const PEAK_OPACITY = 0.6;
    const EASE = 0.08;               // per-frame smoothing — lower = slower, floatier settle
    const MOUSE_EASE = 0.15;         // extra lag on the tracked cursor position itself

    let dpr = 1;
    let cells = [];
    let mouseX = -9999, mouseY = -9999;       // eased, what's actually used to compute distortion
    let targetMouseX = -9999, targetMouseY = -9999; // raw, updated straight from the event

    function resize(){
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = window.innerWidth + "px";
        canvas.style.height = window.innerHeight + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = "13px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const cols = Math.ceil(window.innerWidth / SPACING) + 1;
        const rows = Math.ceil(window.innerHeight / SPACING) + 1;

        cells = [];
        for(let r = 0; r <= rows; r++){
            for(let c = 0; c <= cols; c++){
                cells.push({
                    x: c * SPACING,
                    y: r * SPACING,
                    rot: 0, targetRot: 0,
                    scale: 1, targetScale: 1,
                    opacity: REST_OPACITY, targetOpacity: REST_OPACITY,
                });
            }
        }
    }

    window.addEventListener("resize", resize);
    resize();

    window.addEventListener("mousemove", e => {
        targetMouseX = e.clientX;
        targetMouseY = e.clientY;
    });

    function drawFrame(interactive){
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

        for(const cell of cells){
            if(interactive){
                const dx = cell.x - mouseX;
                const dy = cell.y - mouseY;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if(dist < INFLUENCE_RADIUS){
                    const influence = 1 - dist / INFLUENCE_RADIUS; // 0 at edge → 1 at cursor
                    const eased = influence * influence;           // ease-in falloff, softer at the rim
                    cell.targetRot = Math.atan2(dy, dx) * eased * (MAX_ROTATION / Math.PI);
                    cell.targetScale = 1 + eased * 0.5;
                    cell.targetOpacity = REST_OPACITY + eased * (PEAK_OPACITY - REST_OPACITY);
                } else {
                    cell.targetRot = 0;
                    cell.targetScale = 1;
                    cell.targetOpacity = REST_OPACITY;
                }

                cell.rot += (cell.targetRot - cell.rot) * EASE;
                cell.scale += (cell.targetScale - cell.scale) * EASE;
                cell.opacity += (cell.targetOpacity - cell.opacity) * EASE;
            }

            ctx.save();
            ctx.translate(cell.x, cell.y);
            if(cell.rot) ctx.rotate(cell.rot);
            if(cell.scale !== 1) ctx.scale(cell.scale, cell.scale);
            ctx.fillStyle = `rgba(126,231,135,${cell.opacity.toFixed(3)})`;
            ctx.fillText(GLYPH, 0, 0);
            ctx.restore();
        }
    }

    if(prefersReducedMotion || isTouchDevice){
        drawFrame(false); // static, undistorted grid — no cursor tracking, no rAF loop
        return;
    }

    function loop(){
        mouseX += (targetMouseX - mouseX) * MOUSE_EASE;
        mouseY += (targetMouseY - mouseY) * MOUSE_EASE;
        drawFrame(true);
        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
})();

// Running code background — several columns of scrolling fake code, brightening toward green near the cursor. Each column has its own speed/content offset.
(function initCodeBackground(){
    const canvas = document.getElementById("code-bg");
    const ctx = canvas && canvas.getContext("2d");
    if(!ctx) return;

    const LINES = [
        // real-ish code / infra
        "const repos = await fetch(WORKER_BASE);",
        "git commit -m \"ship it\"",
        "npm run build",
        "[ok] cache warm — served from KV",
        "> deploying to the edge...",
        "const user = \"dipdagod\";",
        "for (const repo of repos) render(repo);",
        "STATUS 200 OK",
        "git push origin main",
        "$ curl -s api.github.com/users/dipdagod",
        "chmod +x deploy.sh && ./deploy.sh",
        "console.log(`synced ${repos.length} repos`);",
        "await syncProject(env, \"showcase\", project);",
        "diff --git a/index.html b/index.html",
        "worker: rate limit ok (5000/hr)",
        "export default { async fetch(request, env) {",
        "  return new Response(body, { headers });",
        "background-color: var(--bg);",
        "git rebase -i HEAD~3",
        "npx wrangler deploy",
        "SELECT * FROM repos WHERE fork = false;",
        "await env.STATS_KV.put(key, JSON.stringify(record));",
        "$ dig logger.dhairyaplayz97.workers.dev",
        "  animation: cardIn .5s cubic-bezier(.16,1,.3,1);",
        "trace: mousemove -> requestAnimationFrame(loop)",

        // classic dev humor
        "// TODO: fix this before anyone sees it",
        "it works on my machine ¯\\_(ツ)_/¯",
        "rm -rf node_modules && npm i (again)",
        "// this is temporary (2019)",
        "git blame index.html -> it was me",
        "$ sudo make me a sandwich",
        "99 little bugs in the code, 99 bugs",
        "take one down, patch it around",
        "127 little bugs in the code...",
        "// please don't refactor this. ever.",
        "$ man life",
        "No manual entry for life",
        "commit: \"final final v2 REAL final\"",
        "// I have no idea why this works",
        "console.log('reached this point somehow');",
        "$ git push --force",
        "  ^ narrator: it was not fine",
        "throw new Error(\"should never happen\");",
        "// narrator: it happened",

        // self-aware / meta
        "// dipdagod was here",
        "if (you.reading(this)) hire(me);",
        "console.log('found the easter egg');",
        "// this comment is load-bearing",
        "loading portfolio... please clap",
        "$ whoami",
        "dipdagod",
        "status: probably overengineered",
        "// built at 2am, works surprisingly well",
        "cat thoughts.txt | grep \"good idea\"",
        "0 matches",

        // ascii / flavor
        "(╯°□°）╯︵ ┻━┻",
        "٩(◕‿◕)۶",
        "[■■■■■■■■□□] 80% vibes",
        "> _",
    ];

    const LINE_HEIGHT = 24;
    const COLUMN_WIDTH = 300;             // px — also caps how wide a line can render before truncating
    const COLUMN_PADDING = 24;
    const REST_COLOR = [90, 100, 116];    // dim muted-blue-grey at rest — lower than before since far more of this is now on screen at once
    const GLOW_COLOR = [126, 231, 135];   // same light green as everything else
    const INFLUENCE = 160;                // px — how far the cursor's warmth reaches
    const EASE = 0.08;

    let dpr = 1;
    let columns = [];
    let mouseX = -9999, mouseY = -9999;
    let targetMouseX = -9999, targetMouseY = -9999;
    let lastTime = performance.now();

    function fitText(text, maxWidth){
        if(ctx.measureText(text).width <= maxWidth) return text;
        let t = text;
        while(t.length > 1 && ctx.measureText(t + "…").width > maxWidth){
            t = t.slice(0, -1);
        }
        return t + "…";
    }

    function resize(){
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = window.innerWidth + "px";
        canvas.style.height = window.innerHeight + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = "13px 'JetBrains Mono', monospace";
        ctx.textBaseline = "middle";

        const maxLineWidth = COLUMN_WIDTH - COLUMN_PADDING * 2;
        const colCount = Math.ceil(window.innerWidth / COLUMN_WIDTH);
        const rowCount = Math.ceil(window.innerHeight / LINE_HEIGHT) + 2;

        columns = [];
        for(let c = 0; c < colCount; c++){
            const x = c * COLUMN_WIDTH + COLUMN_PADDING;
            let nextLineIndex = c * 5; // stagger starting content so columns don't mirror each other
            const speed = 6 + Math.random() * 6; // px/sec, upward — varies per column for an organic feel

            const lines = [];
            for(let r = 0; r < rowCount; r++){
                const text = fitText(LINES[nextLineIndex % LINES.length], maxLineWidth);
                nextLineIndex++;
                lines.push({
                    text,
                    width: ctx.measureText(text).width,
                    y: r * LINE_HEIGHT,
                    color: [...REST_COLOR],
                });
            }

            columns.push({ x, speed, nextLineIndex, lines });
        }
    }

    window.addEventListener("resize", resize);
    resize();

    window.addEventListener("mousemove", e => {
        targetMouseX = e.clientX;
        targetMouseY = e.clientY;
    });

    function lineDistance(col, line){
        const clampedX = Math.max(col.x, Math.min(mouseX, col.x + line.width));
        const dx = mouseX - clampedX;
        const dy = mouseY - line.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function lerp(a, b, t){ return a + (b - a) * t; }

    function drawStatic(){
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        ctx.fillStyle = `rgba(${REST_COLOR.join(",")},.4)`;
        for(const col of columns){
            for(const line of col.lines){
                ctx.fillText(line.text, col.x, line.y);
            }
        }
    }

    if(prefersReducedMotion || isTouchDevice){
        drawStatic();
        return;
    }

    const maxLineWidth = COLUMN_WIDTH - COLUMN_PADDING * 2;

    function loop(now){
        const dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;

        mouseX += (targetMouseX - mouseX) * 0.15;
        mouseY += (targetMouseY - mouseY) * 0.15;

        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

        for(const col of columns){
            for(const line of col.lines){
                // Scroll upward continuously; wrap back to the bottom once a
                // line exits the top, picking the next line in this column's
                // sequence so the feed reads as an endless running log.
                line.y -= col.speed * dt;
                if(line.y < -LINE_HEIGHT){
                    line.y += col.lines.length * LINE_HEIGHT;
                    line.text = fitText(LINES[col.nextLineIndex % LINES.length], maxLineWidth);
                    col.nextLineIndex++;
                    line.width = ctx.measureText(line.text).width;
                }

                const dist = lineDistance(col, line);
                const influence = dist < INFLUENCE ? (1 - dist / INFLUENCE) ** 2 : 0;
                const target = [
                    lerp(REST_COLOR[0], GLOW_COLOR[0], influence),
                    lerp(REST_COLOR[1], GLOW_COLOR[1], influence),
                    lerp(REST_COLOR[2], GLOW_COLOR[2], influence),
                ];

                for(let c = 0; c < 3; c++){
                    line.color[c] += (target[c] - line.color[c]) * EASE;
                }

                const opacity = lerp(0.28, 0.9, influence);
                ctx.fillStyle = `rgba(${line.color.map(Math.round).join(",")},${opacity.toFixed(3)})`;
                ctx.fillText(line.text, col.x, line.y);
            }
        }

        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
})();

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

// Live uptime ticker — genuine time-since-page-load, not decorative fluff
function tickUptime(){
    const secs = Math.floor((Date.now() - PAGE_LOAD_TIME) / 1000);
    const m = String(Math.floor(secs / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    uptimeEl.textContent = `uptime ${m}:${s}`;
}

tickUptime();
setInterval(tickUptime, 1000);

// Help panel ("?" toggles, matches the man-page vibe)
function setHelpVisible(visible){
    helpPanel.hidden = !visible;
}

helpToggle.addEventListener("click", () => setHelpVisible(helpPanel.hidden));
addHoverScale([refreshBtn, helpToggle], 1.06);

// Language colors (subset of GitHub's linguist palette)
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

// Single source of truth for per-language counts — stats bar, language bar, and filter chips all read from this instead of each looping repos themselves.
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

// Stats bar — off the full repo set, not the filtered view. Repo/star counts animate up.
function renderStatsBar(repos, breakdown){
    const totalStars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);
    const topLang = breakdown.entries[0]?.[0] ?? "—";

    statsBar.innerHTML = `
        <div class="stat-box">
            <span class="stat-value" id="stat-repos">0</span>
            <span class="stat-label">public repositories</span>
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

// Language distribution bar — fills left to right on render, GitHub-style.
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

// Language filter chips
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

        // Same spring hover as every other button on the page — the earlier
        // version skipped this for chips because a naive mouseleave reset
        // to scale:1 would clobber the active chip's persistent CSS scale.
        // Fixed properly here: the rest target respects .active instead of
        // assuming everything resets to 1.
        if(motionAnimate && !prefersReducedMotion){
            const restScale = () => chip.classList.contains("active") ? 1.06 : 1;
            chip.addEventListener("mouseenter", () => springTo(chip, { scale: restScale() + 0.04 }));
            chip.addEventListener("mouseleave", () => springTo(chip, { scale: restScale() }));
        }
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

// Refresh button state
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

// Every click hits the network for real — the worker enforces the actual rate limit; a 429 just settles the button with no error shown.
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

// Skeleton placeholders (shown while loading with no existing data yet)
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

// Render
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

        // Two-stage image fallback: try the site's own OG image first (if the
        // worker resolved one). If THAT specific image fails to load — site
        // redesigned, image moved, whatever — retry once with GitHub's own
        // repo preview image before giving up and removing the block.
        const fallbackSrc = `https://opengraph.githubassets.com/1/${USERNAME}/${repo.name}`;
        const initialSrc = repo.ogImage || fallbackSrc;

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
                    src="${initialSrc}"
                    data-fallback="${fallbackSrc}"
                    alt=""
                    loading="lazy"
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
                ${repo.stargazers_count > 0 ? `<span>★ ${repo.stargazers_count}</span>` : ""}
                <span>created ${timeAgo(repo.created_at)}</span>
            </div>

        </div>
    `}).join("");

    // Cards get a lift (CSS handles border-color/shadow already; Motion
    // takes over the transform for the springy part). Action buttons inside
    // get a plain scale bounce.
    if(motionAnimate && !prefersReducedMotion){
        grid.querySelectorAll(".card").forEach(card => {
            card.addEventListener("mouseenter", () => springTo(card, { y: -6, scale: 1.015 }));
            card.addEventListener("mouseleave", () => springTo(card, { y: 0, scale: 1 }));
        });

        addHoverScale(grid.querySelectorAll(".visit-site-btn, .github-link, .name"), 1.06);
    }

    // Thumbnail load failures: try the site's own OG image, fall back once
    // to GitHub's, and if that ALSO fails, keep retrying indefinitely with
    // capped exponential backoff (2s, 3s, 5s, 8s... up to once/60s) rather
    // than giving up. The card just shows a subtle pulsing placeholder
    // while it waits — never a broken-image icon, never permanently gone.
    grid.querySelectorAll(".card-thumb").forEach(img => {
        const fallback = img.dataset.fallback;
        let usedFallback = false;
        let attempt = 0;

        function scheduleRetry(){
            attempt++;
            const delay = Math.min(2000 * Math.pow(1.6, attempt), 60000);
            setTimeout(() => {
                const base = img.src.split("?")[0];
                img.src = `${base}?retry=${Date.now()}`;
            }, delay);
        }

        img.addEventListener("error", () => {
            if(!usedFallback && fallback && img.src.split("?")[0] !== fallback){
                usedFallback = true;
                attempt = 0;
                img.src = fallback;
                return;
            }
            img.closest(".card-preview")?.classList.add("thumb-retrying");
            scheduleRetry();
        });

        img.addEventListener("load", () => {
            attempt = 0;
            img.closest(".card-preview")?.classList.remove("thumb-retrying");
        });
    });

}

// Escape HTML
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

// Relative time using exactly one unit (days, months, or years — whichever
// is most sensible), rounded to the nearest whole number rather than
// showing a raw date like "8/9/2026".
function timeAgo(dateStr){
    const diffDays = (Date.now() - new Date(dateStr)) / (1000 * 60 * 60 * 24);

    if(diffDays < 1) return "today";

    if(diffDays < 30){
        const days = Math.round(diffDays);
        return `${days} day${days === 1 ? "" : "s"} ago`;
    }

    const diffMonths = diffDays / 30.44; // average month length
    if(diffMonths < 12){
        const months = Math.round(diffMonths);
        return `${months} month${months === 1 ? "" : "s"} ago`;
    }

    const years = Math.round(diffDays / 365.25);
    return `${years} year${years === 1 ? "" : "s"} ago`;
}

// Filter
const filterInput = document.getElementById("filter");
const filterClear = document.getElementById("filter-clear");

let filterDebounce;

// Sort + filter pipeline
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

// Sort dropdown (custom) — open/close, selection, click-outside, keyboard nav
const sortToggleLabel = sortToggle.querySelector(".sort-toggle-label");
const sortOptions = Array.from(sortMenu.querySelectorAll(".sort-option"));

function setSortOpen(open){
    sortMenu.classList.toggle("open", open);
    sortToggle.classList.toggle("open", open);
    sortToggle.setAttribute("aria-expanded", open ? "true" : "false");

    if(open){
        (sortOptions.find(o => o.classList.contains("active")) || sortOptions[0]).focus();
    }
}

function selectSort(value){
    currentSort = value;

    sortOptions.forEach(opt => {
        const isActive = opt.dataset.value === value;
        opt.classList.toggle("active", isActive);
        opt.setAttribute("aria-selected", isActive ? "true" : "false");
        if(isActive) sortToggleLabel.textContent = opt.textContent.trim();
    });

    applyFilter();
}

sortToggle.addEventListener("click", () => {
    setSortOpen(!sortMenu.classList.contains("open"));
});

sortOptions.forEach(opt => {
    opt.addEventListener("click", () => {
        selectSort(opt.dataset.value);
        setSortOpen(false);
        sortToggle.focus();
    });
});

document.addEventListener("click", e => {
    if(!sortDropdown.contains(e.target)){
        setSortOpen(false);
    }
});

sortMenu.addEventListener("keydown", e => {
    const idx = sortOptions.indexOf(document.activeElement);

    if(e.key === "ArrowDown"){
        e.preventDefault();
        (sortOptions[idx + 1] || sortOptions[0]).focus();
    } else if(e.key === "ArrowUp"){
        e.preventDefault();
        (sortOptions[idx - 1] || sortOptions[sortOptions.length - 1]).focus();
    } else if(e.key === "Enter" || e.key === " "){
        e.preventDefault();
        selectSort(document.activeElement.dataset.value);
        setSortOpen(false);
        sortToggle.focus();
    } else if(e.key === "Escape"){
        setSortOpen(false);
        sortToggle.focus();
    }
});

addHoverScale([sortToggle], 1.03);

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

// Refresh button
refreshBtn.addEventListener("click", () => {
    fetchRepos();
});

// Paints cached data instantly. Fresh (<24h) cache = no network call. No cache, or stale cache, triggers an automatic fetch — nothing is ever left blank.
(function loadFromCache(){
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    if(cache && cache.data && cache.data.length){
        allRepos = cache.data;
        renderLangSections(allRepos);
        applyFilter();

        subtitle.textContent =
            `${allRepos.length} public repositories · cached`;

        status.textContent =
            `last synced ${new Date(cache.time).toLocaleString()}`;

        if(Date.now() - cache.time > ONE_DAY_MS){
            fetchRepos(); // stale — refresh automatically instead of waiting for a manual pull
        }
    } else {
        subtitle.textContent = "no cache — pulling fresh...";
        status.textContent = "first load, fetching repositories";
        fetchRepos(); // no cache at all — pull automatically instead of waiting for a manual click
    }
})();
