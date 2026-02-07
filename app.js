/* Repo Dumper Pro - Production Logic
   Handles: PWA, GitHub API, Recursive Tree, & AI-Ready Dumps
*/

const $ = (id) => document.getElementById(id);

const state = {
  token: "", owner: "", repo: "", branch: "",
  tree: [], files: [], 
  fileCache: new Map(),
  treeText: "",
  view: "config"
};

const els = {
  token: $("token"), repoUrl: $("repoUrl"), branch: $("branch"), maxKb: $("maxKb"),
  exclude: $("exclude"), btnLoad: $("btnLoad"), btnDump: $("btnDump"),
  statusPill: $("statusPill"), statusText: $("statusText"), progressBar: $("progressBar"),
  tree: $("tree"), treeSearch: $("treeSearch"), dumpOut: $("dumpOut"),
  filePreview: $("filePreview"), activePath: $("activePath"), fileContent: $("fileContent"),
  btnCopyDump: $("btnCopyDump"), btnDownloadDump: $("btnDownloadDump")
};

// --- Initialization ---

function init() {
  // Restore Settings
  els.token.value = localStorage.getItem("rd_token") || "";
  els.repoUrl.value = localStorage.getItem("rd_repoUrl") || "";
  els.exclude.value = localStorage.getItem("rd_exclude") || "node_modules, .git, dist, build, .next";

  // Tab Navigation
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.target));
  });

  // Event Listeners
  els.btnLoad.addEventListener("click", onLoadRepo);
  els.btnDump.addEventListener("click", onDumpAll);
  els.treeSearch.addEventListener("input", renderTree);
  $("btnClosePreview").addEventListener("click", () => els.filePreview.classList.remove("active"));
  $("btnCopyFile").addEventListener("click", () => copyText(els.fileContent.textContent));
  els.btnCopyDump.addEventListener("click", () => copyText(els.dumpOut.value));
  els.btnDownloadDump.addEventListener("click", downloadDump);

  // Theme
  if(localStorage.getItem("rd_theme") === "light") document.documentElement.dataset.theme = "light";
  $("btnTheme").addEventListener("click", toggleTheme);

  // PWA Registration
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

// --- View Controller ---

function switchView(viewName) {
  state.view = viewName;
  document.body.dataset.view = viewName;
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.target === viewName);
  });
}

function updateStatus(pill, text, pct) {
  els.statusPill.textContent = pill;
  els.statusText.textContent = text;
  els.progressBar.style.width = `${pct}%`;
}

// --- GitHub API Core ---

async function fetchGH(path) {
  const headers = { "Accept": "application/vnd.github+json" };
  const token = els.token.value.trim();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
    localStorage.setItem("rd_token", token);
  }
  
  const r = await fetch(`https://api.github.com/${path}`, { headers });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ message: r.statusText }));
    throw new Error(err.message);
  }
  return r.json();
}

async function onLoadRepo() {
  try {
    const input = els.repoUrl.value.trim();
    const match = input.match(/github\.com\/([^/]+)\/([^/]+)/) || input.match(/^([^/]+)\/([^/]+)$/);
    if (!match) throw new Error("Invalid Repo URL. Use 'owner/repo'");

    state.owner = match[1];
    state.repo = match[2].replace(".git", "");
    localStorage.setItem("rd_repoUrl", input);
    localStorage.setItem("rd_exclude", els.exclude.value);

    updateStatus("Connecting", `Fetching ${state.repo} metadata...`, 20);
    const repoData = await fetchGH(`repos/${state.owner}/${state.repo}`);
    state.branch = els.branch.value || repoData.default_branch;

    updateStatus("Indexing", "Fetching recursive tree...", 50);
    const branchInfo = await fetchGH(`repos/${state.owner}/${state.repo}/branches/${encodeURIComponent(state.branch)}`);
    const treeData = await fetchGH(`repos/${state.owner}/${state.repo}/git/trees/${branchInfo.commit.sha}?recursive=1`);

    state.tree = treeData.tree;
    processTree();
    renderTree();

    $("displayRepoName").textContent = state.repo;
    $("displayBranchName").textContent = state.branch;
    els.btnDump.disabled = false;
    
    updateStatus("Ready", `${state.files.length} files indexed.`, 100);
    switchView("explorer");
  } catch (err) {
    updateStatus("Error", err.message, 0);
  }
}

// --- Data Processing ---

