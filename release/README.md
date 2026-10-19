# GitHub release assets

This folder contains the distributable GitHub release for ELECTRA Power System
Studio v1.0.0.

| File | Purpose |
|---|---|
| `ELECTRA-Power-Studio-v1.0.0.zip` | Complete static application + tests + docs |
| `SHA256SUMS.txt` | SHA-256 checksum of the zip |
| `RELEASE_NOTES.md` | Markdown body for the GitHub Release |

## Publishing the release

1. Push the repository to GitHub (default branch `main`).
2. Create a tag and push it:

   ```bash
   git tag -a v1.0.0 -m "ELECTRA Power System Studio v1.0.0"
   git push origin main --tags
   ```

3. Create a GitHub Release from tag `v1.0.0`, paste the contents of
   `RELEASE_NOTES.md`, and upload the zip plus `SHA256SUMS.txt` as release assets.
4. Optional: enable **Settings → Pages → Source: GitHub Actions**. The included
   workflow deploys the static app from `main`.

The zip is intentionally ignored by `.gitignore`; upload it through the GitHub
Releases UI rather than committing the binary to the repository.
