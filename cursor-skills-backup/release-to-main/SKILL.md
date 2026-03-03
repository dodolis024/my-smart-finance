---
name: release-to-main
description: Merge dev into main, push to production, and finalize CHANGELOG.md with a version number. Use when the user wants to release, merge dev to main, publish, deploy, or assign a version number to accumulated changes.
---

# Release to Main

When the user is ready to release accumulated dev work to production, follow this workflow.

## Workflow

### 1. Verify clean working tree

```bash
git status
```

If there are uncommitted changes, warn the user and stop. They should commit or stash first.

### 2. Determine version number (before merging)

Read `CHANGELOG.md` and collect all unreleased bullet entries (those between the intro paragraph and the first `## [X.Y.Z]` header). Also read the latest version from the first `## [X.Y.Z]` header.

Check commits on dev that are not yet on main:

```bash
git log main..dev --oneline
```

Version bump rules:
- Has any `feat:` commit → **minor** bump (e.g. 1.1.2 → 1.2.0)
- Only `fix:` / `refactor:` / `chore:` / `docs:` commits → **patch** bump (e.g. 1.1.2 → 1.1.3)
- Has breaking changes (commit message contains `BREAKING CHANGE` or `!:`) → **major** bump (e.g. 1.1.2 → 2.0.0)

### 3. Confirm with user

Present to the user:
- The proposed version number
- The list of changelog entries that will be grouped under this version

Use AskQuestion if available. Wait for confirmation. If the user wants a different version, use their choice.

### 4. Switch to main and merge dev

```bash
git checkout main
git merge dev
```

Do NOT push yet.

If merge conflicts occur, help the user resolve them before continuing.

### 5. Update CHANGELOG.md

Wrap the unreleased bullets under a new version header. Before:

```markdown
# 更新日記

本檔案記錄 Smart Finance Tracker 的版本更新內容。

- 新增匯出 CSV 功能
- 優化篩選器效能

## [1.1.2] - Feb-24 2026
...
```

After:

```markdown
# 更新日記

本檔案記錄 Smart Finance Tracker 的版本更新內容。

## [1.2.0] - Feb-25 2026
- 新增匯出 CSV 功能
- 優化篩選器效能

## [1.1.2] - Feb-24 2026
...
```

Date format: `Mon-DD YYYY` using today's date (3-letter English month, hyphen, 2-digit day, space, 4-digit year).

### 6. Commit and push to main

```bash
git add CHANGELOG.md
git commit -m "docs: release vX.Y.Z changelog"
git push origin main
```

### 7. Sync main back to dev

```bash
git checkout dev
git merge main
git push origin dev
```

This keeps dev in sync with the new version header in CHANGELOG.md, so the next dev cycle starts clean.

## Changelog format reference

- File: `CHANGELOG.md` at project root
- Language: Traditional Chinese (English where natural)
- Version header: `## [major.minor.patch] - Mon-DD YYYY`
- Date format: 3-letter English month, hyphen, 2-digit day, space, 4-digit year (e.g. `Feb-25 2026`)
- Order: newest version at top (reverse chronological)
- Semver: patch for fixes, minor for features, major for breaking changes
