# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in `darrengruber/neolesk`. Use the `gh` CLI for all operations.

## Credentials: every `gh` command goes through Alicit

Do not run a bare `gh` command, and do not export a GitHub token. Wrap each call:

- **Issue and label work** (`gh issue ...`, `gh label ...`, and `gh api` under `repos/darrengruber/neolesk/issues` or `/labels`): use the repository-exact shortcut. The justification must name the repository.

  ```sh
  alicit github --justification "Read the issue backlog in darrengruber/neolesk for grooming" \
    -- issue list --repo darrengruber/neolesk --state all
  ```

- **Any other `gh` call** (pull requests, Actions runs and jobs): name the Profile yourself.

  ```sh
  alicit run --profile github-operator-all --ttl github-operator-all=5m \
    --justification "Read the jobs of CI run <id> in darrengruber/neolesk" \
    -- gh api repos/darrengruber/neolesk/actions/runs/<id>/jobs --method GET
  ```

- Always pass `--repo darrengruber/neolesk` (or a `repos/darrengruber/neolesk/...` endpoint). Alicit refuses a command with no explicit target.
- Start one `alicit ... -- gh ...` per call. A `gh` inside `sh -c` gets no credential and prints nothing.
- The App token has no `checks` permission, so `gh pr checks` fails. Read CI with `gh run list` and `gh run view <id> --json jobs`.

The commands below show only the `gh` part. Wrap each one as above.

## Conventions

- **Create an issue**: `gh issue create --repo darrengruber/neolesk --title "..." --body-file <file>`. Write multi-line bodies to a file first.
- **Read an issue**: `gh issue view <number> --repo darrengruber/neolesk --comments`, also fetching labels.
- **List issues**: `gh issue list --repo darrengruber/neolesk --state open --json number,title,body,labels,comments` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --repo darrengruber/neolesk --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --repo darrengruber/neolesk --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --repo darrengruber/neolesk --comment "..."`

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --repo darrengruber/neolesk --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/darrengruber/neolesk/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/darrengruber/neolesk/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
