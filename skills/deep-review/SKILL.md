---
name: deep-review
description: >-
  Multi-agent code review that fans out cheap finders over review dimensions,
  dedups their findings by root cause in plain code, then spends expensive
  verifiers on running an actual probe for each distinct cause. Use for a
  feature or module about to ship, a large change, or when a review has to be
  exhaustive rather than quick - and when the user asks for a review "with
  agents", "full review", "deep review", or names this skill. For a single
  diff, a plan, or a fast second opinion, use /scrutinize instead: it is one
  pass, no agents, and far cheaper.
---

# Deep review

A review that fans out. `/scrutinize` is one careful pass by you; this is many
passes by many agents, and it costs real money - so the shape below exists to
spend it where it buys something.

## When NOT to use this

- A single diff, a plan, a design doc, a quick sanity check -> `/scrutinize`.
- Anything you could read in one sitting -> just read it.

Reach for this when the surface is bigger than one pass: a feature about to
ship, a module with many seams, a change that has already survived a review and
you suspect it anyway.

## Nothing to install

Two files, nothing else. `SKILL.md` and `review.js`. It does not use
`agentType`, so it depends on no agent definition in anybody's
`.claude/agents/` and behaves the same wherever it is copied - the personas and
the cost profile are both inside `review.js`, which is the only thing that runs.

The cost profile is three constants at the top of that file:

| role | model | effort | why |
|---|---|---|---|
| finder | `sonnet` | `low` | six of them, read-only, propose hypotheses |
| verifier | `opus` | `high` | few of them, run real probes, rule on claims |

**`high`, not `max`, and one tier rather than two.** There is no evidence `max`
does this job better: the run this was built from used `high` for all
twenty-nine verifiers, and they confirmed twenty-nine findings while refuting
none - which points at a prompt that never tried to kill anything, not at
insufficient reasoning. The persona in `review.js` is the fix for that. What
settles a verdict is RUNNING the probe, which is tool use, not thinking harder.
Raise it only with a measurement in hand.

That split is the design. Finders are cheap because they are not asked to prove
anything - every finding carries a `probe` field saying what would settle it,
and the verifier is the one that runs it.

**The dominant cost is the number of agents, not their tier.** Measured: two
agents replying with a single word cost 63k tokens, so roughly **31k of every
agent is spent before it does any work**. That is why verifiers are batched by
claim count - same-file claims grouped first, then small files packed together
under the same cap - rather than run one-per-finding or one-per-file: the floor
is paid once per batch and each file is still read once.

Simulated against the 37 real findings this shape was built from:

```
37 findings -> 21 locations -> 18 serious -> 12 file chunks -> 4 verifiers
total: 6 finders + 4 verifiers = 10 agents    (was 38; 18 when file-bound)
floor alone: ~310k                            (was ~1180k; ~558k file-bound)
```

## The order of work

Run it in this order. The order is the saving.

### 1. Gather the inputs first - in the main loop, not in an agent

Before invoking the workflow, work out three things yourself:

- **target** - what is under review, as a path list or a description.
- **brief** - one paragraph: what it is meant to do.
- **decisions** - a SHORT digest of what is deliberate, so agents do not report
  design as defect. Ten lines, not a document.

That last one matters for cost. Handing every agent a long design document is
a measured waste; they need the conclusions, not the reasoning.

Then, with those three in hand, run the INTENT GATE before spending a single
agent: state in one sentence what the thing under review is FOR, and ask whether
a simpler, smaller, or different-layer design would achieve it - something that
already exists and could be reused, a change at another layer, or nothing at
all. Do this yourself, in the main loop: you are the strongest reasoner in the
run and the only one holding the full context, and the finder/verifier machine
below cannot do it - a design question has no file:line, no trigger, and no
probe a verifier could run, so feeding it into the pipeline just mangles it into
a thin unverified "minor". If the honest answer is "this should be reworked",
say that to the user INSTEAD of invoking the workflow: a fan-out spent polishing
the wrong design is the most expensive no-op there is. `/scrutinize` is the deep
version of this same question.

