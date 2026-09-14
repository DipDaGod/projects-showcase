/* ═══════════════════════════════════════════════════════════════════════
   dipdagod / projects
   ─────────────────────────────────────────────────────────────────────
   Data comes from a Cloudflare Worker in front of the GitHub API; the
   rest of this file is the motion layer: scroll reveals, FLIP re-orders,
   pointer-reactive cards, and the two ambient canvases behind it all.
   ═══════════════════════════════════════════════════════════════════════ */

const USERNAME = "dipdagod";

// Fetches GitHub repos through the worker
const WORKER_BASE = "https://logger.dhairyaplayz97.workers.dev";

const EXCLUDE = [
    "projects-showcase",
    "Wisdom-Woods",
];

const SORT_BY_STARS = false;

const CACHE_KEY = "github_repo_cache";

/* ── dom ──────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const grid = $("grid");
const subtitle = $("subtitle");
const statusEl = $("status");
const refreshBtn = $("refresh");
const uptimeEl = $("uptime");
const helpPanel = $("help-panel");
const helpToggle = $("help-toggle");
const statsBar = $("stats-bar");
const langBar = $("lang-bar");
const langChips = $("lang-chips");
const sortDropdown = $("sort-dropdown");
const sortToggle = $("sort-toggle");
const sortMenu = $("sort-menu");
const bgGlow = $("bg-glow");
const topbar = $("topbar");
const scrollBar = $("scroll-bar");
const toTop = $("to-top");
const resultCount = $("result-count");
const heroCount = $("hero-count");
const heroLangs = $("hero-langs");
const heroStars = $("hero-stars");

let allRepos = [];
let activeLanguage = null;
let currentSort = "updated";

const PAGE_LOAD_TIME = Date.now();

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Touch/no-hover devices get no benefit from cursor-tracking effects — skip
// them entirely instead of running rAF loops for nothing.
const isTouchDevice = window.matchMedia("(hover: none), (pointer: coarse)").matches;

// Motion (motion.dev) loads via CDN in index.html. If it fails, motionAnimate
// stays null and every spring call below just no-ops — CSS :hover still works.
const motionAnimate = (typeof Motion !== "undefined" && Motion.animate) || null;

// True when pointer-driven flourishes (tilt, magnetism, glow) are worth running.
const richMotion = !prefersReducedMotion && !isTouchDevice;

/* ── small utilities ──────────────────────────────────────────────── */

// Spring-animates el if Motion loaded; otherwise no-ops (CSS :hover still works).
function springTo(el, props, opts = {}){
    if(!motionAnimate || prefersReducedMotion) return;
    motionAnimate(el, props, { type: "spring", stiffness: 300, damping: 22, ...opts });
}

// Springy scale-up-on-hover for one or more elements. Safe on freshly-created nodes.
function addHoverScale(els, hoverScale = 1.06){
    els.forEach(el => {
        el.addEventListener("mouseenter", () => springTo(el, { scale: hoverScale }));
        el.addEventListener("mouseleave", () => springTo(el, { scale: 1 }));
    });
}

// Delays fn until ms have passed since the last call — avoids firing on every resize event.
function debounce(fn, ms = 150){
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

// Collapses a burst of events (scroll, pointermove) down to one call per frame.
function rafThrottle(fn){
    let queued = false;
    let lastArgs;
    return (...args) => {
        lastArgs = args;
        if(queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            fn(...lastArgs);
        });
    };
}

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const lerp = (a, b, t) => a + (b - a) * t;

/* ═══════════════════════════════════════════════════════════════════
   MOTION LAYER
   ═══════════════════════════════════════════════════════════════════ */

// Splits [data-split] text into per-character spans so each one can ride in
// on its own delay. Spaces keep their own span so the line still wraps.
(function initSplitText(){
    document.querySelectorAll("[data-split]").forEach(el => {
        const text = el.textContent.trim();
        el.setAttribute("aria-label", text);
        el.textContent = "";

        [...text].forEach((ch, i) => {
            const span = document.createElement("span");
            span.className = ch === " " ? "char space" : "char";
            span.style.setProperty("--i", i);
            span.textContent = ch === " " ? " " : ch;
            span.setAttribute("aria-hidden", "true");
            el.appendChild(span);
        });
    });
})();

