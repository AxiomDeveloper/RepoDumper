/* Repo Dumper - static GitHub Pages app
   Uses GitHub REST API:
   - GET /repos/{owner}/{repo}
   - GET /repos/{owner}/{repo}/branches
   - GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1
   - GET /repos/{owner}/{repo}/git/blobs/{sha}  (base64 content)
*/

const $ = (id) => document.getElementById(id);

const state = {
  token: "",
  owner: "",
  repo: "",
  defaultBranch: "",
  branch: "",
  tree: [],           // raw tree entries from API
  files: [],          // filtered blobs only
  treeText: "",
  dumpText: "",
  fileCache: new Map() // path -> content
};

const els = {
  token: $("token"),
  repoUrl: $("repoUrl"),
  branch: $("branch"),
  maxKb: $("maxKb"),
  exclude: $("exclude"),
  btnLoad: $("btnLoad"),
  btnDump: $("btnDump"),
  btnCopyDump: $("btnCopyDump"),
  btnDownloadDump: $("btnDownloadDump"),
  btnCopyTree: $("btnCopyTree"),
  btnCopyFile: $("btnCopyFile"),
  btnTheme: $("btnTheme"),
  btnReset: $("btnReset"),
  statusPill: $("statusPill"),
  statusText: $("statusText"),
  progressBar: $("progressBar"),
  repoMeta: $("repoMeta"),
  tree: $("tree"),
  treeSearch: $("treeSearch"),
  activePath: $("activePath"),
  fileContent: $("fileContent"),
  dumpOut: $("dumpOut"),
};

init();

function init(){
  // theme
  const savedTheme = localStorage.getItem("rd_theme");
  if(savedTheme) document.documentElement.dataset.theme = savedTheme;

  // restore last inputs (optional convenience)
  const lastRepo = localStorage.getItem("rd_repoUrl");
  if(lastRepo) els.repoUrl.value = lastRepo;
  const lastExclude = localStorage.getItem("rd_exclude");
  if(lastExclude) els.exclude.value = lastExclude;
  const lastMaxKb = localStorage.getItem("rd_maxKb");
  if(lastMaxKb) els.maxKb.value = lastMaxKb;

  els.btnTheme.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || "dark";
    const next = cur === "light" ? "dark" : "light";
    if(next === "dark") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = "light";
    localStorage.setItem("rd_theme", next);
  });

  els.btnReset.addEventListener("click", resetAll);

  els.btnLoad.addEventListener("click", onLoadRepo);
  els.btnDump.addEventListener("click", onDumpAll);
  els.btnCopyDump.addEventListener("click", () => copyText(els.dumpOut.value));
  els.btnDownloadDump.addEventListener("click", downloadDump);
  els.btnCopyTree.addEventListener("click", () => copyText(state.treeText));
  els.btnCopyFile.addEventListener("click", () => copyText(els.fileContent.textContent || ""));

  els.treeSearch.addEventListener("input", () => renderTree());

  // PWA service worker
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
}

function resetAll(){
  state.token = "";
  state.owner = "";
  state.repo = "";
  state.defaultBranch = "";
  state.branch = "";
  state.tree = [];
  state.files = [];
  state.treeText = "";
  state.dumpText = "";
  state.fileCache.clear();

  els.branch.innerHTML = `<option value="">Auto (default)</option>`;
  els.repoMeta.innerHTML = "";
  els.tree.innerHTML = "";
  els.activePath.textContent = "No file selected";
  els.fileContent.textContent = "";
  els.dumpOut.value = "";

  els.btnDump.disabled = true;
  els.btnCopyDump.disabled = true;
  els.btnDownloadDump.disabled = true;
  els.btnCopyTree.disabled = true;
  els.btnCopyFile.disabled = true;

  setStatus("Idle", "Paste a token and repo URL, then tap “Load Repo”.", 0);
}

