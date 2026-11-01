---
name: rebase-on-upstream
description: Rebase Unbroken Code on the latest released upstream VS Code, including restructuring our commits, the Electron fork, extension forks, the xterm.js fork, product.json and the final version bump. Use only when the user asks to rebase or update Unbroken Code on upstream.
disable-model-invocation: true
---

# Rebase Unbroken Code on upstream

Unbroken Code is a stack of feature commits on top of an upstream release tag. A rebase restructures that stack, replays it on the newest release, then brings every fork and dependency along.

The phases run in order, except the Electron build, which runs in the background alongside everything from Phase 3 on.

## Rules for the whole run

- **Rename a commit only together with `[no release notes]`.** `build/release/create-github-release.ts` compares subjects with the previous release after a rebase, so a renamed commit shows up as new in the release notes, unless its body has that tag. Rename when a fold makes a subject wrong, and otherwise leave subjects alone. Fold with `fixup`, never `squash`.
- **Folding removes a subject from the notes.** Notes come only from subjects that still exist, so a change folded before it was released is never announced. See the release check in Phase 0.
- **New commits that users shouldn't read about** get `[no release notes]` in the message body, like the earlier `Update electron` commit.
- **Ask for approval with the question tool (`AskUserQuestion`) at each marked gate and before starting each phase, except Phase 5.** A question in plain text gets lost among the progress messages. Force-pushes and resetting `main` are hard to undo. Inside an approved phase, make the decisions and record them.
- **Each Bash call is a new shell.** `nvm use` doesn't carry over, so start Node commands with `. "$NVM_DIR/nvm.sh" && nvm use`.
- **Keep run state in `.git/unbroken-rebase/`** (`git rev-parse --git-dir`). It survives branch switches and resets, and isn't tracked. Store the target tag, the old base, the folding plan, and a log of conflicts and judgment calls. Phase 4 tests from that log.
- **This skill is removed from disk when `main` is reset**, if it's committed, and comes back with its cherry-pick. Hold refinements until then, or edit the copy on the preparation branch, and fold them into the skill's own commit.

## Lockfile integrity step

The local xterm packages must have no integrity entries in `package-lock.json`, since every machine builds its own. Run this after anything that runs `npm install`, including `--new-version`. It filters on `resolved`, because registry packages nested under `@xterm/*` must keep theirs:

```bash
node -e "
const fs = require('fs'), file = 'package-lock.json', lock = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const entry of Object.values(lock.packages)) {
	if (entry.resolved?.startsWith('file:packages/xterm.js/')) { delete entry.integrity; }
}
fs.writeFileSync(file, JSON.stringify(lock, null, 2) + '\n');
"
```

## Phase 0: Preflight

1. Ask the user to stop watch tasks, and confirm no build is running in this checkout. Resets and cherry-picks would otherwise trigger constant recompiles or break the build.
2. Require a clean tree (an uncommitted copy of this skill is the only exception) and local `main` equal to `origin/main`. Unpushed commits on `main` would be lost in Phase 2, so stop and ask if there are any.
3. Fetch:

   ```bash
   git fetch origin
   git fetch upstream --tags
   ```

4. Find the old base. Filter by tag shape, because `git describe` and plain tag sorting return `release/*`, `translation/*` or `v14`:

   ```bash
   base=$(git tag --merged origin/main --list '[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -1)
   ```

5. Find the target. The update service is the authority on what is released, and a tag can exist before it ships:

   ```bash
   curl -s https://update.code.visualstudio.com/api/update/darwin-arm64/stable/latest
   ```

   `productVersion` is the target tag and `version` is its commit. Check that `git rev-parse "<tag>^{commit}"` gives the same commit.

6. **Gate: unreleased work.** Run `gh release list -R Unbroken/UnbrokenCode -L 3` and `git rev-list --count <latest non-draft release tag>..origin/main`. If commits are unreleased or a draft release is waiting, run `./build-unbroken-code.sh --show-release-notes`, which builds nothing and compares `HEAD` with the last published release. Show the user the notes, and any commits in that range they leave out, other than `Bump version`. Tell the user that folding these commits drops them from the release notes, and ask whether to publish first. Fixes that release needs go on `main` as usual and are folded in Phase 1 like any other change. If `origin/main` moves after the preparation branch exists, add the new commits to the plan.