// Types out the prompt command one character at a time. The caret next to it
// is pure CSS, so it keeps blinking once the line finishes.
(function initTypewriter(){
    document.querySelectorAll("[data-typewriter]").forEach(el => {
        const text = el.dataset.typewriter;

        if(prefersReducedMotion){
            el.textContent = text;
            return;
        }

        let i = 0;
        const step = () => {
            el.textContent = text.slice(0, ++i);
            if(i < text.length) setTimeout(step, 38 + Math.random() * 45);
        };
        setTimeout(step, 420);
    });
})();

// Scroll reveals. Everything marked [data-reveal] fades up once it enters the
// viewport; the per-element --delay in the markup staggers siblings.
const revealObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if(!entry.isIntersecting) return;
            entry.target.classList.add("revealed");
            obs.unobserve(entry.target);
        });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.04 })
    : null;

function observeReveal(el){
    if(revealObserver) revealObserver.observe(el);
    else el.classList.add("revealed");
}

document.querySelectorAll("[data-reveal]").forEach(observeReveal);

// Cards reveal in batches — whatever scrolls into view together gets a short
// cascade rather than every card sharing one delay.
const cardObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries, obs) => {
        entries
            .filter(e => e.isIntersecting)
            .forEach((entry, i) => {
                entry.target.style.setProperty("--card-delay", `${Math.min(i, 9) * 55}ms`);
                entry.target.classList.add("card-in");
                obs.unobserve(entry.target);
            });
    }, { rootMargin: "0px 0px -4% 0px", threshold: 0.02 })
    : null;

function observeCard(card){
    if(cardObserver) cardObserver.observe(card);
    else card.classList.add("card-in");
}

// Scroll-driven chrome: progress bar, condensed top bar, back-to-top button.
(function initScrollUI(){
    const onScroll = rafThrottle(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const y = window.scrollY;
        const pct = max > 0 ? clamp(y / max, 0, 1) : 0;

        if(scrollBar) scrollBar.style.transform = `scaleX(${pct})`;
        topbar.classList.toggle("stuck", y > 14);

        if(toTop){
            const show = y > window.innerHeight * 0.7;
            if(show && toTop.hidden) toTop.hidden = false;
            toTop.classList.toggle("visible", show);
        }
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", debounce(onScroll, 120));
    onScroll();

    toTop?.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
    });
})();

// Magnetic buttons — the element leans a few pixels toward the cursor while
// it's over them, then springs back on exit.
(function initMagnetic(){
    if(!richMotion) return;

    document.querySelectorAll("[data-magnetic]").forEach(el => {
        const strength = 0.28;
        const maxPull = 9;

        const move = rafThrottle(e => {
            const r = el.getBoundingClientRect();
            const dx = clamp((e.clientX - (r.left + r.width / 2)) * strength, -maxPull, maxPull);
            const dy = clamp((e.clientY - (r.top + r.height / 2)) * strength, -maxPull, maxPull);

            if(motionAnimate){
                motionAnimate(el, { x: dx, y: dy }, { type: "spring", stiffness: 340, damping: 24, mass: .4 });
            } else {
                el.style.transform = `translate(${dx}px, ${dy}px)`;
            }
        });

        el.addEventListener("pointermove", move);
        el.addEventListener("pointerleave", () => {
            if(motionAnimate) springTo(el, { x: 0, y: 0 });
            else el.style.transform = "";
        });
    });
})();