function processTree() {
  const excludes = els.exclude.value.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  
  // Filter for blobs (files) only
  state.files = state.tree.filter(n => {
    if (n.type !== "blob") return false;
    const path = n.path.toLowerCase();
    return !excludes.some(ex => path.includes(ex));
  });

  // Build the indented tree text for the AI dump
  const lines = [];
  state.tree.forEach(n => {
    const parts = n.path.split("/");
    const name = parts[parts.length - 1];
    const isExcluded = excludes.some(ex => n.path.toLowerCase().includes(ex));
    if (!isExcluded) {
      lines.push(`${"  ".repeat(parts.length - 1)}- ${name}${n.type === 'tree' ? '/' : ''}`);
    }
  });
  state.treeText = lines.join("\n");
}

function renderTree() {
  const q = els.treeSearch.value.toLowerCase();
  els.tree.innerHTML = "";
  
  state.files.forEach(file => {
    if (q && !file.path.toLowerCase().includes(q)) return;
    
    const div = document.createElement("div");
    div.className = "node";
    const ext = file.path.split('.').pop();
    div.innerHTML = `<span>${getIcon(ext)}</span><span class="name">${file.path}</span>`;
    div.onclick = () => openFile(file);
    els.tree.appendChild(div);
  });
}

async function openFile(file) {
  els.filePreview.classList.add("active");
  els.activePath.textContent = "Loading...";
  els.fileContent.textContent = "";

  try {
    if (state.fileCache.has(file.sha)) {
      displayFile(file.path, state.fileCache.get(file.sha));
      return;
    }

    const data = await fetchGH(`repos/${state.owner}/${state.repo}/git/blobs/${file.sha}`);
    const content = decodeBase64(data.content);
    
    if (isBinary(content)) {
      displayFile(file.path, "[Binary file - Preview unavailable]");
    } else {
      state.fileCache.set(file.sha, content);
      displayFile(file.path, content);
    }
  } catch (e) {
    displayFile(file.path, "Error: " + e.message);
  }
}

function displayFile(path, content) {
  els.activePath.textContent = path;
  els.fileContent.textContent = content;
  $("btnCopyFile").disabled = false;
}

// --- The Dump All Logic ---

async function onDumpAll() {
  switchView("output");
  els.btnDump.disabled = true;
  els.dumpOut.value = "Generating large dump... please wait.";
  
  let out = `# REPO DUMP (AI-READY)\n# Repo: ${state.owner}/${state.repo}\n# Branch: ${state.branch}\n\n## TREE\n${state.treeText}\n\n## FILES\n`;
  const limit = parseInt(els.maxKb.value) * 1024;
  let count = 0;

  for (let i = 0; i < state.files.length; i++) {
    const f = state.files[i];
    updateStatus("Dumping", `Processing ${i+1}/${state.files.length}`, Math.floor((i/state.files.length)*100));

    if (f.size > limit) {
      out += `\n---\n### ${f.path}\n[SKIPPED: File exceeds ${els.maxKb.value}KB]\n`;
      continue;
    }

    try {
      let content = state.fileCache.get(f.sha);
      if (!content) {
        const data = await fetchGH(`repos/${state.owner}/${state.repo}/git/blobs/${f.sha}`);
        content = decodeBase64(data.content);
        if (!isBinary(content)) state.fileCache.set(f.sha, content);
      }

      if (isBinary(content)) {
        out += `\n---\n### ${f.path}\n[SKIPPED: Binary file]\n`;
      } else {
        out += `\n---\n### ${f.path}\n\`\`\`\n${content}\n\`\`\`\n`;
        count++;
      }
    } catch (e) {}
  }

  els.dumpOut.value = out;
  els.btnCopyDump.disabled = false;
  els.btnDownloadDump.disabled = false;
  els.btnDump.disabled = false;
  updateStatus("Ready", `Dump complete. ${count} files included.`, 100);
}

// --- Utilities ---

function decodeBase64(str) {
  try {
    return decodeURIComponent(escape(atob(str.replace(/\s/g, ''))));
  } catch(e) {
    return atob(str.replace(/\s/g, ''));
  }
}

function isBinary(str) {
  for (let i = 0; i < Math.min(str.length, 1000); i++) {
    const charCode = str.charCodeAt(i);
    if (charCode === 65533 || charCode <= 8) return true;
  }
  return false;
}

function getIcon(ext) {
  const icons = { js: "js", ts: "ts", html: "🌐", css: "🎨", md: "📝", json: "⚙️" };
  return icons[ext] || "📄";
}

function toggleTheme() {
  const isLight = document.documentElement.dataset.theme === "light";
  document.documentElement.dataset.theme = isLight ? "dark" : "light";
  localStorage.setItem("rd_theme", isLight ? "dark" : "light");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    const old = els.statusText.textContent;
    els.statusText.textContent = "Copied! ✅";
    setTimeout(() => els.statusText.textContent = old, 1500);
  } catch(e) { alert("Copy failed."); }
}

function downloadDump() {
  const blob = new Blob([els.dumpOut.value], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.repo}-dump.txt`;
  a.click();
}

init();