## Phase 1: Preparation branch

The preparation branch restructures the history without changing the resulting code.

1. Create it, named after the target (upstream `1.144.0` gives `update-144.0`):

   ```bash
   git switch -c update-<minor>.<patch> origin/main
   ```

2. List the stack. Always scope the search to `$base..`, because upstream's history also contains commits with the exact subject `Bump version`:

   ```bash
   git log --reverse --format='%h %s' "$base..origin/main"
   git log --reverse --format='%h' --grep='^Bump version$' "$base..origin/main"
   ```

   The oldest `Bump version` marks where the last rebase ended. Commits before it are the coherent feature stack. Commits after it are what changed since.

3. Classify every commit after the oldest bump as one of:
   - **Fold** into the feature it fixes or extends. Name the target commit.
   - **Stand alone** as a new feature. Keep its subject as is.
   - **Bump** to squash.

   Use one commit per feature. Read the diffs, not just the subjects: a subject starting with "Fix" may fix upstream behavior and stand alone, and one starting with "Add" may extend an existing feature. `Update <name> extension (...)` commits fold into the commit that owns the gitlink, which `git log "$base..<oldest bump>" -- <submodule path>` identifies. Today that is `Implement build system and versioning scheme` for the extensions and `Use fork of xterm.js that supports display-p3 color space` for xterm.js.

4. Record each commit's decision and target, and whether it is unreleased, in the run state. The push gate in Phase 7 shows this as a table.

5. Apply the plan with a written todo, so nothing needs an interactive editor:

   ```bash
   GIT_SEQUENCE_EDITOR="cp .git/unbroken-rebase/todo" git rebase -i "$base"
   ```

   The todo keeps the feature stack in order and places each `fixup` right after its target, oldest first. New stand-alone commits follow the existing features. The oldest bump goes last as `pick`, with the later bumps as `fixup` after it. This gives one `Bump version` at the tip, keeping the oldest bump's message and author date.

6. Verify. This must print nothing, since only the history changed:

   ```bash
   git diff origin/main HEAD
   ```

   If it prints anything, a conflict was resolved wrongly. Fix it before continuing.

## Phase 2: Replay on the target

**Gate:** confirm before resetting `main`. `origin/main` and the preparation branch both keep the old state until the final push.

```bash
git switch main
git reset --hard <tag>
```

Install the target's Node before replaying, because `npm install` refuses to run on a version below `.nvmrc`. If `nvm current` differs from `.nvmrc`:

```bash
. "$NVM_DIR/nvm.sh" && nvm install "$(cat .nvmrc)" && nvm use && nvm alias default "$(cat .nvmrc)"
```

Install upstream's dependencies too. The pre-commit hook runs on every `cherry-pick --continue`, and it fails on a missing module while `node_modules` is from the old base. Keep the hook on: it catches real mistakes during the replay.

```bash
. "$NVM_DIR/nvm.sh" && nvm use && npm ci
```

Then replay:

```bash
git cherry-pick "$base..update-<minor>.<patch>"
```

Finish each conflict with `GIT_EDITOR=true git cherry-pick --continue`, which keeps the original message.

Resolving conflicts:

