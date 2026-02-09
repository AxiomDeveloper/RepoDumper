const App = {
    token: localStorage.getItem('rd_token') || '',
    repos: [],
    selectedRepos: new Set(),
    filesMap: {},
    selectedFiles: new Set(),

    async api(path, isFull = false) {
        const headers = { 'Accept': 'application/vnd.github.v3+json' };
        if (this.token) headers['Authorization'] = `token ${this.token}`;
        const res = await fetch(isFull ? path : `https://api.github.com/${path}`, { headers });
        if (!res.ok) throw new Error("API Connection Failed");
        return res.json();
    },

    init() {
        if (this.token) {
            document.getElementById('githubToken').value = this.token;
            this.syncRepos();
        }
        this.bindEvents();
    },

    bindEvents() {
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.onclick = () => !b.disabled && this.showView(b.dataset.target);
        });

        document.getElementById('btnAuth').onclick = () => {
            this.token = document.getElementById('githubToken').value.trim();
            localStorage.setItem('rd_token', this.token);
            this.syncRepos();
        };

        document.getElementById('btnLoadSelected').onclick = () => this.loadTrees();
        document.getElementById('btnSelectAll').onclick = () => this.bulkFiles(true);
        document.getElementById('btnSelectNone').onclick = () => this.bulkFiles(false);
        document.getElementById('treeSearch').oninput = (e) => this.filterTree(e.target.value);
        document.getElementById('btnCompile').onclick = () => this.generate();
        document.getElementById('btnCopy').onclick = () => this.copy();
        document.getElementById('btnReset').onclick = () => { if(confirm("Clear application state?")) location.reload(); };
    },

    showView(id) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(id).classList.add('active');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.target === id));
        document.getElementById('viewTitle').innerText = { 'view-dashboard': 'Sources', 'view-explorer': 'Explorer', 'view-compiler': 'Export' }[id];
    },

    async syncRepos() {
        const list = document.getElementById('repoList');
        try {
            this.repos = await this.api('user/repos?sort=updated&per_page=100');
            list.innerHTML = this.repos.map(r => `
                <div class="repo-item" onclick="App.toggleRepo('${r.full_name}', this)">
                    <span>${r.name}</span>
                    <div class="checkbox ${this.selectedRepos.has(r.full_name) ? 'checked' : ''}"></div>
                </div>
            `).join('');
        } catch (e) { list.innerHTML = `<div class="status-msg">${e.message}</div>`; }
    },

    toggleRepo(name, el) {
        if (this.selectedRepos.has(name)) this.selectedRepos.delete(name);
        else this.selectedRepos.add(name);
        el.querySelector('.checkbox').classList.toggle('checked');
        const btn = document.getElementById('btnLoadSelected');
        btn.disabled = this.selectedRepos.size === 0;
        btn.innerText = `Load ${this.selectedRepos.size} Repositories`;
    },

    async loadTrees() {
        const btn = document.getElementById('btnLoadSelected');
        btn.innerText = "Syncing...";
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
        } catch (e) { alert(e.message); }
        btn.innerText = `Load ${this.selectedRepos.size} Repositories`;
    },

    renderTree() {
        const container = document.getElementById('fileTree');
        container.innerHTML = Object.keys(this.filesMap).map(repo => `
            <div class="list-header" style="margin-top:20px">${repo}</div>
            ${this.filesMap[repo].map(f => {
                const key = `${repo}|${f.path}`;
                return `<div class="tree-item" onclick="App.toggleFile('${key}', this)">
                    <div class="checkbox ${this.selectedFiles.has(key) ? 'checked' : ''}"></div>
                    <span class="tree-label">${f.path}</span>
                </div>`;
            }).join('')}
        `).join('');
        this.updateStats();
    },

    toggleFile(key, el) {
        if (this.selectedFiles.has(key)) this.selectedFiles.delete(key);
        else this.selectedFiles.add(key);
        el.querySelector('.checkbox').classList.toggle('checked');
        this.updateStats();
    },

    filterTree(q) {
        const val = q.toLowerCase();
        document.querySelectorAll('.tree-item').forEach(el => {
            el.style.display = el.innerText.toLowerCase().includes(val) ? 'flex' : 'none';
        });
    },

    updateStats() {
        let size = 0;
        this.selectedFiles.forEach(k => {
            const [r, p] = k.split('|');
            size += (this.filesMap[r].find(f => f.path === p).size || 0);
        });
        const tokens = Math.ceil(size / 4);
        const badge = document.getElementById('tokenBadge');
        badge.innerText = `${tokens.toLocaleString()} Tokens`;
        badge.classList.remove('badge-hidden');
        document.getElementById('selectedCount').innerText = `${this.selectedFiles.size} Selected`;
    },

    bulkFiles(val) {
        this.selectedFiles.clear();
        if (val) Object.keys(this.filesMap).forEach(r => this.filesMap[r].forEach(f => this.selectedFiles.add(`${r}|${f.path}`)));
        this.renderTree();
    },

    async generate() {
        const out = document.getElementById('outputArea');
        out.value = "Processing code...";
        this.showView('view-compiler');
        
        const useXml = document.getElementById('optXml').checked;
        const clean = document.getElementById('optClean').checked;
        let payload = "";

        for (const key of Array.from(this.selectedFiles)) {
            const [repo, path] = key.split('|');
            const node = this.filesMap[repo].find(f => f.path === path);
            try {
                const data = await this.api(`repos/${repo}/git/blobs/${node.sha}`);
                let content = new TextDecoder().decode(Uint8Array.from(atob(data.content), c => c.charCodeAt(0)));
                if (clean) content = content.split('\n').filter(l => !l.trim().startsWith('import ') && !l.trim().startsWith('require(')).join('\n');
                
                payload += useXml ? `<file path="${path}" repo="${repo}">\n${content}\n</file>\n` : `\n// Repo: ${repo} | Path: ${path}\n${content}\n`;
            } catch (e) { payload += `\n// Error loading ${path}\n`; }
        }
        out.value = payload;
    },

    copy() {
        navigator.clipboard.writeText(document.getElementById('outputArea').value);
        const t = document.getElementById('toast');
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2000);
    }
};

App.init();