// Pointer spotlight for the stat boxes — cheap version of the card treatment.
(function initStatSpotlight(){
    if(!richMotion || !statsBar) return;

    statsBar.addEventListener("pointermove", e => {
        const box = e.target.closest(".stat-box");
        if(!box) return;
        const r = box.getBoundingClientRect();
        box.style.setProperty("--mx", `${e.clientX - r.left}px`);
        box.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
})();

// Card tilt + spotlight. The card leans into the cursor and a soft radial
// highlight tracks it; both unwind on exit.
function attachCardPointer(card){
    if(!richMotion) return;

    const MAX_TILT = 4.5;
    let hovering = false;

    const move = rafThrottle(e => {
        if(!hovering) return;
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;

        card.style.setProperty("--mx", `${e.clientX - r.left}px`);
        card.style.setProperty("--my", `${e.clientY - r.top}px`);

        const rotY = (px - .5) * 2 * MAX_TILT;
        const rotX = (.5 - py) * 2 * MAX_TILT;

        card.style.transform =
            `perspective(900px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) translateY(-6px) scale(1.012)`;
    });

    card.addEventListener("pointerenter", () => {
        hovering = true;
        card.style.transition = "transform .25s var(--ease-out), border-color .28s, box-shadow .28s";
    });

    card.addEventListener("pointermove", move);

    card.addEventListener("pointerleave", () => {
        hovering = false;
        card.style.transform = "";
    });
}

/* ═══════════════════════════════════════════════════════════════════
   AMBIENT BACKGROUND
   ═══════════════════════════════════════════════════════════════════ */

// Cursor-following glow, rAF-throttled.
(function initBackgroundMotion(){
    if(!motionAnimate || !richMotion || !bgGlow) return;

    const glowRadius = 360; // half of #bg-glow's 720px box, for centering

    const update = rafThrottle((x, y) => {
        motionAnimate(bgGlow,
            { x: x - glowRadius, y: y - glowRadius },
            { type: "spring", stiffness: 180, damping: 26, mass: 0.25 }
        );
    });

    window.addEventListener("mousemove", e => update(e.clientX, e.clientY));
})();

// ASCII flow field — glyphs bend toward the cursor and ease back. Canvas-based
// (not per-glyph DOM) for perf across hundreds of cells.
(function initAsciiFlowField(){
    const canvas = $("ascii-flow");
    const ctx = canvas && canvas.getContext("2d");
    if(!ctx) return;

    const GLYPH = "·";
    const SPACING = 36;              // px between glyph centers
    const INFLUENCE_RADIUS = 210;    // px — how far the cursor's pull reaches
    const MAX_ROTATION = Math.PI / 3;
    const REST_OPACITY = 0.13;
    const PEAK_OPACITY = 0.62;
    const EASE = 0.08;               // per-frame smoothing — lower = floatier settle
    const MOUSE_EASE = 0.15;         // extra lag on the tracked cursor position itself

    let dpr = 1;
    let cells = [];
    let mouseX = -9999, mouseY = -9999;             // eased, drives the distortion
    let targetMouseX = -9999, targetMouseY = -9999; // raw, straight from the event

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

    window.addEventListener("resize", debounce(resize));
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
                    const eased = influence * influence;           // softer at the rim
                    cell.targetRot = Math.atan2(dy, dx) * eased * (MAX_ROTATION / Math.PI);
                    cell.targetScale = 1 + eased * 0.6;
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

    if(!richMotion){
        drawFrame(false); // static, undistorted grid — no cursor tracking, no rAF loop
        return;
    }

    let rafId;

    function loop(){
        mouseX += (targetMouseX - mouseX) * MOUSE_EASE;
        mouseY += (targetMouseY - mouseY) * MOUSE_EASE;
        drawFrame(true);
        rafId = requestAnimationFrame(loop);
    }

    document.addEventListener("visibilitychange", () => {
        if(document.hidden) cancelAnimationFrame(rafId);
        else rafId = requestAnimationFrame(loop);
    });

    rafId = requestAnimationFrame(loop);
})();

// Running code background — several columns of scrolling fake code, brightening
// toward green near the cursor. Each column has its own speed/content offset.
(function initCodeBackground(){
    const canvas = $("code-bg");
    const ctx = canvas && canvas.getContext("2d");
    if(!ctx) return;

    const LINES = [
        // 3am engineering decisions
        "why is this working",
        "okay wait. don't touch it.",
        "worked 10 minutes ago",
        "if this breaks, I was never here",
        "let me just change one thing",
        "one thing later: 47 files changed",
        "npm install and pray",
        "git status (emotional damage)",
        "git diff (oh no)",
        "git commit -m \"please work\"",
        "git commit -m \"actual final\"",
        "git commit -m \"okay NOW final\"",
        "git push",
        "git push --force",
        "terrible idea",
        "we ball",
        "it works. ship it.",
        "do NOT ask me why this works",
        "won't explain this one",
        "temporary fix, added 8 months ago",
        "TODO: fix this properly",
        "TODO: ignore previous TODO",
        "future me can deal with this",
        "future me is going to hate me",
        "why did I name it that",
        "made sense at 3:17am",
        "console.log('WHY')",
        "console.log('WHAT')",
        "console.log('OH COME ON')",

        // actual dev life
        "const data = await fetch(url);",
        "for (const item of items) render(item);",
        "STATUS 200 OK",
        "[ok] somehow still alive",
        "[ok] cache warm",
        "[ok] no idea what happened",
        "> deploying...",
        "> deployment successful",
        "> pretending that was intentional",
        "npm run build",
        "build completed, no screaming",
        "rate limit: okay",
        "edge: doing its thing",
        "git rebase -i HEAD~3",
        "SELECT * FROM users WHERE active = true;",
        "await kv.put(key, JSON.stringify(data));",
        "npx deploy",
        "chmod +x deploy.sh && ./deploy.sh",
        "$ curl -s api.example.com/status",
        "$ dig example.com",
        "const user = getCurrentUser();",
        "await syncData();",
        "diff --git a/main.js b/main.js",
        "export default { fetch(req) {",
        "return new Response(body);",

        // thoughts nobody asked for
        "should probably be studying",
        "this could've been an assignment",
        "10 min of code, 3 hrs of UI",
        "not useful. very cool.",
        "could've used a library",
        "chose suffering instead",
        "why simple when I can overdo it",
        "overengineering: concerning",
        "feature request: sleep",
        "bug report: skill issue",
        "perf fix: close Chrome",
        "debug technique: stare at it",
        "debug technique: stare harder",
        "debug technique: ask AI",
        "AI said it was fine",
        "it was not fine",
        "made a mistake",
        "made several mistakes",
        "at least it looks good",
        "the CSS is holding this together",
        "Aquaterra is the best",

        // easter eggs
        "hey, you found this",
        "$ whoami",
        "someone cool, probably",
        "if (you.reading(this)) hire(me);",
        "if (you.reading(this)) hi.",
        "you weren't supposed to see this",
        "load-bearing comment",
        "don't tell anyone about this",
        "yes, this is intentional",
        "no, I won't explain this",
        "definitely not duct tape",
        "status: overengineered",
        "status: surprisingly functional",
        "status: held together by vibes",
        "loading portfolio...",
        "loading unnecessary features...",
        "loading another animation...",
        "0 matches",
        "grep \"good idea\" thoughts.txt",
        "no manual entry for good decisions",
        "$ man life",
        "no manual entry for life",

        // rage logs
        "WHY IS THE DIV 3PX OFF",
        "WHO MOVED THE PADDING",
        "WHY DOES FLEXBOX DO THIS",
        "STARING AT THIS FOR AN HOUR",
        "missing semicolon",
        "one character",
        "I hate computers",
        "okay I love computers again",
        "who wrote this",
        "oh. me.",
        "DELETE EVERYTHING",
        "wait don't delete everything",
        "ctrl+z ctrl+z ctrl+z",
        "WHY DID THAT MAKE IT WORSE",
        "fine. rebuilding it.",
        "3:42 AM was not the time",

        // questionable philosophy
        "code first, understand later",
        "if it compiles, ship it",
        "if not, blame the semicolon",
        "comments are future-me's problem",
        "future-me has been notified",
        "there is no final version",
        "final_REAL.html",
        "final_REAL_v2.html",
        "final_REAL_v2_ACTUAL.html",
        "supposed to be quick",
        "nothing is ever quick",
        "one last feature",
        "one last feature",
        "one last feature",
        "okay seriously this time",

        // tiny bits of chaos
        "> _",
        ">> still here?",
        ">> been scrolling a while",
        ">> respect",
        "[■■■■■■■■■■] 100% questionable",
        "[■■■■■■■■□□] 80% vibes",
        "[■■■■■■□□□□] 60% sleep",
        "[■□□□□□□□□□] 10% common sense",
        "(╯°□°）╯︵ ┻━┻",
        "┬─┬ノ( º _ ºノ)",
        "٩(◕‿◕)۶",
        "¯\\_(ツ)_/¯",
        "should never happen",
        "narrator: it happened",
        "narrator: worse than expected",
        "narrator: shipped it anyway",
    ];

    const LINE_HEIGHT = 24;
    const COLUMN_WIDTH = 300;             // px — also caps line width before truncating
    const COLUMN_PADDING = 24;
    const REST_COLOR = [70, 80, 96];       // dim blue-grey at rest
    const GLOW_COLOR = [126, 231, 135];   // same light green as everything else
    const INFLUENCE = 180;                // px — how far the cursor's warmth reaches
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
            let nextLineIndex = c * 5; // stagger content so columns don't mirror each other
            const speed = 6 + Math.random() * 6; // px/sec upward — varies for an organic feel

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

    window.addEventListener("resize", debounce(resize));
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

    function drawStatic(){
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        ctx.fillStyle = `rgba(${REST_COLOR.join(",")},.22)`;
        for(const col of columns){
            for(const line of col.lines){
                ctx.fillText(line.text, col.x, line.y);
            }
        }
    }

    if(!richMotion){
        drawStatic();
        return;
    }

    const maxLineWidth = COLUMN_WIDTH - COLUMN_PADDING * 2;
    let rafId;

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

                const opacity = lerp(0.16, 0.82, influence);
                ctx.fillStyle = `rgba(${line.color.map(Math.round).join(",")},${opacity.toFixed(3)})`;
                ctx.fillText(line.text, col.x, line.y);
            }
        }

        rafId = requestAnimationFrame(loop);
    }

    function startLoop(){
        lastTime = performance.now(); // avoid a huge dt spike from time spent paused
        rafId = requestAnimationFrame(loop);
    }

    document.addEventListener("visibilitychange", () => {
        if(document.hidden) cancelAnimationFrame(rafId);
        else startLoop();
    });

    startLoop();
})();