- Keep the feature's intent and adapt it to upstream's refactoring. Read the upstream change that caused the conflict, and never take one side wholesale to get past it. The two exceptions are the lockfile and the `Bump version` commit below.
- **Compare against the commit's own diff, not just the conflict.** The incoming side also carries old upstream code, so `git show CHERRY_PICK_HEAD -- <file>` is what shows our intent. Read every hunk in a file, and don't trust a truncated preview of a long line: a change at the end of a line is easy to lose.
- **Moved files:** when upstream moved code, `src/main.ts` to `src/mainImpl.ts` for example, take upstream's version of the old file and apply our change at the new location.
- **Generated files:** renumber `EditorOption` in `standaloneEnums.ts` and `monaco.d.ts` from `editorOptions.ts` instead of merging it. After a change to the inline script in `webview/browser/pre/index.html`, recompute the CSP hash: the base64 SHA-256 of the script's contents. Check your method reproduces the hash in upstream's version first.
- **`Remove previous workflows`:** also delete any workflows upstream has added since. Builds run on GitHub Actions, and these would run on our repository.
- **`package-lock.json` conflict in a feature commit:** resolve `package.json` first, then take the current contents and regenerate the lock for that commit. `HEAD` holds upstream's lock plus what has been replayed so far. Before the xterm fork is rebased, `npm install` uses the existing `packages/xterm.js/packages/*.tgz` builds, which is fine.

  ```bash
  git checkout HEAD -- package-lock.json
  . "$NVM_DIR/nvm.sh" && nvm use && npm install
  # then the lockfile integrity step
  git add package-lock.json
  ```

- **`Bump version` commit:** this always conflicts. Keep only `unbroken.version`, which carries our patch number, and take the current contents of the other four files. Phase 6 writes the real version into them.

  ```bash
  git checkout HEAD -- package.json package-lock.json extensions/copilot/package.json extensions/copilot/package-lock.json
  git add unbroken.version
  ```

- **`package.json` xterm entries:** keep our `file:packages/xterm.js/packages/*.tgz` values. If upstream added an `@xterm/*` dependency, add a matching `file:` entry. `remote/package.json` and `remote/web/package.json` stay on upstream's registry versions.
- **A commit that becomes empty** usually means upstream fixed the same thing. Confirm that, then `git cherry-pick --skip` and log it for the final report.
- **`extensions/codelldb/package-lock.json`** gets dirtied by `npm install`, which writes `@VERSION@` into it. Restore it with `git -C extensions/codelldb checkout -- package-lock.json`.
- Log every non-trivial resolution in the run log.

Then compare the result, and account for every dropped or heavily changed commit:

```bash
git range-diff --creation-factor=95 "$base..update-<minor>.<patch>" "<tag>..main" | tee .git/unbroken-rebase/range-diff.txt
```

## Phase 3: Post-rebase

Commit each change as `git commit --fixup=<target>`, or as a new commit where noted. Step 6 folds them.

### 1. Electron (background)

Read upstream's version from `target=` in `.npmrc`. Choose the newest stable Electron release with the same major version, not upstream's exact version:

```bash
curl -s https://releases.electronjs.org/releases.json | node -p "JSON.parse(require('fs').readFileSync(0)).find(release => release.version.startsWith('<major>.') && !release.version.includes('-')).version"
```

Within a major version, the Chromium major and the native module ABI stay the same, so this picks up fixes without breaking native modules. If `Unbroken/electron` already has that tag with both zips (`gh release list -R Unbroken/electron -L 5`), skip to the Unbroken Code changes below.

Start a background agent for the fork work, and carry on with step 2. Give it the steps below and the `remote-validation` skill.

On `erik@erikwindev03`, in `/c/Source/electron`. The user designates this checkout and `/c/CompiledFiles/electron_build` for this workflow. Run Git network commands, `gh` and the build through the desktop helper, because SSH sessions have no credential access:

```bash
ssh erik@erikwindev03 "/c/Deploy/AgentConfig/DesktopHelper.exe --run --working-directory 'C:\\Source\\electron' -- 'C:\\Program Files\\Git\\bin\\bash.exe' -c '<command>'"
```

The upstream remote in that checkout is named `uptream`. For `gh`, start the command with `export PATH="/c/Program Files/GitHub CLI:$PATH"`. The build needs Python's output set to UTF-8, or applying upstream's patches can crash.

1. Fork tags reuse upstream's names with different contents, so fetch upstream's tags into their own namespace. A plain `git fetch --tags` would collide:

   ```bash
   git fetch --no-tags <upstream remote> refs/tags/v<old>:refs/upstream-tags/v<old> refs/tags/v<new>:refs/upstream-tags/v<new>
   ```

