const App = {
    token: localStorage.getItem('rd_token') || '',
    userRepos: [],
    selectedRepos: new Set(),
    repoFilesMap: {}, 
    selectedFileKeys: new Set(),

    async fetch(url, isFullUrl = false) {
        const headers = { 'Accept': 'application/vnd.github.v3+json' };
        if (this.token) headers['Authorization'] = `token ${this.token}`;
        const res = await fetch(isFullUrl ? url : `https://api.github.com/${url}`, { headers });
        if (!res.ok) throw new Error((await res.json()).message || "API Error");
        return res.json();
    },

    init() {
        if (this.token) {
            document.getElementById('githubToken').value = this.token;
            this.loadUserRepos();
        }
        this.bindEvents();
    },

    bindEvents() {
        // Nav
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.onclick = () => !btn.disabled && this.switchView(btn.dataset.target);
        });

        // Search
        document.getElementById('treeSearch').oninput = (e) => this.filterTree(e.target.value);

        // Auth
        document.getElementById('btnAuth').onclick = () => {
            this.token = document.getElementById('githubToken').value.trim();
            localStorage.setItem('rd_token', this.token);
            this.loadUserRepos();
            this.toast("Token Saved");
        };

        // Actions
        document.getElementById('btnLoadSelected').onclick = () => this.fetchSelectedRepos();
        document.getElementById('btnSelectAll').onclick = () => this.bulkSelect(true);
        document.getElementById('btnSelectNone').onclick = () => this.bulkSelect(false);
        document.getElementById('btnCompile').onclick = () => this.compile();
        document.getElementById('btnCopy').onclick = () => {
            navigator.clipboard.writeText(document.getElementById('outputArea').value);
            this.toast("Copied to Clipboard");
        };
        document.getElementById('btnReset').onclick = () => {
            if(confirm("Reset everything?")) location.reload();
        };
    },

    switchView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.target === viewId));
        
        const titles = { 'view-dashboard': 'Sources', 'view-explorer': 'Files', 'view-compiler': 'Export' };
        document.getElementById('headerTitle').innerText = titles[viewId];
    },

    async loadUserRepos() {
        const list = document.getElementById('repoList');
        list.innerHTML = '<div style="padding:40px; text-align:center; color:gray;">Fetching Repos...</div>';
        try {
            this.userRepos = await this.fetch('user/repos?sort=updated&per_page=60&type=all');
            this.renderRepoList();
        } catch (e) {
            list.innerHTML = `<div style="padding:20px; color:var(--red)">${e.message}</div>`;
        }
    },

    renderRepoList() {
        const list = document.getElementById('repoList');
        list.innerHTML = this.userRepos.map(repo => `
            <div class="repo-item ${this.selectedRepos.has(repo.full_name) ? 'selected' : ''}" onclick="App.toggleRepoSelection('${repo.full_name}', this)">
                <div>
                    <span class="repo-name">${repo.name}</span>
                    <small style="color:var(--text-secondary)">${repo.owner.login}</small>
                </div>
                <div class="check-icon"></div>
            </div>
        `).join('');
    },

    toggleRepoSelection(name, el) {
        if (this.selectedRepos.has(name)) this.selectedRepos.delete(name);
        else this.selectedRepos.add(name);
        el.classList.toggle('selected');
        
        const btn = document.getElementById('btnLoadSelected');
        btn.disabled = this.selectedRepos.size === 0;
        btn.innerText = `Load ${this.selectedRepos.size} Repositories`;
    },

    async fetchSelectedRepos() {
        const btn = document.getElementById('btnLoadSelected');
        btn.innerText = "Syncing Trees...";
        btn.disabled = true;
        
        this.repoFilesMap = {};
        this.selectedFileKeys.clear();

        try {
            for (const repoName of Array.from(this.selectedRepos)) {
                const repoMeta = await this.fetch(`repos/${repoName}`);
                const tree = await this.fetch(`repos/${repoName}/git/trees/${repoMeta.default_branch}?recursive=1`);
                
                // Exclude assets and noise
                this.repoFilesMap[repoName] = tree.tree.filter(n => 
                    n.type === 'blob' && !n.path.match(/\.(png|jpg|jpeg|gif|ico|svg|woff|ttf|lock)$/i)
                );
                
                // Auto-select small text files as default
                this.repoFilesMap[repoName].slice(0, 8).forEach(f => this.selectedFileKeys.add(`${repoName}|${f.path}`));
            }

            this.renderFileTree();
            document.getElementById('tabExplorer').disabled = false;
            this.switchView('view-explorer');
        } catch (e) {
            alert("Fetch failed: " + e.message);
        } finally {
            btn.innerText = `Load ${this.selectedRepos.size} Repositories`;
            btn.disabled = false;
        }
    },

    renderFileTree() {
        const container = document.getElementById('fileTree');
        container.innerHTML = '';
        
        Object.keys(this.repoFilesMap).forEach(repo => {
            const header = document.createElement('div');
            header.className = 'repo-group-header';
            header.innerText = repo;
            container.appendChild(header);

            this.repoFilesMap[repo].forEach(file => {
                const key = `${repo}|${file.path}`;
                const row = document.createElement('div');
                row.className = 'tree-item';
                row.innerHTML = `
                    <div class="tree-checkbox ${this.selectedFileKeys.has(key) ? 'checked' : ''}"></div>
                    <div class="tree-label">${file.path}</div>
                `;
                row.onclick = () => {
                    if (this.selectedFileKeys.has(key)) this.selectedFileKeys.delete(key);
                    else this.selectedFileKeys.add(key);
                    row.querySelector('.tree-checkbox').classList.toggle('checked');
                    this.updateCounters();
                };
                container.appendChild(row);
            });
        });
        this.updateCounters();
    },

    filterTree(val) {
        const q = val.toLowerCase();
        document.querySelectorAll('.tree-item').forEach(el => {
            el.style.display = el.innerText.toLowerCase().includes(q) ? 'flex' : 'none';
        });
    },

    updateCounters() {
        document.getElementById('selectedCount').innerText = `${this.selectedFileKeys.size} files selected`;
        let totalSize = 0;
        this.selectedFileKeys.forEach(k => {
            const [r, p] = k.split('|');
            const f = this.repoFilesMap[r].find(file => file.path === p);
            totalSize += (f.size || 0);
        });
        const tokens = Math.ceil(totalSize / 4);
        const pill = document.getElementById('tokenCounter');
        pill.innerText = `${tokens.toLocaleString()} tokens`;
        pill.style.background = tokens > 100000 ? 'rgba(255, 69, 58, 0.2)' : 'rgba(48, 209, 88, 0.2)';
        pill.style.color = tokens > 100000 ? 'var(--red)' : 'var(--green)';
    },

    bulkSelect(all) {
        this.selectedFileKeys.clear();
        if (all) {
            Object.keys(this.repoFilesMap).forEach(r => 
                this.repoFilesMap[r].forEach(f => this.selectedFileKeys.add(`${r}|${f.path}`))
            );
        }
        this.renderFileTree();
    },

    async compile() {
        const out = document.getElementById('outputArea');
        out.value = "Working... Please keep app open.";
        this.switchView('view-compiler');

        const useXml = document.getElementById('optXml').checked;
        const clean = document.getElementById('optClean').checked;
        const mode = document.getElementById('promptTemplate').value;

        const headers = {
            debug: "I need you to debug the following code. Identify logic errors and suggest fixes.",
            feature: "I am adding a new feature. Review the following code and implement the new logic using the same patterns.",
            refactor: "Analyze this code for performance bottlenecks and refactor for clarity.",
            default: "Review the following multi-repository codebase."
        };

        let result = `System Instruction: ${headers[mode]}\n\n`;
        const keys = Array.from(this.selectedFileKeys);

        for (let i = 0; i < keys.length; i++) {
            const [repo, path] = keys[i].split('|');
            const node = this.repoFilesMap[repo].find(f => f.path === path);
            try {
                const blob = await this.fetch(`repos/${repo}/git/blobs/${node.sha}`);
                let content = new TextDecoder().decode(Uint8Array.from(atob(blob.content), c => c.charCodeAt(0)));
                
                if (clean) content = content.split('\n').filter(line => !line.trim().startsWith('import ') && !line.trim().startsWith('require(')).join('\n');

                if (useXml) result += `<file repository="${repo}" path="${path}">\n${content}\n</file>\n\n`;
                else result += `\n// REPO: ${repo}\n// FILE: ${path}\n${content}\n`;
                
                out.value = `Progress: ${i+1}/${keys.length} files...`;
            } catch (e) { result += `\n[Error loading ${path}]\n`; }
        }

        out.value = result;
        this.toast("Payload Ready");
    },

    toast(msg) {
        const t = document.getElementById('toast');
        t.innerText = msg; t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2000);
    }
};

App.init();