/* ═══════════════════════════════════════════════════════════════════
   NUMBERS, CLOCKS, PANELS
   ═══════════════════════════════════════════════════════════════════ */

// Counts a number up from 0 to target — used for the stats bar and hero line.
function animateNumber(target, render, duration = 900){
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
addHoverScale([helpToggle], 1.06);

// Subtitle updates get a brief green flash so a fresh pull is visible even
// when the repo list itself hasn't changed.
function setSubtitle(text){
    subtitle.textContent = text;
    if(prefersReducedMotion) return;
    subtitle.classList.remove("flash");
    void subtitle.offsetWidth; // restart the animation
    subtitle.classList.add("flash");
}

/* ═══════════════════════════════════════════════════════════════════
   LANGUAGES + STATS
   ═══════════════════════════════════════════════════════════════════ */

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

// Case-insensitive lookup; pass fallback=null to check if a language/topic is recognized.
function langColor(lang, fallback = "#8b949e"){
    return LANG_COLORS_LC[String(lang).toLowerCase()] ?? fallback;
}

// Single source of truth for per-language counts — stats bar, language bar,
// hero line and filter chips all read from this.
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

// The three numbers in the hero, counted up rather than dropped in.
function renderHeroStats(repos, breakdown){
    const totalStars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);

    if(heroCount) animateNumber(repos.length, n => heroCount.textContent = n);
    if(heroLangs) animateNumber(breakdown.entries.length, n => heroLangs.textContent = n);
    if(heroStars) animateNumber(totalStars, n => heroStars.textContent = n);
}