2. Branch from `refs/upstream-tags/v<new>` and cherry-pick the fork commits, `refs/upstream-tags/v<old>..v<old>`. They are the two Chromium patches plus `Delete old github actions` and `Build script`.
3. Resolve conflicts:
   - For the `.github` deletion, delete everything that commit's purpose covers, including anything upstream added since. Keep `.github/workflows/package.json`, since `package.json` lists that folder as a yarn workspace.
   - Keep `patches/chromium/.patches` listing our patches, and check it even without a conflict: a clean merge can carry over an entry from the old version whose patch file doesn't exist here. Diffed against upstream, it must show only our lines.
   - A patch that no longer applies shows up as a `git am` failure in `gclient sync`. Fix the patch file, then amend the tag before anything is released.
4. Tag `v<new>` on the result and push only the tag. The fork's `main` stays where it is, since it has diverged from the release tags and the build doesn't need it. `script/build.sh` builds whichever tag is at `HEAD`.
5. Build, keeping the log. Run this as a background command, and allow for several hours:

   ```bash
   set -o pipefail; PYTHONIOENCODING=utf-8 script/build.sh 2>&1 | tee /c/CompiledFiles/electron-v<new>.log
   ```

   It builds x64 and arm64, then uploads the GitHub release.
6. Verify the upload with `gh release view v<new> -R Unbroken/electron --json assets`. Both `electron-win32-x64.zip` and `electron-win32-arm64.zip` must be listed.

Unbroken Code changes, only if the chosen version differs from upstream's. Make a new commit with the subject `Update electron` and `[no release notes]` in the body, placed before `Bump version`:

- `.npmrc`: `target=`. Leave `ms_build_id` alone.
- `package.json`: `electron`, if it's listed there. It isn't in 1.144.0.
- `build/checksums/electron.txt`: the same file set at the new version, with hashes from the release's `SHASUMS256.txt`.
- `cgmanifest.json`: version, tag, and the tag's commit hash.
- `package-lock.json`: regenerated, if `package.json` changed.

Only Windows downloads the fork, through `v${target}` in `getCustomElectronConfig`. macOS and Linux use the official release of the same version, so local testing doesn't have to wait for the build. A Windows release does.

### 2. Extension forks

Forks live in `extensions/vscode-clangd` (upstream `clangd/vscode-clangd`) and `extensions/codelldb` (upstream `vadimcn/codelldb`). For each:

```bash
git -C <path> fetch origin && git -C <path> fetch upstream --tags
gh api repos/<upstream>/releases/latest --jq .tag_name
old=$(git -C <path> merge-base origin/master upstream/master)
git -C <path> merge-base --is-ancestor <latest tag> "$old"   # success means already based on it
```

If there is a newer release:

```bash
git -C <path> branch backup/pre-<tag>-rebase origin/master
git -C <path> switch -C rebase-<tag> origin/master
git -C <path> rebase --onto <tag> "$old"
```

Then review `$old..<tag>` against the files our commits touch, looking for anything that interferes with our features even when it merged cleanly. Also check that the extension still builds with the target's VS Code APIs, including every path `build-unbroken-code.sh` builds it through.

`extensions/malterlib` is first-party with no upstream. Check that it is at `origin/master` and review it against upstream API changes. If it needs an update, that's a commit in its own repository.

Move the gitlink with a fixup into its owning commit.

### 3. xterm.js fork

1. Find the commit upstream uses. Get the exact version from the tag's lockfile, then read `gitHead` from npm:

   ```bash
   version=$(git show <tag>:package-lock.json | node -p "JSON.parse(require('fs').readFileSync(0)).packages['node_modules/@xterm/xterm'].version")
   (cd /tmp && npm view "@xterm/xterm@$version" gitHead)
   ```

