// --- STATE MANAGEMENT ---
const App = {
    token: localStorage.getItem('rd_token') || '',
    repos: [],
    currentRepo: null,
    files: [], // Flat list of all blobs
    selectedPaths: new Set(),
    treeLimit: 2000, // Safety limit for GitHub API
    
    // API Helper
    async fetch(url, isFullUrl = false) {
        if (!this.token && !url.includes('api.github.com')) {
            // Allow public access if no token, but it hits rate limits fast
        }
        
        const headers = {
            'Accept': 'application/vnd.github.v3+json'
        };
        if (this.token) headers['Authorization'] = `token ${this.token}`;

        const endpoint = isFullUrl ? url : `https://api.github.com/${url}`;
        const res = await fetch(endpoint, { headers });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.message || res.statusText);
        }
        return res.json();
    },

    init() {
        // Restore Token
        if (this.token) {
            document.getElementById('githubToken').value = this.token;
            this.loadUserRepos();
        }

        this.bindEvents();
    },

    bindEvents() {
        // View Navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                this.switchView(btn.dataset.target);
            });
        });

        // Auth
        document.getElementById('btnAuth').addEventListener('click', () => {
            const t = document.getElementById('githubToken').value.trim();
            if (t) {
                this.token = t;
                localStorage.setItem('rd_token', t);
                this.loadUserRepos();
                this.toast("Token Saved");
            }
        });

        // Manual Repo Fetch
        document.getElementById('btnFetchManual').addEventListener('click', () => {
            const input = document.getElementById('manualRepoInput').value.trim();
            if(input) this.selectRepo(input);
        });

        // File Selection Controls
        document.getElementById('btnSelectAll').onclick = () => {
            this.files.forEach(f => this.selectedPaths.add(f.path));
            this.renderTree();
        };
        document.getElementById('btnSelectNone').onclick = () => {
            this.selectedPaths.clear();
            this.renderTree();
        };
        document.getElementById('btnBackToDash').onclick = () => this.switchView('view-dashboard');
        
        // Compile
        document.getElementById('btnCompile').onclick = () => this.compile();
        document.getElementById('btnCopy').onclick = () => {
            navigator.clipboard.writeText(document.getElementById('outputArea').value);
            this.toast("Copied to Clipboard");
        };
    },

    switchView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.target === viewId);
        });
        
        const titles = {
            'view-dashboard': 'Dashboard',
            'view-explorer': this.currentRepo ? this.currentRepo.split('/')[1] : 'Explorer',
            'view-compiler': 'Export'
        };
        document.getElementById('headerTitle').innerText = titles[viewId];
    },

    async loadUserRepos() {
        const list = document.getElementById('repoList');
        list.innerHTML = '<div style="padding:20px; text-align:center">Loading Repos...</div>';
        
        try {
            // Fetch user repos (sorted by updated)
            const data = await this.fetch('user/repos?sort=updated&per_page=50&type=all');
            this.repos = data;
            
            list.innerHTML = '';
            data.forEach(repo => {
                const item = document.createElement('div');
                item.className = 'repo-item';
                item.innerHTML = `
                    <div>
                        <span class="repo-name">${repo.name}</span>
                        <span class="repo-meta">${repo.owner.login} • ${repo.private ? '🔒' : '🌎'}</span>
                    </div>
                    <div style="color:var(--text-secondary)">›</div>
                `;
                item.onclick = () => this.selectRepo(repo.full_name, repo.default_branch);
                list.appendChild(item);
            });
        } catch (e) {
            list.innerHTML = `<div style="padding:20px; color:red">Error: ${e.message}</div>`;
        }
    },

    async selectRepo(fullName, branch = 'main') {
        this.currentRepo = fullName;
        this.toast(`Fetching ${fullName}...`);
        
        try {
            // Get default branch if not known
            if (!branch || branch === 'main') {
                const repoData = await this.fetch(`repos/${fullName}`);
                branch = repoData.default_branch;
            }

            // Get Tree
            const treeData = await this.fetch(`repos/${fullName}/git/trees/${branch}?recursive=1`);
            
            // Filter only blobs (files), ignore .git, images, locks
            const ignore = ['.png', '.jpg', '.jpeg', '.gif', '.ico', 'package-lock.json', 'yarn.lock', '.git/'];
            
            this.files = treeData.tree.filter(node => 
                node.type === 'blob' && !ignore.some(ext => node.path.includes(ext))
            );

            // Reset Selection
            this.selectedPaths.clear();
            // Default: Select top 20 text files to start
            this.files.slice(0, 20).forEach(f => this.selectedPaths.add(f.path));

            // Enable Tab
            document.getElementById('tabExplorer').disabled = false;
            
            this.renderTree();
            this.switchView('view-explorer');
            
        } catch (e) {
            alert("Failed to load repo: " + e.message);
        }
    },

    renderTree() {
        const container = document.getElementById('fileTree');
        document.getElementById('selectedCount').innerText = `${this.selectedPaths.size} selected`;
        
        // Simple virtual list approximation (render first 500 for perf)
        const displayFiles = this.files.slice(0, 500); 
        
        container.innerHTML = displayFiles.map(file => {
            const isChecked = this.selectedPaths.has(file.path);
            return `
                <div class="tree-item" onclick="App.toggleFile('${file.path}')">
                    <div class="tree-checkbox ${isChecked ? 'checked' : ''}"></div>
                    <div class="tree-label">${file.path}</div>
                    <div class="tree-badge">${(file.size / 1024).toFixed(1)}kb</div>
                </div>
            `;
        }).join('');
        
        if (this.files.length > 500) {
            container.innerHTML += `<div style="padding:20px; text-align:center; color:#666">...and ${this.files.length - 500} more files (hidden for performance)</div>`;
        }
    },

    toggleFile(path) {
        if (this.selectedPaths.has(path)) {
            this.selectedPaths.delete(path);
        } else {
            this.selectedPaths.add(path);
        }
        this.renderTree();
    },

    async compile() {
        const output = document.getElementById('outputArea');
        output.value = "Compiling... please wait.";
        this.switchView('view-compiler');

        const useXml = document.getElementById('optXml').checked;
        const clean = document.getElementById('optClean').checked;
        
        let result = "";
        
        // 1. Metadata
        result += `Repository: ${this.currentRepo}\nExport Date: ${new Date().toISOString()}\n\n`;

        // 2. Structure
        result += `--- FILE STRUCTURE ---\n`;
        result += Array.from(this.selectedPaths).join('\n') + `\n\n`;

        // 3. Contents
        result += `--- FILE CONTENTS ---\n`;
        
        // Process sequentially to manage rate limits
        const paths = Array.from(this.selectedPaths);
        
        for (let i = 0; i < paths.length; i++) {
            const path = paths[i];
            const fileNode = this.files.find(f => f.path === path);
            
            try {
                // Determine format
                const fileHeader = useXml 
                    ? `<file path="${path}">` 
                    : `\n// --------------------------------------------------------\n// FILE: ${path}\n// --------------------------------------------------------\n`;
                
                const fileFooter = useXml ? `\n</file>\n` : `\n`;

                output.value = `Fetching (${i+1}/${paths.length}): ${path}...`;
                
                // Fetch Blob
                const blob = await this.fetch(`repos/${this.currentRepo}/git/blobs/${fileNode.sha}`);
                
                // Decode UTF-8 properly (atob is buggy with emojis)
                const decoded = new TextDecoder().decode(
                    Uint8Array.from(atob(blob.content), c => c.charCodeAt(0))
                );

                let content = decoded;
                if (clean) {
                    // Remove import lines (basic heuristic)
                    content = content.split('\n').filter(l => !l.trim().startsWith('import') && !l.trim().startsWith('require')).join('\n');
                }

                result += `${fileHeader}\n${content}${fileFooter}\n`;

            } catch (e) {
                result += `\nError fetching ${path}: ${e.message}\n`;
            }
        }

        output.value = result;
        this.toast("Payload Ready");
    },

    toast(msg) {
        const t = document.getElementById('toast');
        t.innerText = msg;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2000);
    }
};

// Start
document.addEventListener('DOMContentLoaded', () => App.init());