// Stats bar — off the full repo set, not the filtered view.
function renderStatsBar(repos, breakdown){
    const totalStars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);
    const topLang = breakdown.entries[0]?.[0] ?? "—";

    statsBar.innerHTML = `
        <div class="stat-box">
            <span class="stat-value" id="stat-repos">0</span>
            <span class="stat-label">public repositories</span>
        </div>
        ${
            totalStars > 0
                ? `
                <div class="stat-box">
                    <span class="stat-value accent" id="stat-stars">★ 0</span>
                    <span class="stat-label">total stars</span>
                </div>
                `
                : ""
        }
        <div class="stat-box">
            <span class="stat-value">${breakdown.entries.length}</span>
            <span class="stat-label">languages</span>
        </div>
        <div class="stat-box">
            <span class="stat-value" style="color:${langColor(topLang)}">${escapeHtml(topLang)}</span>
            <span class="stat-label">top language</span>
        </div>
    `;

    const reposEl = $("stat-repos");
    const starsEl = $("stat-stars");

    animateNumber(repos.length, n => reposEl.textContent = n);
    if(starsEl) animateNumber(totalStars, n => starsEl.textContent = `★ ${n}`);
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
        langBar.querySelectorAll(".lang-bar-seg").forEach((seg, i) => {
            seg.style.transitionDelay = `${Math.min(i, 8) * 60}ms`;
            seg.style.width = `${seg.dataset.pct}%`;
        });
    });
}