2. Rebase, in `packages/xterm.js`:

   ```bash
   git fetch origin && git fetch upstream
   old=$(git merge-base origin/master upstream/master)
   git branch backup/pre-vscode-beta-<n>-rebase origin/master
   git switch -C rebase-vscode-beta-<n> origin/master
   git rebase --onto <commit> "$old"
   ```

   If the tip `Update package lock` conflicts, take upstream's lock, run `npm install` and amend it.

3. **Look for regressions the rebase can't show.** For each of our commits, read what upstream added in `$old..<commit>` and ask whether new code needs the same treatment. Examples: a new draw path that bypasses our display-p3 handling, new glyph handling that ignores the hinting or sub-pixel options, new cell measurement that assumes integer device scales, or a new hot path in line output. Patch those in the matching commit. Log what you checked.
4. Test fixes in the fork. Playwright serves `demo/dist/client-bundle.js`, so rebuild it or the tests run old code:

   ```bash
   npx tsgo -b ./tsconfig.all.json
   npm run esbuild && npm run esbuild-demo-client
   npx playwright test -c addons/addon-webgl/test/playwright.config.ts --project=Chromium
   npm run test-unit
   ```

5. Rebuild from the repo root with `./setup.sh`.
6. Run the lockfile integrity step.

### 4. Dependencies

```bash
. "$NVM_DIR/nvm.sh" && nvm use && npm ci
```

Then build the extensions the dev instance runs. `compile-extensions` only writes to `out/`, while the Malterlib and clangd extensions run from an esbuild bundle that only this task or `watch-extension-media` updates. A stale bundle fails silently, by missing features:

```bash
npm run gulp compile-extensions && npm run gulp compile-extension-media
```

If `npm ci` reports that the lockfile is out of sync, run `npm install`, repeat the integrity step, and run `npm ci` again.

### 5. product.json

Check `version` in `/Applications/Visual Studio Code.app/Contents/Resources/app/package.json`, and `commit` in `product.json` next to it, against the target. If they don't match, ask the user to upgrade VS Code and wait.

Compare that `product.json` with ours, key by key, including nested keys. Our file carries many values copied from Microsoft's, so:

- **Keys we already carry from Microsoft's file:** take the update.
- **New keys:** add them if a feature needs them to work.
- **Branding, identity, update, telemetry and gallery values:** keep ours (for example `nameLong`, `win32*AppId`, `updateUrl`, `electronRepository`, open-vsx).

Log any key you chose to skip, and why.

### 6. Fold

```bash
git branch backup/pre-fold-<topic>
GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <tag>
```

Find a target with `git log --format='%h %s' <tag>..HEAD -- <path>`. Typical targets are the gitlink owners from Phase 1 and `Update product.json for Unbroken Code`. Nothing should remain with a `fixup!` subject, and `git log <tag>..HEAD` should have the same subjects as before, plus `Update electron` if needed.

## Phase 4: Testing

Start with the features whose conflicts were hardest, using the run log.

1. Type check and lint, which are justified here because the change is as broad as it gets:

   ```bash
   . "$NVM_DIR/nvm.sh" && nvm use
   npm run typecheck-client
   npm run gulp compile-extensions
   npm run hygiene
   npm run valid-layers-check
   ```

   Also run `npm run typecheck` in `build/`, since our stack changes the build scripts. The first type check after a replay finds what the merges couldn't: upstream's changed signatures and data structures meeting our code.

