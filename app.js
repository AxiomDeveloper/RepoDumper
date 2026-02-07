const $ = (id) => document.getElementById(id);

const state = {
    tree: [], files: [], 
    meta: null,
    fileCache: new Map(),
    treeText: ""
};

const els = {
    token: $("token"), repoUrl: $("repoUrl"), branch: $("branch"),
    btnLoad: $("btnLoad"), btnDump: $("btnDump"),
    statusPill: $("statusPill"), statusText: $("statusText"), progressBar: $("progressBar"),
    tree: $("tree"), dumpOut: $("dumpOut"), toast: $("toast")
};

function init() {
    // Navigation Logic
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.body.dataset.view = btn.dataset.target;
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    els.btnLoad.addEventListener("click", onLoadRepo);
    els.btnDump.addEventListener("click", onCompileDump);
    $("btnClosePreview").addEventListener("click", () => $("filePreview").classList.remove("active"));
    $("btnCopyDump").addEventListener("click", () => copyText(els.dumpOut.value));
}

async function fetchGH(path) {
    const h = { "Accept": "application/vnd.github+json" };
    if(els.token.value) h["Authorization"] = `Bearer ${els.token.value.trim()}`;
    const r = await fetch(`https://api.github.com/${path}`, { headers: h });
    if(!r.ok) throw new Error(r.statusText);
    return r.json();
}

async function onLoadRepo() {
    try {
        const raw = els.repoUrl.value.trim();
        let parts = raw.replace("https://github.com/", "").split("/").filter(Boolean);
        if(parts.length < 2) throw new Error("Format: owner/repo");
        
        const owner = parts[0], repo = parts[1].replace(".git", "");
        
        updateStatus("Syncing", "Fetching Metadata...", 30);
        state.meta = await fetchGH(`repos/${owner}/${repo}`);
        const branch = els.branch.value || state.meta.default_branch;

        updateStatus("Indexing", "Recursive Tree Mapping...", 60);
        const brData = await fetchGH(`repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
        const treeData = await fetchGH(`repos/${owner}/${repo}/git/trees/${brData.commit.sha}?recursive=1`);
        
        state.tree = treeData.tree;
        processData(owner, repo, branch);
        renderTree();

        $("displayRepoName").textContent = repo;
        $("displayBranchName").textContent = branch;
        updateStatus("Ready", `${state.files.length} files found.`, 100);
        
        // Auto-switch to Explorer on success
        document.querySelector('[data-target="explorer"]').click();
    } catch (e) {
        updateStatus("Error", e.message, 0);
    }
}

function processData(owner, repo, branch) {
    const ex = $("exclude").value.toLowerCase().split(',').map(s => s.trim());
    state.files = state.tree.filter(n => n.type === 'blob' && !ex.some(p => n.path.toLowerCase().includes(p)));
    
    // Build visualized tree text
    state.treeText = state.tree
        .filter(n => !ex.some(p => n.path.toLowerCase().includes(p)))
        .map(n => `${"  ".repeat(n.path.split("/").length-1)}- ${n.path.split("/").pop()}${n.type==='tree'?'/':''}`)
        .join("\n");
}

function renderTree() {
    els.tree.innerHTML = "";
    state.files.forEach(f => {
        const div = document.createElement('div');
        div.className = 'native-input'; // Reuse styling
        div.style.marginBottom = '5px';
        div.innerHTML = `📄 <small>${f.path}</small>`;
        div.onclick = () => openFile(f);
        els.tree.appendChild(div);
    });
}

async function openFile(file) {
    $("filePreview").classList.add("active");
    $("fileContent").textContent = "Decoding...";
    try {
        const data = await fetchGH(`repos/${state.meta.owner.login}/${state.meta.name}/git/blobs/${file.sha}`);
        const content = atob(data.content.replace(/\n/g, ''));
        $("fileContent").textContent = content;
        $("activePath").textContent = file.path;
    } catch(e) { $("fileContent").textContent = "Error loading."; }
}

async function onCompileDump() {
    updateStatus("Compiling", "Gathering selected data...", 50);
    let dump = "";

    if($("optMeta").checked) {
        dump += `--- REPO METADATA ---\nRepo: ${state.meta.full_name}\nDesc: ${state.meta.description}\n\n`;
    }

    if($("optTree").checked) {
        dump += `--- STRUCTURE ---\n${state.treeText}\n\n`;
    }

    if($("optFiles").checked) {
        dump += `--- CONTENTS ---\n`;
        for(let f of state.files) {
            const data = await fetchGH(`repos/${state.meta.owner.login}/${state.meta.name}/git/blobs/${f.sha}`);
            const content = atob(data.content.replace(/\n/g, ''));
            dump += `\n---\nFILE: ${f.path}\n\`\`\`\n${content}\n\`\`\`\n`;
        }
    }

    els.dumpOut.value = dump;
    updateStatus("Ready", "Payload Compiled.", 100);
}

function copyText(txt) {
    navigator.clipboard.writeText(txt).then(() => {
        els.toast.classList.add("show");
        setTimeout(() => els.toast.classList.remove("show"), 2000);
    });
}

function updateStatus(pill, text, pct) {
    els.statusPill.textContent = pill;
    els.statusText.textContent = text;
    els.progressBar.style.width = `${pct}%`;
}

init();
