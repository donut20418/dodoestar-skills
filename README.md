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
`seams`, `realstate`, `lifecycle`, `ux`, `tests`. Drop the ones that do not
apply (`ux` for a library, `realstate` for pure logic) rather than paying for
them.

Before any of that, Claude asks the intent question itself - is there a simpler,
smaller, or different-layer design that achieves the same thing? If the honest
answer is "this should be reworked", it says so *instead* of running the fan-out.
A review spent polishing the wrong design is the most expensive no-op there is.

## What comes back

Eight parts, and they are deliberately not interchangeable:

| | |
|---|---|
| `confirmed` | a verifier tried to kill it and failed - with the command it ran and the output |
| `refuted` | a verifier killed it |
| `unprovable` | a verifier answered, and the answer is that no probe it could run would settle this |
| `unresolved` | sent to a verifier, never ruled on |
| `serious_but_over_cap` | blocker/major the cap never reached |
| `minor` | minor/nit, never sent for verification |
| `suspect` | schema-valid but empty of content, quarantined before clustering |
| `coverage` | per dimension: what it says it read, plus findings/suspect counts |

Five of those eight are "nobody checked this". They stay separate on purpose -
folding a capped blocker in with the nits is worse than not running the review.
Every finding also carries a `consequence`: the harm to the person using the
software, not the principle violated.

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
- **Never let "nobody checked this" read as "this is fine."** Five separate
  buckets, and a dimension whose finder died says so in `coverage` instead of
  quietly not existing. A run that finds nothing reads exactly like clean code.
- **Match rulings by index, and check the indices as a set.** A verifier that
  answers 0-based files every ruling one claim early - a confirmed defect
  reported at another claim's file and line. Out-of-range voids the batch,
  loudly. Short arrays and duplicates keep their good rulings.
- **A probe must not eat the user's work.** "Build the state the feature really
  meets" is one sentence away from telling an agent with Bash to build it on top
  of whatever the person is doing. Fixtures go in a scratch directory or on a
  copy; nothing the agent did not create gets reset, dropped or overwritten, and
  a claim that could only be settled by mutating one of those comes back
  `unprovable` - which is a correct answer, not a failure.

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

Simulated against the 37 real findings it was built from - verifiers are batched
by claim count, same-file claims grouped first, then small files packed together
under one cap, because the floor is per agent and not per claim:

```
37 findings -> 21 locations -> 18 serious -> 12 file chunks -> 4 verifiers
total: 6 finders + 4 verifiers = 10 agents      (was 38; 18 when file-bound)
```

Measured on live runs since, three dimensions each:

```
autosave/save-skip   4 agents (3 finders + 1 verifier)   401k tokens
texture export       4 agents (3 finders + 1 verifier)   368k tokens
```

Both spent their verifier the way the shape intends. On the export run it built
a real 258k-triangle mesh, timed the click path, and came back with 605 ms
against 5 ms with the new call stubbed out - a UI freeze in a pipeline that had
already survived a twelve-defect review before it shipped. On the autosave run
it wrote a pytest plugin in a scratch directory that deleted one guard, ran the
suite against it, and proved 37 tests still passed - a test that could not fail.

`/scrutinize` is the cheap sibling - one careful pass, no agents. Use that for a
single diff or a quick second opinion, and this when the surface is bigger than
one pass.