### 2. Invoke the workflow

Use the `review.js` sitting next to this file - resolve its path from the skill's
own directory rather than hard-coding a home folder, so a copy of this skill
works wherever it was installed.

```
Workflow({
  scriptPath: "<skill dir>/review.js",
  args: {
    target: "...",
    brief: "...",
    decisions: "...",
    dimensions: ["integrity", "seams", "realstate", "lifecycle", "ux", "tests"],
    maxVerify: 18
  }
})
```

`dimensions` is optional - omit it for all six. Drop the ones that do not apply
(`ux` for a library, `realstate` for pure logic) rather than paying for them.

`args` must be a real JSON object in the tool call, never a JSON-encoded
string. Measured: a stringified args reached the script as one string, every
field fell back to its default, six dimensions ran instead of the three asked
for, and the run cost double. The script now recovers a parseable string with
a loud log and refuses anything else - but pass the object.

### 3. Write the report yourself

The workflow returns structured data and deliberately does NOT synthesise. You
write the report, because you are the one who acts on it and because a
synthesising agent that dies on a session limit takes the whole run with it.

The return has eight parts, and they are NOT interchangeable - report them as
what they are:

| field | what it is | how to report it |
|---|---|---|
| `confirmed` | a verifier tried to kill it and failed | ranked by harm, with file:line, scenario, proof, fix |
| `refuted` | a verifier killed it | one line each, or drop - mention only if the refutation itself teaches something |
| `unprovable` | a verifier answered, and the answer is that nothing it could run would settle this | **unchecked.** Say so, with the reason - these are the ones that need a human, or a rendered screen, or the hardware |
| `unresolved` | sent to a verifier, never ruled on | **unchecked.** Say so; do not let it read as refuted |
| `serious_but_over_cap` | blocker/major the cap never reached | **unchecked.** Say so; these are not minor |
| `minor` | minor/nit, never sent for verification | a flat list, labelled unverified |
| `suspect` | schema-valid but empty of content, quarantined before clustering | **unchecked and probably junk** - but if a dimension's whole output is here, that dimension DID NOT RUN |
| `coverage` | per dimension: what it says it read, plus `findings` / `suspect` counts | one line each - it is how the reader judges the sweep |

Five of those eight are "nobody checked this": `unprovable`, `unresolved`,
`serious_but_over_cap`, `minor`, and `suspect`. Report them as separate things.
Folding a capped blocker in with the nits is worse than not running the review.

**Read `coverage` counts before you write a word of the report.** `findings: 0`
with `suspect: 0` and a real `traced` line is a clean sweep - report it as one.
The dead cases are the rest, and the workflow logs each one: the finder agent
died (its `traced` says so), it returned nothing, or everything it produced was
quarantined (`findings: 0`, `suspect > 0`). Calling one of those clean is the
one mistake that makes the whole run worse than useless. Re-run that dimension
alone, or say plainly in the report that it did not run.

Be decisive about what is not worth fixing.

## Why it is shaped this way

Every rule below is a correction to something that actually went wrong.

**Slice by DIMENSION, not by file.** File-sliced reviewers found nothing; the
reviewer given "the seams" found a crash, and the one given "real data" found a
720 MB defect. Bugs live between files.

**Set the model per role.** The first version passed neither `model` nor
`agentType`, so all thirty-eight agents inherited the session model - six cheap
finders became six expensive ones, and that alone cost more than everything
else. The constants at the top of `review.js` are the cost profile; changing
them is the only supported way to change what a run costs.

**Count agents before tuning tiers.** Measured: two agents replying with a
single word cost 63k tokens, so roughly 31k of every agent is spent before it
does any work. Halving the agent count beats any effort tweak, which is why
verifiers are batched and why an effort tier was NOT the answer to the cost
problem - it looked like one for about ten minutes.

**Finders form hypotheses; verifiers prove them.** Every finding carries a
`probe` field - the check that would settle it - and the verifier is what runs
it. Asking a finder to find something only a probe can see is asking it to fail.

