const USERNAME = "dipdagod";

// Cloudflare Worker that KV-caches the GitHub API response (refreshes once
// a day upstream, no matter how often "pull" is clicked here).
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

let allRepos = [];

// -------------------------
// Language colors (subset of GitHub's linguist palette)
// -------------------------
const LANG_COLORS = {
    JavaScript:"#f1e05a", TypeScript:"#3178c6", Python:"#3572A5",
    HTML:"#e34c26", CSS:"#563d7c", Shell:"#89e051", Java:"#b07219",
    "C++":"#f34b7d", C:"#555555", "C#":"#178600", Go:"#00ADD8",
    Rust:"#dea584", PHP:"#4F5D95", Ruby:"#701516", Swift:"#F05138",
    Kotlin:"#A97BFF", Dart:"#00B4AB", Vue:"#41b883", Jupyter:"#DA5B0B"
};

function langColor(lang){
    return LANG_COLORS[lang] || "#8b949e";
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

    try{

        const response = await fetch(
            `${WORKER_BASE}?project=showcase&path=repos`,
            { cache: "no-store" }
        );

        if(response.status === 429){
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

        render(allRepos);

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
// Render
// -------------------------
function render(repos){

    if(repos.length === 0){
        grid.innerHTML = `<div class="empty">no matches</div>`;
        return;
    }

    grid.innerHTML = repos.map(repo => `
        <div class="card">

            <div class="name-row">
                <span class="branch-icon">⌥</span>
                <a
                    class="name"
                    href="${repo.html_url}"
                    target="_blank"
                >
                    ${escapeHtml(repo.name)}
                </a>
            </div>

            <div class="desc">
                ${repo.description
                    ? escapeHtml(repo.description)
                    : "No description."}
            </div>

            ${
                repo.homepage
                    ? `
                    <a
                        class="site-link"
                        href="${repo.homepage}"
                        target="_blank"
                    >
                        🔗 visit site
                    </a>
                    `
                    : ""
            }

            <div class="meta">

                ${
                    repo.language
                        ? `
                        <span>
                            <span class="lang-dot" style="background:${langColor(repo.language)}"></span>
                            ${escapeHtml(repo.language)}
                        </span>
                        `
                        : ""
                }

                <span>★ ${repo.stargazers_count}</span>

                <span>
                    ${new Date(repo.pushed_at).toLocaleDateString()}
                </span>

            </div>

        </div>
    `).join("");

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

// -------------------------
// Filter
// -------------------------
document.getElementById("filter").addEventListener("input", e => {

    const q = e.target.value.toLowerCase();

    render(
        allRepos.filter(repo =>
            repo.name.toLowerCase().includes(q)
        )
    );

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
        render(allRepos);

        subtitle.textContent =
            `${allRepos.length} public repositories · cached`;

        status.textContent =
            `last synced ${new Date(cache.time).toLocaleString()}`;
    } else {
        subtitle.textContent = "no cached data yet";
        status.textContent = "hit pull to load repositories";
        grid.innerHTML = `<div class="empty">no data yet — hit pull</div>`;
    }
})();
