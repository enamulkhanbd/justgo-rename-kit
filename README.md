# Rename Kit for Figma

Rename Kit is a Figma plugin that helps teams keep files clean and consistent by automating layer naming and surfacing text color mismatches.

## Latest Updates

- Added relaunch button support so you can rerun the plugin directly from the right-side properties panel.
- Added a dedicated `Settings` command with an in-plugin UI for rule management.
- Added configurable rename and color-validation rules (no code edits required for common changes).
- Improved release automation with GitHub Actions workflows for tagging, packaging, and publishing.
- Latest published entry in [RELEASES.md](RELEASES.md): `v1.2.0`.

## Features

1. Text Layer Renaming
- Renames text layers based on mapped text style color paths.
- Example: `colors/content/text/regular/heading` can map to `heading-text`.

2. Default Frame Renaming
- Renames default frame names like `Frame`, `Frame 1`, `Frame 27` to `item`.

3. Mismatched Color Detection
- Detects text layers where color style/variable does not match expected paths for that style category.
- Selects mismatched layers automatically so they can be fixed quickly.

4. Relaunch Button Support
- Adds `Run Rename Kit` relaunch data to selected nodes/page for faster reruns.

5. Settings UI
- Manage rename rules and never-flag color paths from `Plugins > JustGo Rename Kit > Settings`.

## How To Use

1. Select one or more frames/groups/layers in Figma.
2. Run `Plugins > JustGo Rename Kit > Run Rename Kit`.
3. Review the notification summary (renamed text layers, renamed frames, mismatches selected).
4. Optional: use `Plugins > JustGo Rename Kit > Settings` to edit rules.
5. Optional: use Quick Actions (`Ctrl + /` on Windows or `Cmd + /` on macOS) and type `Rename Kit`.

## Configuration

The plugin stores settings in `figma.clientStorage` and uses these main structures:

```js
{
  renameRules: [
    { newName: "heading-text", path: "colors/content/text/regular/heading" },
    { newName: "title-text", path: "colors/content/text/inverse/title" }
  ],
  alwaysAllowedColors: [
    "colors/content/text/state/info",
    "colors/content/text/state/success"
  ]
}
```

Rules notes:
- `renameRules[].path` must be unique.
- The last segment of the path is used as the style category fallback.
- `alwaysAllowedColors` are paths that should never be flagged as mismatched.

## Release Workflows

This repository has two GitHub Actions workflows for releases.

### 1) `.github/workflows/releases-auto-version.yml` (automatic)

Purpose: auto version bump + optional `RELEASES.md` update + tag + GitHub Release.

Trigger:
- Runs on `push` to `main`.
- Ignores pushes that only change `RELEASES.md`.

Version bump rules (from commit subject lines since last `v*` tag):
- `Breaking:` -> `major`
- `Release:` or `Releases:` -> `minor`
- `Fix:` -> `patch`
- No matching subject -> no bump, no tag, no release

Flow:
1. Finds the latest `vX.Y.Z` tag (or uses `v0.0.0` if none).
2. Computes next version based on rules above.
3. Collects `Release:` / `Releases:` lines and inserts them under `## vX.Y.Z` in `RELEASES.md`.
4. Commits `RELEASES.md` only if changed.
5. Creates and pushes annotated tag `vX.Y.Z`.
6. Packages zip from `manifest.json`, `manifest.main`, `manifest.ui`, plus optional `assets/`.
7. Builds release notes (prefers the matching `RELEASES.md` section; falls back to commit subjects).
8. Creates GitHub Release and uploads `<repo-slug>-vX.Y.Z.zip`.

Skip behavior:
- If latest commit message contains `[no release]`, zip/GitHub Release steps are skipped.
- Tag creation still runs when a bump is detected.

### 2) `.github/workflows/releases-zip.yml` (manual)

Purpose: manual packaging and release publishing.

Trigger:
- `workflow_dispatch` (run manually from GitHub Actions).

Flow:
1. Packages zip using `manifest.json` + `main` + `ui` (+ optional `assets/`).
2. Uses current ref name as tag (`GITHUB_REF_NAME`).
3. Builds release notes from matching section in `RELEASES.md` if present.
4. Creates GitHub Release and uploads the zip.

## Commit Message Conventions For Auto Versioning

Use these subject prefixes at the start of commit messages:

- `Breaking: ...` for major releases.
- `Release: ...` or `Releases: ...` for minor releases and changelog bullets.
- `Fix: ...` for patch releases.

Example:

```text
Releases: Add settings UI for rename rules
Fix: Handle duplicate rule paths in validation
```

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