function setStatus(pill, text, pct){
  els.statusPill.textContent = pill;
  els.statusText.textContent = text;
  els.progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function parseRepo(input){
  const s = (input || "").trim();
  if(!s) return null;

  // Accept owner/repo
  const simple = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if(simple) return { owner: simple[1], repo: simple[2] };

  // Accept github.com/owner/repo (with optional .git, /tree/branch, etc.)
  try{
    const u = new URL(s);
    if(!/github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if(parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/i, "") };
  }catch{
    return null;
  }
}

function headers(){
  const token = (els.token.value || "").trim();
  state.token = token;

  const h = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if(token){
    // GitHub accepts "token ..." or "Bearer ..." depending on PAT type; Bearer is generally fine.
    h["Authorization"] = `Bearer ${token}`;
  }
  return h;
}

async function ghJson(url){
  const r = await fetch(url, { headers: headers() });
  if(!r.ok){
    let msg = `${r.status} ${r.statusText}`;
    try{
      const j = await r.json();
      if(j && j.message) msg = j.message;
    }catch{}
    throw new Error(msg);
  }
  return r.json();
}

async function onLoadRepo(){
  try{
    const parsed = parseRepo(els.repoUrl.value);
    if(!parsed) throw new Error("Invalid repo URL. Use https://github.com/owner/repo or owner/repo");

    localStorage.setItem("rd_repoUrl", els.repoUrl.value.trim());
    localStorage.setItem("rd_exclude", els.exclude.value.trim());
    localStorage.setItem("rd_maxKb", String(els.maxKb.value || "512"));

    state.owner = parsed.owner;
    state.repo = parsed.repo;

    setStatus("Loading…", "Fetching repo metadata…", 5);

    // Repo metadata
    const repoInfo = await ghJson(`https://api.github.com/repos/${state.owner}/${state.repo}`);
    state.defaultBranch = repoInfo.default_branch || "main";

    // Branch list
    setStatus("Loading…", "Fetching branches…", 12);
    const branches = await ghJson(`https://api.github.com/repos/${state.owner}/${state.repo}/branches?per_page=100`);

    // Fill select
    els.branch.innerHTML = `<option value="">Auto (default)</option>` +
      branches.map(b => `<option value="${escapeHtml(b.name)}">${escapeHtml(b.name)}</option>`).join("");

    // Choose branch
    const chosen = (els.branch.value || "").trim();
    state.branch = chosen || state.defaultBranch;

    // Show meta
    els.repoMeta.innerHTML = `
      <div><b>${escapeHtml(repoInfo.full_name)}</b> — ${escapeHtml(repoInfo.description || "")}</div>
      <div>Default branch: <b>${escapeHtml(state.defaultBranch)}</b> • Selected: <b>${escapeHtml(state.branch)}</b></div>
      <div>Stars: <b>${repoInfo.stargazers_count}</b> • Forks: <b>${repoInfo.forks_count}</b> • Open issues: <b>${repoInfo.open_issues_count}</b></div>
    `;

    // Get the branch SHA
    setStatus("Loading…", `Resolving branch SHA (${state.branch})…`, 18);
    const br = await ghJson(`https://api.github.com/repos/${state.owner}/${state.repo}/branches/${encodeURIComponent(state.branch)}`);
    const sha = br.commit?.sha;
    if(!sha) throw new Error("Could not resolve branch SHA.");

    // Fetch tree recursive
    setStatus("Loading…", "Fetching repo tree (recursive)…", 30);
    const treeResp = await ghJson(`https://api.github.com/repos/${state.owner}/${state.repo}/git/trees/${sha}?recursive=1`);
    state.tree = treeResp.tree || [];

    // Filter files
    const excludes = getExcludeList();
    const maxKb = getMaxKb();

    const blobs = state.tree.filter(x => x.type === "blob");
    const filtered = blobs.filter(x => !shouldExclude(x.path, excludes));
    state.files = filtered.map(x => ({
      path: x.path,
      sha: x.sha,
      size: x.size || null
    }));

    // Build tree text
    state.treeText = buildTreeText(state.tree, excludes);

    // Render tree UI
    setStatus("Ready", `Loaded ${state.files.length} files (filtered). Tap a file to view.`, 100);
    renderTree();

    els.btnDump.disabled = false;
    els.btnCopyTree.disabled = false;

    // clear file view + dump
    els.activePath.textContent = "No file selected";
    els.fileContent.textContent = "";
    els.dumpOut.value = "";
    state.dumpText = "";
    els.btnCopyDump.disabled = true;
    els.btnDownloadDump.disabled = true;
    els.btnCopyFile.disabled = true;

  }catch(err){
    setStatus("Error", String(err.message || err), 0);
  }
}

function getExcludeList(){
  return (els.exclude.value || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}
function getMaxKb(){
  const n = Number(els.maxKb.value || 512);
  return Number.isFinite(n) && n > 0 ? n : 512;
}
function shouldExclude(path, excludes){
  const p = (path || "").toLowerCase();
  return excludes.some(ex => p.includes(ex.toLowerCase()));
}

function renderTree(){
  const excludes = getExcludeList();
  const q = (els.treeSearch.value || "").trim().toLowerCase();

  // Build a directory map from filtered files
  const files = state.files
    .filter(f => !shouldExclude(f.path, excludes))
    .filter(f => !q || f.path.toLowerCase().includes(q));

  const root = {};
  for(const f of files){
    const parts = f.path.split("/");
    let cur = root;
    parts.forEach((part, idx) => {
      cur.children ||= {};
      cur.children[part] ||= { name: part, children: null, file: null };
      if(idx === parts.length - 1){
        cur.children[part].file = f;
      }
      cur = cur.children[part];
    });
  }

  els.tree.innerHTML = "";
  const frag = document.createDocumentFragment();
  renderNodeChildren(root.children || {}, frag, 0);
  els.tree.appendChild(frag);
}

function renderNodeChildren(children, container, depth){
  const entries = Object.values(children);

  // folders first
  entries.sort((a,b) => {
    const aIsFile = !!a.file;
    const bIsFile = !!b.file;
    if(aIsFile !== bIsFile) return aIsFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  for(const node of entries){
    const row = document.createElement("div");
    row.className = "node";
    row.style.marginLeft = `${depth*6}px`;

    const icon = document.createElement("div");
    icon.className = "icon";
    const isFile = !!node.file;
    icon.textContent = isFile ? "📄" : "📁";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = node.name;

    const badge = document.createElement("div");
    badge.className = "badge";
    if(isFile && node.file.size != null){
      badge.textContent = fmtBytes(node.file.size);
    }else{
      badge.textContent = isFile ? "" : "";
    }

    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(badge);

    if(isFile){
      row.addEventListener("click", () => openFile(node.file));
    }else{
      // expand/collapse
      let open = false;
      const childWrap = document.createElement("div");
      childWrap.className = "indent";
      childWrap.style.display = "none";

      row.addEventListener("click", () => {
        open = !open;
        childWrap.style.display = open ? "block" : "none";
        icon.textContent = open ? "📂" : "📁";
      });

      if(node.children){
        renderNodeChildren(node.children, childWrap, depth+1);
      }
      container.appendChild(row);
      container.appendChild(childWrap);
      continue;
    }

    container.appendChild(row);
  }
}

async function openFile(file){
  try{
    const path = file.path;
    els.activePath.textContent = path;
    els.btnCopyFile.disabled = true;
    setStatus("Loading…", `Fetching ${path}…`, 100);

    if(state.fileCache.has(path)){
      els.fileContent.textContent = state.fileCache.get(path);
      els.btnCopyFile.disabled = false;
      setStatus("Ready", `Viewing ${path}`, 100);
      return;
    }

    // Fetch blob content (base64)
    const j = await ghJson(`https://api.github.com/repos/${state.owner}/${state.repo}/git/blobs/${file.sha}`);

    if(j.encoding !== "base64" || typeof j.content !== "string"){
      els.fileContent.textContent = "[Unsupported file encoding]";
      setStatus("Ready", `Viewing ${path}`, 100);
      return;
    }

    const text = decodeBase64Utf8(j.content);
    // Heuristic binary check
    if(isProbablyBinary(text)){
      els.fileContent.textContent = "[Binary file detected — not displayed as text.]";
      setStatus("Ready", `Binary file: ${path}`, 100);
      return;
    }

    state.fileCache.set(path, text);
    els.fileContent.textContent = text;
    els.btnCopyFile.disabled = false;
    setStatus("Ready", `Viewing ${path}`, 100);

  }catch(err){
    setStatus("Error", String(err.message || err), 0);
  }
}

async function onDumpAll(){
  try{
    if(!state.files.length) throw new Error("No files loaded.");

    const excludes = getExcludeList();
    const maxKb = getMaxKb();
    const maxBytes = maxKb * 1024;

    const header =
`# REPO DUMP (AI-READY)
Repo: ${state.owner}/${state.repo}
Branch: ${state.branch}
Generated: ${new Date().toISOString()}

## TREE
${state.treeText}

## FILES
`;

    els.dumpOut.value = "";
    state.dumpText = "";
    els.btnCopyDump.disabled = true;
    els.btnDownloadDump.disabled = true;

    // Build list of files to dump
    const list = state.files
      .filter(f => !shouldExclude(f.path, excludes))
      .sort((a,b) => a.path.localeCompare(b.path));

    let out = header;
    let dumped = 0;
    let skippedBig = 0;
    let skippedBin = 0;

    for(let i=0;i<list.length;i++){
      const f = list[i];
      const pct = 5 + Math.floor((i / Math.max(1, list.length)) * 90);
      setStatus("Dumping…", `(${i+1}/${list.length}) ${f.path}`, pct);

      if(f.size != null && f.size > maxBytes){
        skippedBig++;
        out += `\n\n---\n### ${f.path}\n[SKIPPED: ${fmtBytes(f.size)} > ${maxKb}KB]\n`;
        continue;
      }

      // from cache or fetch
      let text = state.fileCache.get(f.path);
      if(text == null){
        const j = await ghJson(`https://api.github.com/repos/${state.owner}/${state.repo}/git/blobs/${f.sha}`);
        if(j.encoding === "base64" && typeof j.content === "string"){
          text = decodeBase64Utf8(j.content);
        }else{
          text = "[Unsupported file encoding]";
        }
        state.fileCache.set(f.path, text);
      }

      if(isProbablyBinary(text)){
        skippedBin++;
        out += `\n\n---\n### ${f.path}\n[SKIPPED: binary file]\n`;
        continue;
      }

      dumped++;
      const lang = guessFenceLang(f.path);
      out += `\n\n---\n### ${f.path}\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
    }

    out += `\n\n---\n## SUMMARY
Dumped: ${dumped}
Skipped (too large > ${maxKb}KB): ${skippedBig}
Skipped (binary): ${skippedBin}
Total considered: ${list.length}
`;

    state.dumpText = out;
    els.dumpOut.value = out;

    els.btnCopyDump.disabled = false;
    els.btnDownloadDump.disabled = false;

    setStatus("Ready", `Dump complete. Dumped ${dumped}, skipped ${skippedBig} big, ${skippedBin} binary.`, 100);

  }catch(err){
    setStatus("Error", String(err.message || err), 0);
  }
}

/* Helpers */

function buildTreeText(treeEntries, excludes){
  // From recursive tree entries, produce a simple indented listing.
  const paths = treeEntries
    .filter(x => x.type === "blob" || x.type === "tree")
    .map(x => x.path)
    .filter(p => !shouldExclude(p, excludes))
    .sort((a,b) => a.localeCompare(b));

  // Build nested set
  const root = {};
  for(const p of paths){
    const parts = p.split("/");
    let cur = root;
    for(let i=0;i<parts.length;i++){
      const part = parts[i];
      cur[part] ||= {};
      cur = cur[part];
    }
  }

  const lines = [];
  const walk = (node, depth) => {
    const keys = Object.keys(node).sort((a,b)=>a.localeCompare(b));
    for(const k of keys){
      lines.push(`${"  ".repeat(depth)}- ${k}`);
      walk(node[k], depth+1);
    }
  };
  walk(root, 0);

  return lines.join("\n");
}

function fmtBytes(n){
  if(!Number.isFinite(n)) return "";
  const units = ["B","KB","MB","GB"];
  let x = n, i=0;
  while(x >= 1024 && i < units.length-1){ x/=1024; i++; }
  return `${x.toFixed(i===0?0:1)}${units[i]}`;
}

function decodeBase64Utf8(b64){
  // GitHub inserts newlines in base64 content; remove them.
  const clean = (b64 || "").replace(/\n/g,"");
  const binStr = atob(clean);
  // Convert binary string to UTF-8 safely
  const bytes = new Uint8Array(binStr.length);
  for(let i=0;i<binStr.length;i++) bytes[i] = binStr.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal:false }).decode(bytes);
}

function isProbablyBinary(text){
  if(typeof text !== "string") return true;
  // if it has many NULs or lots of control chars
  let nul = 0, ctrl = 0;
  const len = Math.min(text.length, 5000);
  for(let i=0;i<len;i++){
    const c = text.charCodeAt(i);
    if(c === 0) nul++;
    if(c < 9 || (c > 13 && c < 32)) ctrl++;
  }
  return nul > 0 || (ctrl / Math.max(1,len)) > 0.02;
}

function guessFenceLang(path){
  const ext = (path.split(".").pop() || "").toLowerCase();
  const map = {
    "js":"javascript",
    "mjs":"javascript",
    "cjs":"javascript",
    "ts":"typescript",
    "tsx":"tsx",
    "jsx":"jsx",
    "json":"json",
    "md":"markdown",
    "html":"html",
    "css":"css",
    "scss":"scss",
    "yml":"yaml",
    "yaml":"yaml",
    "py":"python",
    "go":"go",
    "java":"java",
    "kt":"kotlin",
    "c":"c",
    "cpp":"cpp",
    "h":"c",
    "hpp":"cpp",
    "cs":"csharp",
    "rb":"ruby",
    "php":"php",
    "rs":"rust",
    "swift":"swift",
    "sh":"bash",
    "bat":"bat",
    "ps1":"powershell",
    "toml":"toml",
    "ini":"ini",
    "xml":"xml",
    "sql":"sql",
    "txt":"text"
  };
  return map[ext] || "";
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text || "");
    flashStatus("Copied to clipboard ✅");
  }catch{
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text || "";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    flashStatus("Copied to clipboard ✅");
  }
}

function flashStatus(msg){
  const old = els.statusText.textContent;
  els.statusText.textContent = msg;
  setTimeout(()=>{ els.statusText.textContent = old; }, 1200);
}

function downloadDump(){
  const text = els.dumpOut.value || "";
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.owner || "repo"}-${state.repo || "dump"}-${state.branch || "branch"}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}