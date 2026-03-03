---
name: commit-and-push-dev
description: Commit code changes and push to dev branch, with automatic CHANGELOG.md update. Use when the user finishes a feature, fix, or optimization and wants to commit, or mentions committing to dev, pushing to dev, or updating the changelog.
---

# Commit and Push to Dev

When the user is ready to commit their work, follow this workflow.

## Workflow

### 1. Ensure on dev branch

```bash
git branch --show-current
```

If not on `dev`, switch: `git checkout dev`

### 2. Analyze changes

Run in parallel:

```bash
git diff
git status
git log --oneline -15
```

### 3. Check .gitignore

Review new/modified files for anything that should be in `.gitignore` (secrets, `.env`, build artifacts, IDE configs, `node_modules`, etc.). If there are concerns, ask the user before proceeding.

### 4. Generate commit message and changelog entry

**Commit message** (English, conventional commits):
- Format: `type(scope): short description` + body with `- ` bullet points
- Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `perf`, `test`
- Match the style from `git log`
- Body lines MUST start with `- ` (dash + space)
- Example:

```
feat: add export CSV functionality

- Add CSV export button to transaction history page
- Support filtering exported data by date range and category
```

**Changelog entry** (Traditional Chinese):
- One bullet starting with action verb: 新增、修正、優化、移除
- Concise, one logical change per bullet
- Example: `- 新增匯出 CSV 功能`
- **Skip changelog** if the change is developer-only (e.g. testing, CI/CD, refactoring, dev tooling) and not user-facing

### 5. Present for confirmation

Show both the commit message and changelog entry to the user. Wait for approval before proceeding. If the user wants changes, revise accordingly.

### 6. Update CHANGELOG.md

Insert the new bullet in the **unreleased section** — between the intro paragraph and the first `## [X.Y.Z]` header:

```markdown
# 更新日記

本檔案記錄 Smart Finance Tracker 的版本更新內容。

- (existing unreleased entries, if any)
- YOUR NEW ENTRY HERE

## [1.1.2] - Feb-24 2026
...
```

Keep existing unreleased entries intact; append the new one below them.

### 7. Stage, commit, push

```bash
git add .
git commit -m "commit message here"
git push origin dev
```

## Changelog format reference

- File: `CHANGELOG.md` at project root
- Language: Traditional Chinese (English where natural)
- Unreleased items: bare bullets above first version header, no `## Unreleased` heading
- Version header format: `## [major.minor.patch] - Mon-DD YYYY`
- Date format: 3-letter English month, hyphen, 2-digit day, space, 4-digit year (e.g. `Feb-25 2026`)
- Entry style: start with 新增 / 修正 / 優化 / 移除
