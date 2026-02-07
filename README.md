# Repo Dumper (GitHub Pages)

Static web app to:
- Load GitHub repo metadata + full recursive tree
- Browse files and copy contents
- Generate a single AI-ready "repo dump" (tree + all file text)

## Deploy on GitHub Pages
1) Create a repo and add these files (index.html, styles.css, app.js, manifest.json, sw.js).
2) GitHub repo Settings → Pages
   - Source: Deploy from a branch
   - Branch: main (root)
3) Open your Pages URL.

## Token (PAT) guidance
- Use a fine-scoped token, ideally read-only.
- For private repos, ensure it has permission to read that repo.
- The token stays in your browser memory; it is not stored by default.

## Notes / Limits
- Uses GitHub REST API (trees + blobs).
- Large repos can be slow. Use:
  - Exclude patterns (node_modules, dist, build, etc.)
  - Max file size limit