**Dedup by LOCATION, in plain code, and never discard.** One bug arrived three
times under three titles and was proved three times by three expensive agents.
Measured on those 37 findings: grouping by file and line bucket collapsed them to
27 and caught every duplicate that mattered. The `root_cause` slug does NOT work
as the primary key - independent agents do not converge on the same wording - so
it is used only to merge groups.

**The location is the WHOLE path, joined on the suffix relation.** Agents spell
the root inconsistently ("build/x.py", "./build/x.py", an absolute path), which
is what made the bare filename tempting - but any repo that repeats a name across
packages (27 `main.py`, 250 `__init__.py` in the codebase that surfaced this)
then folds unrelated files into one cluster, and the verifier is told they share
a file. A fixed number of tail segments is the same bug with a bigger number:
three still collapses `apps/web/.../Button/index.tsx` and
`apps/admin/.../Button/index.tsx`. Keep the full path and union the pairs where
one is a suffix of the other - that absorbs the disagreement at any depth without
assuming how the repo nests.

And grouping is not discarding: two genuinely different bugs can share a line
(measured). The whole group's claims go to one verifier, which rules on **each**.
Sending only a "lead" silently loses the rest - and that applies to the OUTPUT
too. `minor` and `serious_but_over_cap` list every row, not the cluster lead,
because those are the buckets no agent ever looked at.

**Verify blockers before majors.** The cap must never drop a blocker to make room
for a major.

**Match rulings by INDEX, never by an echoed title.** A verifier that paraphrases
a title breaks a title lookup, and the fallback then files the ruling under
another claim's file and line - a confirmed defect reported at the wrong place.
And count the rulings: a short array used to lose findings silently, which is the
same failure as sending only a cluster lead, one layer down.

**Cap the verifiers and report the overflow as unchecked.** A silent cap reads as
"we checked everything"; a capped blocker filed under "minor" is worse.

**Fail loudly on a bad dimension key.** An unrecognised key used to produce an
empty sweep, and a run that finds nothing reads exactly like clean code.

**And fail just as loudly on empty CONTENT.** A whole dimension once came back as
`{"title":"test","file":"a.py","claim":"x","probe":"x"}` - every field the right
type, nothing in any of them - and landed in `minor`, where it read as a swept
dimension with one small issue. Same symptom as the bad key, so it needs the same
noise: filler is quarantined into `suspect`, and `coverage` carries a per-dimension
count so a dead pass cannot pass for a clean one.

**Quarantine it, never delete it.** Recognising filler is a heuristic, and a
heuristic with a delete on the end of it eventually deletes something real in a
repo you cannot test against - "the path must contain a dot or a slash" would
throw away a blocker found in `Makefile`, `Dockerfile` or `LICENSE`. Brevity is
never disqualifying either: the finder persona explicitly invites a finder that
cannot build a concrete trigger to say so on the finding. Only shapes that carry
no information at all - an empty field, two single-token placeholders, all three
body fields identical - get moved aside, and moved aside is all that happens.

**Do not let the probe eat the user's work.** "Build the state the feature
actually meets" is the rule that finds the real bugs, and it is one sentence away
from telling an agent with Bash to construct that state on top of whatever the
person is doing. It has cost an unsaved session already. The fixture goes in a
scratch directory or on a copy; nothing that was not created by the agent gets
reset, dropped, restarted or overwritten; and a claim that can only be settled by
mutating one of those is reported unprovable, which is a correct answer and not a
failure. This is not about any one kind of application - the same instruction
reaches uncommitted work in the tree, a shared database, and a running container.

## The rule that finds the real bugs

**Judge the code in the state it really runs in.**

The worst defect this shape ever found - a 720 MB-per-fifty-steps regression -
was invisible to five careful reading passes AND to a purpose-built benchmark,
because the benchmark constructed a project with no mesh loaded and the bug was
that the mesh was being copied. The test written to guard against exactly that
class of bug had the same hole.

So: before any measurement or any claim about cost, build the state the feature
actually meets. A loaded model. Several materials. Many tiles. A deep stack.
Then measure. This is written into the context every agent receives, and it is
the single line most likely to earn the run back.
