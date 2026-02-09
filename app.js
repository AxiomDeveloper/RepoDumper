const App = {
    token: localStorage.getItem('rd_token') || '',
    repos: [],
    selectedRepos: new Set(),
    filesMap: {},
    selectedFiles: new Set(),

    init() {
        if (this.token) {
            document.getElementById('githubToken').value = this.token;
            this.syncRepos();
        }
        this.bind();
    },

    async api(path) {
        const headers = { 'Accept': 'application/vnd.github.v3+json' };
        if (this.token) headers['Authorization'] = `token ${this.token}`;
        const res = await fetch(`https://api.github.com/${path}`, { headers });
        if (!res.ok) throw new Error("Sync Failed");
        return res.json();
    },

    bind() {
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.onclick = () => !b.disabled && this.showView(b.dataset.target);
        });

        document.getElementById('btnAuth').onclick = () => {
            this.token = document.getElementById('githubToken').value.trim();
            localStorage.setItem('rd_token', this.token);
            this.syncRepos();
        };

        document.getElementById('btnLoadSelected').onclick = () => this.loadFiles();
        document.getElementById('btnSelectAll').onclick = () => this.bulkFiles(true);
        document.getElementById('btnSelectNone').onclick = () => this.bulkFiles(false);
        document.getElementById('treeSearch').oninput = (e) => this.filterTree(e.target.value);
        document.getElementById('btnCompile').onclick = () => this.generate();
        document.getElementById('btnCopy').onclick = () => this.copy();
        document.getElementById('btnReset').onclick = () => { if(confirm("Reset all data?")) { localStorage.clear(); location.reload(); }};
    },

    showView(id) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(id).classList.add('active');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.target === id));
        document.getElementById('viewTitle').innerText = { 'view-dashboard': 'Sources', 'view-explorer': 'Explorer', 'view-compiler': 'Export' }[id];
    },

    async syncRepos() {
        const list = document.getElementById('repoList');
        list.innerHTML = `<div class="ios-status-card">Connecting...</div>`;
        try {
            this.repos = await this.api('user/repos?sort=updated&per_page=100');
            list.innerHTML = this.repos.map(r => `
                <div class="repo-card ${this.selectedRepos.has(r.full_name) ? 'selected' : ''}" onclick="App.toggleRepo('${r.full_name}', this)">
                    <span>${r.name}</span>
                    <div class="ios-check"></div>
                </div>
            `).join('');
        } catch (e) { list.innerHTML = `<div class="ios-status-card">${e.message}</div>`; }
    },

    toggleRepo(name, el) {
        if (this.selectedRepos.has(name)) this.selectedRepos.delete(name);
        else this.selectedRepos.add(name);
        el.classList.toggle('selected');
        document.getElementById('btnLoadSelected').disabled = this.selectedRepos.size === 0;
        document.getElementById('btnLoadSelected').innerText = `Load ${this.selectedRepos.size} Projects`;
    },

    async loadFiles() {
        const btn = document.getElementById('btnLoadSelected');
        btn.innerText = "Indexing Trees...";
        this.filesMap = {};
        this.selectedFiles.clear();

        try {
            for (const name of Array.from(this.selectedRepos)) {
                const repo = await this.api(`repos/${name}`);
                const data = await this.api(`repos/${name}/git/trees/${repo.default_branch}?recursive=1`);
                this.filesMap[name] = data.tree.filter(f => f.type === 'blob' && !f.path.match(/\.(png|jpg|lock|ico)$/i));
            }
            this.renderTree();
            document.getElementById('tabExplorer').disabled = false;
            this.showView('view-explorer');
        } catch (e) { alert("Rate limit or error: " + e.message); }
        btn.innerText = `Load ${this.selectedRepos.size} Projects`;
    },

    renderTree() {
        const container = document.getElementById('fileTree');
        container.innerHTML = Object.keys(this.filesMap).map(repo => `
            <div class="ios-group-label" style="margin-top:20px">${repo}</div>
            ${this.filesMap[repo].map(f => {
                const key = `${repo}|${f.path}`;
                return `<div class="file-card ${this.selectedFiles.has(key) ? 'selected' : ''}" onclick="App.toggleFile('${key}', this)">
                    <span style="font-size: 0.85rem; font-family: monospace;">${f.path}</span>
                    <div class="ios-check"></div>
                </div>`;
            }).join('')}
        `).join('');
        this.updateStats();
    },

    toggleFile(key, el) {
        if (this.selectedFiles.has(key)) this.selectedFiles.delete(key);
        else this.selectedFiles.add(key);
        el.classList.toggle('selected');
        this.updateStats();
    },

    filterTree(q) {
        const val = q.toLowerCase();
        document.querySelectorAll('.file-card').forEach(el => {
            el.style.display = el.innerText.toLowerCase().includes(val) ? 'flex' : 'none';
        });
    },

    updateStats() {
        let size = 0;
        this.selectedFiles.forEach(k => {
            const [r, p] = k.split('|');
            size += (this.filesMap[r].find(f => f.path === p).size || 0);
        });
        const pill = document.getElementById('tokenPill');
        pill.innerText = `${Math.ceil(size / 4).toLocaleString()} Tokens`;
        pill.classList.remove('hidden');
        document.getElementById('selectedCount').innerText = `${this.selectedFiles.size} Files Selected`;
    },

    bulkFiles(val) {
        this.selectedFiles.clear();
        if (val) Object.keys(this.filesMap).forEach(r => this.filesMap[r].forEach(f => this.selectedFiles.add(`${r}|${f.path}`)));
        this.renderTree();
    },

    async generate() {
        const out = document.getElementById('outputArea');
        out.value = "Compiling codebase...";
        this.showView('view-compiler');
        
        const xml = document.getElementById('optXml').checked;
        const clean = document.getElementById('optClean').checked;
        let res = "";

        for (const key of Array.from(this.selectedFiles)) {
            const [repo, path] = key.split('|');
            const node = this.filesMap[repo].find(f => f.path === path);
            try {
                const data = await this.api(`repos/${repo}/git/blobs/${node.sha}`);
                let code = new TextDecoder().decode(Uint8Array.from(atob(data.content), c => c.charCodeAt(0)));
                if (clean) code = code.split('\n').filter(l => !l.trim().startsWith('import ') && !l.trim().startsWith('require(')).join('\n');
                res += xml ? `<file path="${path}" repo="${repo}">\n${code}\n</file>\n` : `\n// ${repo} > ${path}\n${code}\n`;
            } catch (e) { res += `\n// Error: ${path}\n`; }
        }
        out.value = res;
    },

    copy() {
        navigator.clipboard.writeText(document.getElementById('outputArea').value);
        if (window.navigator.vibrate) window.navigator.vibrate(50);
        const t = document.getElementById('toast');
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2000);
    }
};

App.init();
