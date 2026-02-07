const $ = (id) => document.getElementById(id);

const state = {
  owner: "", repo: "", branch: "",
  tree: [], files: [], 
  fileCache: new Map(),
  treeText: ""
};

const els = {
  token: $("token"), repoUrl: $("repoUrl"), branch: $("branch"), maxKb: $("maxKb"),
  exclude: $("exclude"), btnLoad: $("btnLoad"), btnDump: $("btnDump"),
  statusPill: $("statusPill"), statusText: $("statusText"), progressBar: $("progressBar"),
  tree: $("tree"), treeSearch: $("treeSearch"), dumpOut: $("dumpOut"),
  filePreview: $("filePreview"), activePath: $("activePath"), fileContent: $("fileContent"),
  btnCopyDump: $("btnCopyDump"), toast: $("toast")
};

function init() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.target));
  });

  // Action listeners
  els.btnLoad.addEventListener("click", onLoadRepo);
  els.btnDump.addEventListener("click", onDumpAll);
  els.treeSearch.addEventListener("input", renderTree);
  $("btnClosePreview").addEventListener("click", () => els.filePreview.classList.remove("active"));
  $("btnCopyFile").addEventListener("click", () => copyToClipboard(els.fileContent.textContent));
  els.btnCopyDump.addEventListener("click", () => copyToClipboard(els.dumpOut.value));

  // Persistence
  els.token.value = localStorage.getItem("rd_token") || "";
  els.repoUrl.value = localStorage.getItem("rd_repoUrl") || "";

  // Theme
  $("btnTheme").addEventListener("click", () => {
    const isLight = document.documentElement.dataset.theme === "light";
    document.documentElement.dataset.theme = isLight ? "dark" : "light";
  });
}

function switchView(view) {
  document.body.dataset.view = view;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.target === view));
}

async function fetchGH(path) {
  const token = els.token.value.trim();
  const headers = { "Accept": "application/vnd.github+json" };
  if(token) {
    headers["Authorization"] = `Bearer ${token}`;
    localStorage.setItem("rd_token", token);
  }
  const r = await fetch(`https://api.github.com/${path}`, { headers });
  if(!r.ok) throw new Error(r.statusText);
  return r.json();
}

async function onLoadRepo() {
  try {
    const raw = els.repoUrl.value.trim();
    let parts = raw.replace("https://github.com/", "").split("/").filter(Boolean);
    if(parts.length < 2) throw new Error("Format: owner/repo");
    
    state.owner = parts[0];
    state.repo = parts[1].replace(".git", "");
    localStorage.setItem("rd_repoUrl", raw);

    updateProgress("Connecting", 30);
    const repoInfo = await fetchGH(`repos/${state.owner}/${state.repo}`);
    state.branch = els.branch.value || repoInfo.default_branch;

    updateProgress("Reading Tree", 60);
    const branchInfo = await fetchGH(`repos/${state.owner}/${state.repo}/branches/${encodeURIComponent(state.branch)}`);
    const treeData = await fetchGH(`repos/${state.owner}/${state.repo}/git/trees/${branchInfo.commit.sha}?recursive=1`);
    
    state.tree = treeData.tree;
    processTree();
    renderTree();

    $("displayRepoName").textContent = state.repo;
    $("displayBranchName").textContent = state.branch;
    els.btnDump.disabled = false;
    updateProgress("Ready", 100);
    switchView("explorer");
  } catch (e) {
    updateProgress("Error", 0, e.message);
  }
}

function processTree() {
  const ex = els.exclude.value.toLowerCase().split(',').map(s => s.trim());
  state.files = state.tree.filter(n => n.type === "blob" && !ex.some(e => n.path.toLowerCase().includes(e)));
  state.treeText = state.tree.map(n => `${"  ".repeat(n.path.split("/").length-1)}- ${n.path.split("/").pop()}${n.type === 'tree' ? '/' : ''}`).join("\n");
}

function renderTree() {
  const q = els.treeSearch.value.toLowerCase();
  els.tree.innerHTML = "";
  state.files.forEach(f => {
    if(q && !f.path.toLowerCase().includes(q)) return;
    const d = document.createElement("div");
    d.className = "node";
    d.innerHTML = `📄 ${f.path}`;
    d.onclick = () => openFile(f);
    els.tree.appendChild(d);
  });
}

async function openFile(file) {
  els.filePreview.classList.add("active");
  els.fileContent.textContent = "Loading file...";
  try {
    const data = await fetchGH(`repos/${state.owner}/${state.repo}/git/blobs/${file.sha}`);
    const content = atob(data.content.replace(/\n/g, ''));
    els.fileContent.textContent = content;
    els.activePath.textContent = file.path;
  } catch(e) { els.fileContent.textContent = "Error loading."; }
}

async function onDumpAll() {
  switchView("output");
  els.dumpOut.value = "Working... check progress bar.";
  let out = `# REPO: ${state.owner}/${state.repo}\n## TREE\n${state.treeText}\n\n## FILES\n`;
  const limit = (parseInt(els.maxKb.value) || 512) * 1024;

  for(let i=0; i < state.files.length; i++) {
    const f = state.files[i];
    updateProgress("Dumping", Math.floor((i/state.files.length)*100));
    if(f.size > limit) continue;
    try {
      const data = await fetchGH(`repos/${state.owner}/${state.repo}/git/blobs/${f.sha}`);
      const content = atob(data.content.replace(/\n/g, ''));
      out += `\n---\n### ${f.path}\n\`\`\`\n${content}\n\`\`\`\n`;
    } catch(e) {}
  }
  els.dumpOut.value = out;
  els.btnCopyDump.disabled = false;
  updateProgress("Done", 100);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    els.toast.classList.add("show");
    setTimeout(() => els.toast.classList.remove("show"), 2000);
  });
}

function updateProgress(pill, pct, text) {
  els.statusPill.textContent = pill;
  els.progressBar.style.width = `${pct}%`;
  if(text) els.statusText.textContent = text;
}

init();