// Language filter chips
function renderLangChips(repos, breakdown){
    if(activeLanguage && !breakdown.counts[activeLanguage]){
        activeLanguage = null; // language no longer present (e.g. after a fresh pull)
    }

    const allChip = `
        <button class="chip ${activeLanguage === null ? "active" : ""}" data-lang="">
            all <span style="opacity:.6">${repos.length}</span>
        </button>
    `;

    const langChipsHtml = breakdown.entries.map(([lang, count]) => `
        <button class="chip ${activeLanguage === lang ? "active" : ""}" data-lang="${escapeHtml(lang)}">
            <span class="lang-dot" style="background:${langColor(lang)};color:${langColor(lang)}"></span>
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

        // Chips keep a persistent scale when active, so the rest target has to
        // respect .active instead of assuming everything springs back to 1.
        if(motionAnimate && !prefersReducedMotion){
            const restScale = () => chip.classList.contains("active") ? 1.05 : 1;
            springTo(chip, { scale: restScale() });
            chip.addEventListener("mouseenter", () => springTo(chip, { scale: restScale() + 0.05 }));
            chip.addEventListener("mouseleave", () => springTo(chip, { scale: restScale() }));
        }
    });
}

// Recomputes everything language-related — one call instead of four.
function renderLangSections(repos){
    const breakdown = getLangBreakdown(repos);
    renderHeroStats(repos, breakdown);
    renderStatsBar(repos, breakdown);
    renderLangBar(breakdown);
    renderLangChips(repos, breakdown);
}

/* ═══════════════════════════════════════════════════════════════════
   FETCH
   ═══════════════════════════════════════════════════════════════════ */

// Refresh button state
function setButtonState(state){
    refreshBtn.classList.remove("loading", "success", "error", "limited");

    if(state === "loading"){
        refreshBtn.disabled = true;
        refreshBtn.classList.add("loading");
        refreshBtn.querySelector(".label").textContent = "pulling...";
        return;
    }

    refreshBtn.disabled = false;
    refreshBtn.querySelector(".label").textContent = "pull";

    if(state === "limited"){
        refreshBtn.classList.add("limited");
        refreshBtn.querySelector(".label").textContent = "limited";
        setTimeout(() => {
            refreshBtn.classList.remove("limited");
            refreshBtn.querySelector(".label").textContent = "pull";
        }, 2000);
        return;
    }

    if(state === "success" || state === "error"){
        refreshBtn.classList.add(state);
        setTimeout(() => refreshBtn.classList.remove(state), 1000);
    }
}

// Small toast for transient messages the button state alone doesn't explain
// (e.g. "the worker throttled this pull"). Reuses one element instead of
// stacking multiples — a second call just restarts the timer.
let toastTimer;
function showToast(message, tone = "warn", duration = 3000){
    const toast = $("toast");
    if(!toast) return;

    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = `toast toast-${tone}`;
    toast.hidden = false;

    requestAnimationFrame(() => toast.classList.add("visible"));

    toastTimer = setTimeout(() => {
        toast.classList.remove("visible");
        setTimeout(() => { toast.hidden = true; }, 280); // let the fade-out finish
    }, duration);
}

// Every click hits the network for real — the worker enforces the actual rate
// limit. If we already have cached cards on screen, a pull never dims or blanks
// the grid; it's a quiet background fetch that swaps in whatever changed. The
// only exception is a genuine first load with no cache, which shows skeletons.
async function fetchRepos(){

    const hasCache = allRepos.length > 0;

    setButtonState("loading");

    if(!hasCache){
        renderSkeleton();
    }

    try{

        const cacheRaw = localStorage.getItem(CACHE_KEY);
        const cacheObj = (() => { try { return JSON.parse(cacheRaw); } catch { return null; } })();
        const knownEtag = cacheObj?.etag;

        const response = await fetch(
            `${WORKER_BASE}?project=showcase`,
            {
                cache: "no-store",
                headers: knownEtag ? { "If-None-Match": knownEtag } : {}
            }
        );

        if(response.status === 429){
            setButtonState("limited");
            showToast("rate limited — try again in a bit");
            return;
        }

        if(response.status === 304){
            // Server confirmed nothing changed since our last pull — same data
            // we already have on screen, so there's nothing to re-render.
            if(cacheObj){
                cacheObj.time = Date.now();
                localStorage.setItem(CACHE_KEY, JSON.stringify(cacheObj));
            }
            statusEl.textContent = `last synced ${new Date().toLocaleString()} · unchanged`;
            setSubtitle(`${allRepos.length} public repositories · up to date`);
            setButtonState("success");
            return;
        }

        if(!response.ok){
            throw new Error(`Worker returned ${response.status} — check ALLOWED_ORIGIN / PROJECTS in logger-worker.js`);
        }

        let repos = await response.json();
        const etag = response.headers.get("etag");

        repos = repos.filter(repo =>
            !repo.fork &&
            !EXCLUDE.includes(repo.name)
        );

        if(SORT_BY_STARS){
            repos.sort((a,b)=>b.stargazers_count-a.stargazers_count);
        }

        allRepos = repos;

        renderLangSections(allRepos);
        applyFilter();

        localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
                time: Date.now(),
                etag,
                data: repos
            })
        );

        setSubtitle(`${repos.length} public repositories · live`);

        statusEl.textContent = `last synced ${new Date().toLocaleString()}`;

        setButtonState("success");

    }
    catch(err){

        console.error(err);

        // Only wipe the grid on a hard failure with nothing cached to fall back
        // on — if cached cards are already showing, leave them up and report
        // the failure quietly instead of yanking working content.
        if(!hasCache){
            grid.innerHTML = `
                <div class="card notice">
                    <strong>✗ Failed to load repositories</strong>
                    <span>${escapeHtml(err.message)}</span>
                </div>
            `;
            setSubtitle("fatal: repo fetch failed");
        } else {
            showToast("pull failed — showing cached data", "error");
        }

        statusEl.textContent = err.message;
        setButtonState("error");
        return;
    }
}

// Skeleton placeholders (shown while loading with no existing data yet)
function renderSkeleton(count = 6){
    grid.innerHTML = Array.from({ length: count }).map((_, i) => `
        <div class="skeleton" style="--card-delay:${i * 70}ms">
            <div class="skel-line" style="width:52%;height:14px;"></div>
            <div class="skel-thumb"></div>
            <div class="skel-line" style="width:92%;"></div>
            <div class="skel-line" style="width:68%;"></div>
            <div class="skel-line" style="width:38%;margin-top:auto;"></div>
        </div>
    `).join("");
}

/* ═══════════════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════════════ */

function cardMarkup(repo, query){
    const topics = repo.topics || [];
    const featured = topics.includes("featured");
    const tags = topics.filter(t => t !== "featured");
    if(tags.length === 0 && repo.language) tags.push(repo.language);

    // Two-stage image fallback: try the site's own OG image first (if the
    // worker resolved one). If THAT specific image fails to load — site
    // redesigned, image moved, whatever — retry once with GitHub's own repo
    // preview image before falling back to endless retries.
    const fallbackSrc = `https://opengraph.githubassets.com/1/${USERNAME}/${repo.name}`;
    const initialSrc = repo.ogImage || fallbackSrc;

    return `
    <article class="card ${featured ? "card-featured" : ""}" data-key="${escapeHtml(repo.name)}">

        <div class="card-header">
            <div class="name-row">
                <span class="branch-icon">⌥</span>
                <a class="name" href="${repo.html_url}" target="_blank" rel="noopener">
                    ${highlightMatch(repo.name, query)}
                </a>
            </div>
            ${featured ? `<span class="featured-badge">★ Featured</span>` : ""}
        </div>

        <div class="card-divider"></div>

        <div class="card-preview">
            <img class="card-thumb" src="${initialSrc}" data-fallback="${fallbackSrc}" alt="" loading="lazy">
        </div>

        <div class="desc">
            ${repo.description ? escapeHtml(repo.description) : "No description."}
        </div>

        ${
            tags.length
                ? `
                <div class="tech-tags">
                    ${tags.map(tag => {
                        const dotColor = langColor(tag, null);
                        return `
                        <span class="tech-tag">
                            ${dotColor ? `<span class="lang-dot" style="background:${dotColor};color:${dotColor}"></span>` : ""}
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
                    <a class="visit-site-btn" href="${repo.homepage}" target="_blank" rel="noopener">
                        <span class="arrow">↗</span> Visit Site
                    </a>
                    `
                    : ""
            }
            <a class="github-link" href="${repo.html_url}" target="_blank" rel="noopener">Github</a>
        </div>

        <div class="meta">
            ${repo.stargazers_count > 0 ? `<span class="star">★ ${repo.stargazers_count}</span>` : ""}
            <span>updated ${timeAgo(repo.pushed_at)}</span>
            <span class="meta-created">created on: ${new Date(repo.created_at).toLocaleDateString()}</span>
        </div>

    </article>
`;
}

// Keeps thumbnails alive: try the site's own OG image, fall back once to
// GitHub's, and if that ALSO fails keep retrying with capped exponential
// backoff (up to once/60s) rather than giving up. The card shows a subtle
// pulsing placeholder while it waits — never a broken-image icon.
function wireThumbnail(img){
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
}

function render(repos, query = ""){

    // Where each surviving card sits *before* the re-render, so a sort or
    // filter change can slide cards to their new slots (FLIP) instead of
    // snapping the whole grid.
    const oldRects = new Map();
    if(richMotion){
        grid.querySelectorAll(".card[data-key]").forEach(card => {
            oldRects.set(card.dataset.key, card.getBoundingClientRect());
        });
    }

    if(repos.length === 0){
        grid.innerHTML = query
            ? `<div class="empty"><span class="empty-glyph">∅</span>no matches for “${escapeHtml(query)}”</div>`
            : `<div class="empty"><span class="empty-glyph">∅</span>no repositories to show</div>`;
        updateResultCount(0, query);
        return;
    }

    grid.innerHTML = repos.map(repo => cardMarkup(repo, query)).join("");
    updateResultCount(repos.length, query);

    const cards = [...grid.querySelectorAll(".card[data-key]")];

    // One measurement pass before any class changes, so reading layout here
    // doesn't interleave with the writes below.
    const newRects = richMotion
        ? cards.map(card => card.getBoundingClientRect())
        : [];

    cards.forEach((card, i) => {
        attachCardPointer(card);

        const prev = oldRects.get(card.dataset.key);

        if(prev && richMotion){
            // Card survived the re-render: show it immediately (no entrance
            // transition) and slide it from where it used to be.
            card.style.transition = "none";
            card.classList.add("card-in");

            const next = newRects[i];
            const dx = prev.left - next.left;
            const dy = prev.top - next.top;

            if(Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5){
                card.animate(
                    [
                        { transform: `translate(${dx}px, ${dy}px)` },
                        { transform: "translate(0, 0)" }
                    ],
                    { duration: 480, easing: "cubic-bezier(.16,1,.3,1)" }
                );
            }

            requestAnimationFrame(() => { card.style.transition = ""; });
        } else {
            // New to the grid — fade up once it scrolls into view.
            observeCard(card);
        }
    });

    if(motionAnimate && !prefersReducedMotion){
        addHoverScale(grid.querySelectorAll(".visit-site-btn, .github-link"), 1.05);
    }

    grid.querySelectorAll(".card-thumb").forEach(wireThumbnail);
}

function updateResultCount(shown, query){
    if(!resultCount) return;

    const total = allRepos.length;
    const filtered = shown !== total || query || activeLanguage;

    resultCount.textContent = total === 0
        ? ""
        : filtered
            ? `showing ${shown} of ${total}`
            : `${total} repositories`;
}

/* ═══════════════════════════════════════════════════════════════════
   TEXT HELPERS
   ═══════════════════════════════════════════════════════════════════ */

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

// Relative time in one unit (days/months/years), rounded — not a raw date.
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

/* ═══════════════════════════════════════════════════════════════════
   FILTER + SORT
   ═══════════════════════════════════════════════════════════════════ */

const filterInput = $("filter");
const filterClear = $("filter-clear");

let filterDebounce;

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
        repos = repos.filter(r =>
            r.name.toLowerCase().includes(q) ||
            (r.description && r.description.toLowerCase().includes(q)) ||
            (r.topics || []).some(t => t.toLowerCase().includes(q))
        );
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
                <span class="empty-glyph">⛔</span>
                Permission denied
                <span style="font-size:.72rem;opacity:.55;">
                    (dipdagod is not in the sudoers file. this incident will be reported.)
                </span>
            </div>
        `;
        updateResultCount(0, raw);
        return;
    }

    render(getVisibleRepos(), raw);
}

// Sort dropdown (custom — a native <select> can't be styled while open)
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

    if((e.key === "r" || e.key === "R") && !isTyping && !e.metaKey && !e.ctrlKey){
        if(!refreshBtn.disabled) fetchRepos();
    }

    if((e.key === "g" || e.key === "G") && !isTyping){
        document.getElementById("projects")
            ?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
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

/* ═══════════════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════════════ */

// Paints cached data instantly. Fresh (<24h) cache = no network call. No cache,
// or a stale one, triggers an automatic fetch — nothing is ever left blank.
(function loadFromCache(){
    const cache = (() => {
        try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); }
        catch { return null; }
    })();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    if(cache && cache.data && cache.data.length){
        allRepos = cache.data;
        renderLangSections(allRepos);
        applyFilter();

        subtitle.textContent = `${allRepos.length} public repositories · cached`;
        statusEl.textContent = `last synced ${new Date(cache.time).toLocaleString()}`;

        if(Date.now() - cache.time > ONE_DAY_MS){
            fetchRepos(); // stale — refresh instead of waiting for a manual pull
        }
    } else {
        subtitle.textContent = "no cache — pulling fresh...";
        statusEl.textContent = "first load, fetching repositories";
        fetchRepos(); // nothing cached — pull automatically
    }
})();