2. Unit tests: `npm run build-fast -- --client-only`, then `scripts/test.sh --grep <pattern>` for the areas with conflicts. Then run all of `scripts/test.sh` once, in about 7 minutes.
3. Triage full-suite failures against a baseline. Don't assume a failure is expected. Our stack fails upstream tests by design, so compare first:
   - Check out the target in a temporary worktree in the scratchpad, run `npm ci` and `build-fast`, and run the failing suites there. Anything that fails there too isn't ours.
   - To find the commit behind a group, check out stack commits in that worktree and rerun the group.
   - Fix real bugs in the commit that owns the code, and fix tests that conflict with one of our features.
   - Remove the worktree afterwards.

   The stack carries its changes to tests, so the suite must end up clean: no failing tests. Upstream adds and changes tests every release, and new failures usually come from these features:
   - Exact layout assertions, such as insets and sizes: `Waste less space in UI`.
   - Editor tabs and other layout that assumes the upstream defaults: `Update defaults to give a more minimal layout and ux`.
   - Filter and search results: partial matching from `Add better fuzzy search algorithm` returns more results. That's intended, and the best match must come first, so assert the first result, or use terms that can't match partially.
   - `PromptInputModel`: `Fix pathological performance when outputting a lot of lines in terminal` debounces syncing, and the tests pass a debounce of 0.

   Don't dismiss a failure that passes alone as flaky. Look for what the full run changes: `AHP windowed TCP` overflowed the listen backlog of 128 on macOS, which resets further connections, and only in a full run.
4. Package once for real, because neither the unit tests nor a launch from source run the packaging. Upstream's CI downloads Copilot as a VSIX, for example, so nothing upstream tests that our build compiles it from source. This takes about 5 minutes on this Mac:

   ```bash
   . "$NVM_DIR/nvm.sh" && nvm use && VSCODE_BUILD_OUTPUT_DIR=<scratchpad>/package npm_config_arch=arm64 NPM_ARCH=arm64 VSCODE_ARCH=arm64 npm run gulp vscode-darwin-arm64
   ```

   Never launch a packaged build without `VSCODE_PORTABLE`, not even with `--version`. The binary starts the full app on the user's real profile, and with `--use-mock-keychain` that destroyed stored sign-ins. Use a short path such as `mktemp -d /tmp/ucbuild-XXXXXX`, because the instance socket path can't exceed 103 characters, and add a kill timer. This doesn't cover the Linux and Windows jobs, so check what they need against upstream's pipelines in `build/azure-pipelines`.

   Check that running the app doesn't change its own files, which breaks the code signature on macOS: compare the files in the bundle before and after a run, and after CI has built the draft release, run `codesign --verify --deep --strict` on its macOS app before and after a run.

   Upstream builds with its own Electron from a private feed, so don't assume that upstream's features work on stock Electron. `shouldGenerateNodeCompileCache` in `build/lib/nodeCompileCache.ts` always returns false for this reason. The cache needs the Node.js commits `65f518c72a` (read-only mode) and `adad4d650d` (portable caches not split by uid), and stock Electron's Node 24.22.1 has neither. Keep it off in conflicts, and turn it on again only once `node_version` in Electron's `DEPS` has both. A check that fails on a platform we don't share with upstream's build is information, so find out why before loosening it.
5. Launch from source with the `launch` skill. Run `@playwright/cli` from outside the repo, because the repo's `.npmrc` breaks `attach`. Unbroken Code Setup opens first and takes the keyboard, so finish it, which also tests it. The Running Extensions view is a modal, so close it before typing elsewhere. Exercise at least the terminal (xterm fork, rendering, bells), the Malterlib, clangd and codelldb extensions, and Unbroken Code Setup. Malterlib and clangd only activate on a C or C++ file. A command line at the top of the terminal after `clear` is the sticky scroll header, not a rendering bug.
6. Check the `code` compatibility tool: `bin_compat/code --version` must work, because no automated test covers it and Claude Code installs its extension through it. In a terminal of the launched window, `which -a code` must list `bin_compat` first, also with `terminal.integrated.shellIntegration.enabled` set to `false`.
7. Report results, then ask the user to do their own pass.

## Phase 5: Codex review

Get a second opinion before the version bump, with a reviewer that hasn't seen the decisions. This phase runs without asking for approval.

Review the replayed stack with a prompt rather than `--base`. The two can't be combined, and the full diff against upstream is too large to review well. Write this to `.git/unbroken-rebase/codex-review-prompt.md`, filling in the values:

