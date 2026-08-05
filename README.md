# dodoestar-skills

Skills for [Claude Code](https://claude.com/claude-code).

Each folder under `skills/` is one skill. Copy the ones you want; they are
independent.

## Install

```bash
git clone https://github.com/donut20418/dodoestar-skills.git
cp -r dodoestar-skills/skills/deep-review ~/.claude/skills/
```

PowerShell:

```powershell
git clone https://github.com/donut20418/dodoestar-skills.git
Copy-Item -Recurse .\dodoestar-skills\skills\deep-review "$env:USERPROFILE\.claude\skills\"
```

Then `/deep-review` is available in any session.

## Skills

| skill | what it does |
|---|---|
| [`deep-review`](skills/deep-review) | multi-agent code review: cheap finders fan out, plain code dedups, expensive verifiers run a real probe and rule |

---

# deep-review

Cheap agents fan out over review dimensions and propose defects. Plain code
dedups them by location. A few expensive agents then *run an actual probe* for
each distinct cause and rule on it. You get the report; nothing is synthesised by
an agent.

Nothing to configure. The agent personas and model tiers live inside
`review.js`, so it does not depend on anything in `~/.claude/agents/`.

## Use

```
/deep-review pixelpaint/persistence/autosave.py and its controller
```

Name the target. Claude reads the code and the project's own notes to build the
brief itself.

To keep a run small, ask for fewer dimensions - there are six: `integrity`,
`seams`, `realstate`, `lifecycle`, `ux`, `tests`.

## Why it is shaped this way

It was built by taking a review that cost 4.4M tokens and asking where the money
went. Every rule in `SKILL.md` is a correction to something that actually went
wrong in that run:

- **Slice by dimension, not by file.** The file-sliced reviewers found nothing.
  The one told to look at "the seams" found a crash; the one told to check
  behaviour "on real data" found a 720 MB regression.
- **Count agents before tuning model tiers.** Measured: two agents replying with
  a single word cost 63k tokens, so ~31k of every agent is spent before it does
  any work. Halving the agent count beats any effort tweak.
- **Dedup by location, in plain code.** One bug arrived three times under three
  titles and was proved three separate times by three expensive agents.
- **Grouping is not discarding.** Two different bugs can share a line, so the
  whole group goes to one verifier and it rules on each.
- **Never let "nobody checked this" read as "this is fine."** Capped, unresolved
  and unverified findings are three separate buckets in the output.

## The rule that finds the real bugs

**Judge the code in the state it really runs in.**

The worst defect this shape ever found was invisible to five careful reading
passes *and* to a purpose-built benchmark - because the benchmark constructed a
project with no mesh loaded, and the bug was that the mesh was being copied into
every undo snapshot. The test written to guard that exact class of bug had the
same hole.

So before any measurement or any claim about cost: build the state the feature
actually meets. This is in the context every agent receives, and it is the line
most likely to earn a run back.

## Cost

Simulated against the 37 real findings it was built from:

```
37 findings -> 21 locations -> 18 serious -> 12 verifier agents   (was 29)
total: 6 finders + 12 verifiers = 18 agents                       (was 38)
```

Not yet measured on a live run. If you use it, the numbers in `SKILL.md` are the
ones to check first.

`/scrutinize` is the cheap sibling - one careful pass, no agents. Use that for a
single diff or a quick second opinion, and this when the surface is bigger than
one pass.