```text
Unbroken Code is a stack of feature commits on upstream VS Code. It was just rebased from <old base> to <tag>, and you are reviewing that rebase for regressions.

The old stack is <old base>..update-<minor>.<patch>, and the new stack is <tag>..main. Read these first:
- .git/unbroken-rebase/range-diff.txt: what changed in each commit. `=` lines are identical, and `!` lines changed.
- .git/unbroken-rebase/state.md: conflicts, decisions and dropped commits.

For each commit marked `!`, use `git show` and upstream's own changes to check:
1. Did the commit keep its full intent, or was part of it lost in a conflict?
2. Does our code still fit what upstream changed around it, including APIs, data structures and code that moved?
3. Is each dropped commit really fixed upstream, in every case our commit handled?
4. Does new upstream code need the same treatment as one of our features, even though nothing conflicted?

Report only concrete defects, each with the commit, `path:line`, the failure it causes, and how sure you are. Don't report style, or behavior that already differs on purpose from upstream. Don't change any files.
```

Run it in the background, keeping the output:

```bash
command codex --yolo review - < .git/unbroken-rebase/codex-review-prompt.md 2>&1 | tee .git/unbroken-rebase/codex-review.txt
```

For each fork rebased in this run, review our commits against the new upstream base:

```bash
(cd <path> && command codex --yolo review --base <new upstream base> 2>&1) | tee .git/unbroken-rebase/codex-review-<fork>.txt
```

Check each finding against the code yourself, since a review can be wrong. Fix the real ones with `git commit --fixup=<matching commit>` and fold them, then rerun the tests they affect. Record rejected findings with the reason, and add them to the state file so the next round doesn't report them again. The push gate in Phase 7 shows both.

Repeat the review until a round finds nothing new to fix. Regenerate `range-diff.txt` before each round, so Codex sees the fixes.

## Phase 6: Version bump

```bash
. "$NVM_DIR/nvm.sh" && nvm use && ./build-unbroken-code.sh --new-version
```

It increments `unbroken.version`, combines that with major.minor from upstream's `package.json`, updates `package.json` and Copilot's `engines.vscode`, and runs `npm install`. It doesn't commit.

1. Run the lockfile integrity step, and revert `extensions/codelldb/package-lock.json` in that submodule, since `npm install` rewrites its version to the `@VERSION@` placeholder.
2. Check that `Bump version` is the tip, then fold everything into it, so `main` ends with one bump. Amending keeps the exact subject, which the release notes skip and the next rebase searches for, so ignore the "Version bump to" commit command the script prints. That command also omits the Copilot lockfile.

   ```bash
   git add package.json package-lock.json unbroken.version extensions/copilot/package.json extensions/copilot/package-lock.json
   git commit --amend --no-edit
   ```

3. Check the release notes with `./build-unbroken-code.sh --show-release-notes`. The first entry should be `Rebased on upstream`, followed only by subjects that are new since the last published release. Any other entry is a problem to fix before pushing: usually a commit renamed without the tag, or an upstream commit that wasn't filtered out. Commits that shouldn't be listed, such as `Update electron`, need `[no release notes]` in the body.

## Phase 7: Push

**Gate:** show the folding decisions as a table, the final stack, the release notes, the Codex findings and what happened to each, and the pending pushes. Push only after the user approves.

For each fork that was rebased, first keep the old tip reachable. Older releases of Unbroken Code reference it through their gitlinks, so existing `preserve-<sha>` tags do this:

```bash
old=$(git -C <path> rev-parse origin/master)
git -C <path> tag "preserve-$old" "$old"
git -C <path> push origin "preserve-$old"
git -C <path> push --force-with-lease origin HEAD:master
```

Push forks before `main`, so its gitlinks resolve. `main` itself needs no preserve tag, because its `release/*` tags keep released commits reachable:

```bash
git push --force-with-lease origin main
```

Finish by reporting the target version, any dropped commits, skipped `product.json` keys, the regression review, the state of the Electron build, and what remains for the user. Building and publishing a release isn't part of this skill.

## Unverified, confirm on the next run

- Whether the testing list in Phase 4 covers what matters to the user. On the first run they skipped their own pass before the version bump.
