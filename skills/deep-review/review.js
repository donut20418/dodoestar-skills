export const meta = {
  name: 'deep-review',
  description: 'Multi-agent code review: cheap finders fan out, plain code dedups by location, expensive verifiers prove',
  phases: [
    { title: 'Find', detail: 'finders sweep the dimensions (sonnet, low effort)' },
    { title: 'Verify', detail: 'verifiers RUN a probe per deduped location (opus, high effort)' },
  ],
}

// ---------------------------------------------------------------------------
// SELF-CONTAINED ON PURPOSE. No `agentType`, so this skill depends on no agent
// definition in anybody's `.claude/agents/` and behaves identically wherever it
// is copied. Everything it needs - the two personas and the cost profile - is in
// this one file. A workflow script cannot read from disk, so there is nowhere
// else for them to live, and a second copy kept "for reference" is just a rule
// about keeping two things in sync that nobody will follow.
// ---------------------------------------------------------------------------

const FINDER_MODEL = 'sonnet'
const FINDER_EFFORT = 'low'
const VERIFIER_MODEL = 'opus'
// ONE TIER, and `high` rather than `max`.
//
// There is no evidence that `max` does this job better. The run this shape was
// built from used `high` for all twenty-nine verifiers and they confirmed
// twenty-nine findings while refuting NONE - which says the weakness was not
// reasoning depth, it was a prompt that never really tried to kill anything.
// The persona below is the fix for that; an effort bump was treating a symptom.
//
// What decides a verifier's verdict is RUNNING the probe, which is tool use and
// not thinking harder. Raise this only with a measurement in hand.
const VERIFIER_EFFORT = 'high'

// A verifier handles a BATCH of claims from one file rather than one cluster.
// MEASURED: two agents replying with a single word cost 63k tokens, so there is
// a floor of roughly 31k per agent before any work happens at all. With 18
// verifiers that floor alone is ~560k. Batching by file amortises it AND stops
// three agents reading the same file three times.
//
// Capped so a file with many findings does not become one overloaded agent.
const MAX_CLAIMS_PER_VERIFIER = 6

const FINDER_PERSONA = `
You find CANDIDATE defects. Something else decides which are real.

REPORT EVERYTHING, including findings you are unsure about and ones you think are
low severity. Do not filter for importance - a separate verification pass does
that. A false positive costs one filtering step; a false negative is invisible to
everyone downstream and nobody ever learns the bug was in reach. Attach severity
and let the filter filter.

Every finding needs a CONCRETE trigger: inputs or state, then the wrong output,
crash or corruption. "This could race" is not a trigger; "if the timer fires
while the writer holds a partial buffer, the file is truncated" is. If you cannot
write one, say so on that finding - that is signal for the verifier, not a reason
to drop it.

Prefer the structural cause over the symptom.

LEARN THE PROJECT'S RULES FIRST. Read whatever guidance it ships - CLAUDE.md, a
README, architecture notes, any check script under tools/ or scripts/. A
violation of a rule the project documents is a real finding; cite where the rule
is written. A documented tradeoff is NOT a finding. Do not invent conventions the
project never stated.

Stay in your slice. Other finders cover the rest in parallel, and duplicates cost
the dedup stage real money.

Say honestly in "traced_clean" what you actually read and what you could not
reach. A silent partial scan reads downstream as "clean", which is worse than an
honest gap.
`

const VERIFIER_PERSONA = `
Your job is to KILL the finding. If it survives you honestly trying, it is
probably real. You get one candidate. You are not reviewing the file, not looking
for other bugs, and not fixing anything.

DEFAULT TO REFUTED. If you are still uncertain after tracing, the answer is not
real. Every false positive that reaches a human costs a real investigation and
teaches them to distrust the whole review.

Work these in order and stop at the first that lands:
 1. Does the trigger reproduce? Follow the stated inputs through the real code.
    If the trigger cannot happen, it is refuted however plausible it reads.
 2. Is it already handled? A guard, a caller invariant, a framework guarantee.
 3. Is it deliberate? Grep the project's own notes - CLAUDE.md, design docs, a
    task or changelog file, comments at the site. Name the entry you found.
 4. Is it covered? Grep the tests, and READ the test body, not its name.
 5. Can you make it fail? REPRODUCING BEATS REASONING. Find the project's real
    commands - CI config, Makefile, package.json, pyproject.toml, CLAUDE.md - and
    use them, including any local interpreter or venv path.

The finding names a file and a line; that is where the claim points, not where
the answer is. Read the callers.

Some claims cannot be settled by running something - anything depending on what a
human sees rendered, on real hardware timing, on an environment you lack, or on
mutating something you are not allowed to touch. Say so and answer real=false
with the reason. A confident wrong verdict ends the investigation, but so does a
probe that destroys the thing it was measuring: taking that exit is the correct
move, not a failure.

"Seems plausible" is not a verdict. "proof" must name evidence you actually
looked at: the command you ran and its output, or the path:line that settles it.
`

// ---------------------------------------------------------------------------

const a = args || {}
const TARGET = a.target || 'the current working diff'
const BRIEF = a.brief || ''
const DECISIONS = a.decisions || '(none supplied - do not assume any)'
const MAX_VERIFY = a.maxVerify || 18

// The digest, NOT the design document. Shipping a long doc to every agent was a
// measured waste; what they need is the short list of what is deliberate.
const CONTEXT = `
UNDER REVIEW: ${TARGET}
${BRIEF ? '\nWHAT IT IS MEANT TO DO:\n' + BRIEF : ''}

DELIBERATE DECISIONS - do NOT report these as defects unless the code actually
violates them:
${DECISIONS}

THE RULE THAT MATTERS MOST: judge the code in the state it really runs in. A
measurement taken on an empty or synthetic fixture is worth nothing. The worst
defect this review shape ever found was invisible to five careful reading passes
AND to a purpose-built benchmark, because the benchmark built a project with no
mesh loaded and the bug was that the mesh was being copied. Before any claim
about cost or behaviour, build the state the feature actually meets.

BUILD THAT STATE SOMEWHERE DISPOSABLE. The rule above tells you to construct a
realistic fixture; it does NOT license you to construct it on top of somebody's
work. You are running on a real machine that a real person is using, and most of
what is expensive there cannot be recovered: uncommitted changes in the working
tree, an open application session holding unsaved state, a database or service
something else depends on, a running container, a populated cache. Work in a
scratch directory or on a copy you made. Never reset, clean, check out over,
stash, truncate, drop, restart, uninstall or overwrite anything you did not
create yourself. If the only way to settle a claim is to mutate one of those,
DO NOT - leave it alone and report the claim as one you could not prove.

Cite file:line for everything. Never edit a file.
`

const FINDING = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string', description: 'repo-relative path' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          root_cause: {
            type: 'string',
            description: 'short slug for the UNDERLYING cause, e.g. "mesh-in-snapshot"',
          },
          claim: { type: 'string' },
          scenario: { type: 'string' },
          probe: {
            type: 'string',
            description: 'the check that would PROVE this - a script, a state to build, a sequence to drive. You cannot run it; a verifier will.',
          },
        },
        required: ['title', 'file', 'line', 'severity', 'root_cause', 'claim', 'scenario', 'probe'],
        additionalProperties: false,
      },
    },
    traced_clean: {
      type: 'string',
      description: 'what you actually read, and what you could NOT reach',
    },
  },
  required: ['findings', 'traced_clean'],
  additionalProperties: false,
}

const VERDICT = {
  type: 'object',
  properties: {
    rulings: {
      type: 'array',
      description: 'EXACTLY one ruling per claim you were given - never fewer',
      items: {
        type: 'object',
        properties: {
          // An INDEX, not the title. Matching on an echoed title breaks the
          // moment a verifier paraphrases it, and the fallback then attributes
          // the ruling to somebody else's file and line.
          claim_index: {
            type: 'integer',
            description: 'the 1-based CLAIM number you are ruling on',
          },
          real: { type: 'boolean' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          reasoning: { type: 'string' },
          proof: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['claim_index', 'real', 'severity', 'reasoning', 'proof', 'fix'],
        additionalProperties: false,
      },
    },
  },
  required: ['rulings'],
  additionalProperties: false,
}

const DEFAULT_DIMENSIONS = [
  {
    key: 'integrity',
    prompt: `DIMENSION: CAN THIS CORRUPT OR LOSE THE USER'S WORK? The highest-stakes
dimension - go here first and hardest. Wrong data written somewhere, stale state
restored, work silently dropped, two sources of truth disagreeing. Enumerate the
sequences that would do it: interleaved operations, an operation on something
since deleted, limits and eviction, error paths leaving half a change applied.`,
  },
  {
    key: 'seams',
    prompt: `DIMENSION: THE SEAMS. Review the code OUTSIDE the change that it
depends on or that calls into it - callers, event delegation, the layer above and
below. Bugs live between files, not in them: in the review this shape was built
from, the file-sliced reviewers found nothing and the seam-sliced one found a
crash. Ask what the change ASSUMES about its callers, then check each assumption.`,
  },
  {
    key: 'realstate',
    prompt: `DIMENSION: DOES IT HOLD UP ON REAL DATA? Work out the state this code
actually runs against in production - a loaded model, many tiles, a deep stack, a
large document - and check every assumption, cost and measurement against THAT
rather than an empty fixture. Read any benchmark or performance claim in the code
or docs and ask what state it was taken on. Describe plainly what a realistic
fixture looks like, so the verifier can build it.`,
  },
  {
    key: 'lifecycle',
    prompt: `DIMENSION: SHARED STATE AND LIFECYCLE. Module-level and class-level
globals, hooks, caches, counters, singletons. Hunt for a sequence that leaves any
of them wrong: construction order, teardown, two instances, an exception escaping
mid-operation, concurrency, reload. Does anything install a global and fail to
remove it, or remove one that belongs to somebody else?`,
  },
  {
    key: 'ux',
    prompt: `DIMENSION: WHAT THE USER EXPERIENCES. Not correctness - whether the
result feels right. After each operation, is the user looking at what changed? Is
the right thing selected, does the display refresh, is the wording accurate? Are
there actions producing a surprising number of steps, or none where one is
expected? Trace which signals or events each path emits and what listens to them.`,
  },
  {
    key: 'tests',
    prompt: `DIMENSION: DO THE TESTS ACTUALLY TEST IT? Find tests that pass while
skipping what they claim to cover: assertions on stubs instead of the real path,
setups that make the assertion vacuous (acting on a no-op, asserting something
already true), fixtures that build a state the app never has. For each, name a
plausible way to break the code that NO existing test would catch. Then list the
behaviour with no test at all, ranked by how likely it is to hide a real bug.`,
  },
]

// A typo in `dimensions` used to silently produce an empty sweep, and a run that
// finds nothing reads exactly like a clean bill of health. Fail loudly instead.
let DIMENSIONS = DEFAULT_DIMENSIONS
if (a.dimensions && a.dimensions.length) {
  const known = DEFAULT_DIMENSIONS.map((d) => d.key)
  const unknown = a.dimensions.filter((k) => known.indexOf(k) === -1)
  if (unknown.length) {
    throw new Error(
      'deep-review: unknown dimension(s): ' + unknown.join(', ') +
      '. Known: ' + known.join(', '))
  }
  DIMENSIONS = DEFAULT_DIMENSIONS.filter((d) => a.dimensions.indexOf(d.key) !== -1)
}

// ---- Phase 1: find. Cheap, parallel, read-only. ---------------------------

phase('Find')

const swept = await parallel(DIMENSIONS.map((d) => () =>
  agent(`${FINDER_PERSONA}\n${CONTEXT}\n\n${d.prompt}`, {
    label: `find:${d.key}`,
    phase: 'Find',
    model: FINDER_MODEL,
    effort: FINDER_EFFORT,
    schema: FINDING,
  }).then((r) => ({ key: d.key, result: r }))))

// A finding can satisfy the schema and still carry nothing - every field the
// right type, every value filler. Observed: a whole dimension came back as
// {"title":"test","file":"a.py","claim":"x","probe":"x"} and flowed into `minor`
// where it read as a swept dimension with one small issue. The unknown-dimension
// check below exists because "a run that finds nothing reads exactly like clean
// code"; this is the same failure with a valid key, so it needs the same loudness.
//
// QUARANTINE, NEVER DELETE. A rule that deletes is a rule that deletes real
// findings in a repo nobody here can test against - "the path must contain a dot
// or a slash" would silently drop a blocker in Makefile, Dockerfile or LICENSE.
// So this only ever moves a finding to `suspect`, where the report can still see
// it, and every rule below asks whether the value is DEGENERATE rather than
// whether it is short. FINDER_PERSONA explicitly invites a finder that cannot
// build a concrete trigger to say so on the finding instead of dropping it, so
// brevity alone must never be disqualifying.
function degenerate(f) {
  const text = (s) => String(s == null ? '' : s).trim()
  const title = text(f.title)
  const file = text(f.file)
  if (!title) return 'title is empty'
  if (!file) return 'file is empty'
  const body = [text(f.claim), text(f.scenario), text(f.probe)]
  if (body.some((s) => !s)) return 'claim, scenario or probe is empty'
  // One bare token with no spaces is a placeholder, not a sentence. Two of the
  // three is past any plausible terse-but-real finding.
  const stub = body.filter((s) => s.length <= 3 && s.indexOf(' ') === -1)
  if (stub.length >= 2) return 'claim/scenario/probe are single-token placeholders'
  if (body[0] === body[1] && body[1] === body[2]) return 'claim, scenario and probe are identical'
  return ''
}

const sweeps = swept.filter(Boolean)
const found = []
const suspect = []
const coverage = []
for (const s of sweeps) {
  if (!s.result) {
    coverage.push({ dimension: s.key, traced: '(agent returned nothing)', findings: 0, suspect: 0 })
    continue
  }
  let ok = 0
  let bad = 0
  for (const f of s.result.findings || []) {
    const row = { ...f, dimension: s.key }
    const why = degenerate(row)
    if (why) { suspect.push({ ...row, suspect_reason: why }); bad++ } else { found.push(row); ok++ }
  }
  // The COUNTS are the point. `traced` is the finder's own word for what it read,
  // and a finder that produced nothing usable still writes a confident one. Only
  // a number separates a dimension that swept clean from one that never ran.
  coverage.push({ dimension: s.key, traced: s.result.traced_clean, findings: ok, suspect: bad })
}

if (suspect.length) {
  log(`QUARANTINED ${suspect.length} finding(s) - schema-valid but empty of content: ` +
    suspect.map((s) => `${s.dimension}/${s.title}`).join(' | '))
}
const barren = coverage.filter((c) => !c.findings)
if (barren.length) {
  log(`PRODUCED NOTHING USABLE - treat as UNSWEPT, not clean: ` +
    barren.map((c) => c.dimension).join(', '))
}

// ---- Phase 2: dedup. Plain code, no agent, no tokens. ---------------------
//
// MEASURED on the 37 findings this shape was built from: grouping by file and
// line bucket collapsed them to 27, catching every duplicate that mattered - the
// same defect arrived three times at undo_commands.py:44 under three different
// titles, from three agents that could not see each other.
//
// The root_cause slug ALONE is not reliable for that: independent agents do not
// converge on the same wording. It is used here only to MERGE groups, never as
// the primary key.
//
// And grouping is not discarding. Two genuinely different bugs can share a line
// - measured, at undo_commands.py:114 - so the whole group's claims go to the
// verifier and it rules on each. Sending only a "lead" silently loses the rest.

// The file half of the key is the WHOLE normalised path, and paths that differ
// only by how much root an agent included are joined afterwards.
//
// The bare basename was the original choice for a good reason - independent
// agents report the same file differently ("build/x.py", "./build/x.py", an
// absolute path), and the bare name is the one form they all agree on. But it
// over-normalises: any repo that repeats a filename across packages folds
// unrelated files into one cluster, which then hands a verifier claims from
// several files while telling it they share one.
//
// A fixed number of tail segments is the same mistake with a bigger number -
// three segments still collapses apps/web/src/components/Button/index.tsx and
// apps/admin/src/components/Button/index.tsx in any monorepo. So keep the full
// path and join on the SUFFIX relation instead: that absorbs the prefix
// disagreement that motivated the basename, at any depth, without ever assuming
// how deeply the repo nests. The '/' boundary in isSamePath keeps config.py from
// matching myconfig.py.
function normPath(p) {
  return String(p || '?')
    .replace(/\\/g, '/')
    .toLowerCase()
    .split('/')
    .filter((s) => s && s !== '.')
    .join('/')
}

function isSamePath(a, b) {
  if (a === b) return true
  return a.endsWith('/' + b) || b.endsWith('/' + a)
}

function locKey(f) {
  const line = typeof f.line === 'number' ? Math.floor(f.line / 20) : 'x'
  return normPath(f.file) + '#' + line
}

function keyParts(k) {
  const cut = k.lastIndexOf('#')
  return { path: k.slice(0, cut), line: k.slice(cut + 1) }
}

const parent = {}
function root(x) {
  while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
  return x
}
function join(x, y) {
  const rx = root(x), ry = root(y)
  if (rx !== ry) parent[rx] = ry
}

for (const f of found) {
  const k = locKey(f)
  if (parent[k] === undefined) parent[k] = k
}

// Same line bucket + one path is a suffix of the other = the same place, spelled
// with different amounts of root. This is what the bare basename used to buy, now
// bought without also merging unrelated files that happen to share a name.
// Quadratic, but over distinct locations (dozens), not findings.
const locKeys = Object.keys(parent)
for (let i = 0; i < locKeys.length; i++) {
  const a = keyParts(locKeys[i])
  for (let j = i + 1; j < locKeys.length; j++) {
    const b = keyParts(locKeys[j])
    if (a.line === b.line && isSamePath(a.path, b.path)) join(locKeys[i], locKeys[j])
  }
}

const bySlug = {}
for (const f of found) {
  const slug = String(f.root_cause || '').toLowerCase().trim()
  if (!slug) continue
  if (!bySlug[slug]) bySlug[slug] = []
  bySlug[slug].push(locKey(f))
}
for (const slug of Object.keys(bySlug)) {
  const keys = bySlug[slug]
  for (let i = 1; i < keys.length; i++) join(keys[0], keys[i])
}

const RANK = { blocker: 0, major: 1, minor: 2, nit: 3 }
const grouped = {}
for (const f of found) {
  const g = root(locKey(f))
  if (!grouped[g]) grouped[g] = []
  grouped[g].push(f)
}
const clusters = Object.keys(grouped).map((g) => {
  const rows = grouped[g].slice().sort((x, y) => RANK[x.severity] - RANK[y.severity])
  return { key: g, rows, worst: rows[0].severity, count: rows.length }
})
clusters.sort((x, y) => RANK[x.worst] - RANK[y.worst])

log(`${found.length} findings -> ${clusters.length} distinct locations`)

// Blockers first, then majors, so a cap never drops a blocker for a major.
const serious = clusters.filter((c) => c.worst === 'blocker' || c.worst === 'major')
const toVerify = serious.slice(0, MAX_VERIFY)
const overCap = serious.slice(MAX_VERIFY)
const minor = clusters.filter((c) => c.worst !== 'blocker' && c.worst !== 'major')

if (overCap.length) {
  log(`OVER THE CAP OF ${MAX_VERIFY} - serious and NOT verified: ` +
    overCap.map((c) => c.rows[0].title).join(' | '))
}

// ---- Phase 3: verify. Expensive, batched, and it RUNS things. ------------
//
// Batched BY FILE, because the cost floor is per AGENT and not per claim: two
// agents answering with one word each cost 63k, so roughly 31k of every agent is
// spent before it does anything. One agent ruling on a file's claims pays that
// once and reads the file once.

// The batch label is the SHORTEST spelling anyone in the cluster used, not the
// lead row's. Rows in one cluster can name the same file with different amounts
// of root; picking the shortest makes two clusters in the same file land in one
// batch instead of two, and keeps the "all in X" line in the prompt true.
function clusterFile(c) {
  let best = null
  for (const f of c.rows) {
    const p = normPath(f.file)
    if (best === null || p.length < best.length) best = p
  }
  return best === null ? '?' : best
}

const batches = []
const byFile = {}
for (const c of toVerify) {
  const file = clusterFile(c)
  if (!byFile[file]) byFile[file] = []
  byFile[file].push(c)
}
for (const file of Object.keys(byFile)) {
  let pending = []
  let claims = 0
  for (const c of byFile[file]) {
    if (claims && claims + c.rows.length > MAX_CLAIMS_PER_VERIFIER) {
      batches.push({ file: file, clusters: pending })
      pending = []
      claims = 0
    }
    pending.push(c)
    claims += c.rows.length
  }
  if (pending.length) batches.push({ file: file, clusters: pending })
}

log(`${toVerify.length} locations -> ${batches.length} verifiers (batched by file)`)

phase('Verify')

const verified = await parallel(batches.map((b) => () => {
  const rows = []
  for (const c of b.clusters) for (const f of c.rows) rows.push(f)

  const claims = rows.map((f, i) => `
CLAIM ${i + 1}: ${f.title}
  where:    ${f.file}:${f.line}
  severity: ${f.severity}   (found by the "${f.dimension}" pass)
  detail:   ${f.claim}
  scenario: ${f.scenario}
  probe the finder could not run: ${f.probe}`).join('\n')

  return agent(`${VERIFIER_PERSONA}\n${CONTEXT}

You have ${rows.length} claim(s), all in ${b.file}. Some may be one bug seen from
several angles; others may be unrelated bugs that happen to share a file. Decide
per claim.

RULE ON EVERY ONE, and answer with its CLAIM NUMBER. Returning fewer rulings than
claims loses a finding permanently - that is the failure this batching exists to
avoid, so do not reintroduce it.
${claims}

You have Bash. USE IT. Build the realistic state first; a probe on an empty
fixture proves nothing. Build it in a scratch directory or on a copy - never on
the working tree, a running service or an open session, and if that leaves the
claim unprovable then unprovable is the answer. Put the actual command output
in "proof".`, {
    label: `verify:${b.file}`,
    phase: 'Verify',
    model: VERIFIER_MODEL,
    effort: VERIFIER_EFFORT,
    schema: VERDICT,
  }).then((v) => (v ? { file: b.file, claims: rows, verdict: v } : { file: b.file, claims: rows, verdict: null }))
}))

const results = verified.filter(Boolean)

// Flatten to one row per RULING, matched by INDEX. Anything the verifier did not
// rule on is carried out as unresolved rather than vanishing - a silently short
// rulings array is the same class of loss as sending only a cluster lead.
const confirmed = []
const refuted = []
const unresolved = []
for (const r of results) {
  const ruled = {}
  for (const ruling of (r.verdict && r.verdict.rulings) || []) {
    const i = (ruling.claim_index || 0) - 1
    const src = r.claims[i]
    if (!src) continue                       // an index nobody asked about
    ruled[i] = true
    const row = {
      title: src.title, file: src.file, line: src.line,
      dimension: src.dimension, scenario: src.scenario,
      severity: ruling.severity, reasoning: ruling.reasoning,
      proof: ruling.proof, fix: ruling.fix,
    }
    ;(ruling.real ? confirmed : refuted).push(row)
  }
  for (let i = 0; i < r.claims.length; i++) {
    if (ruled[i]) continue
    const f = r.claims[i]
    unresolved.push({
      title: f.title, file: f.file, line: f.line, severity: f.severity,
      claim: f.claim, scenario: f.scenario,
      why: r.verdict ? 'the verifier returned no ruling for it' : 'the verifier failed',
    })
  }
}
if (unresolved.length) {
  log(`NOT RULED ON (${unresolved.length}): ` +
    unresolved.map((u) => u.title).join(' | '))
}
confirmed.sort((x, y) => RANK[x.severity] - RANK[y.severity])

// Flatten a cluster list to one row PER FINDING, keeping each row's own file and
// line rather than the lead's. `claims_in_group` carries the cluster size through
// so the report can still say which rows arrived together.
function expand(cls, withCount) {
  const out = []
  for (const c of cls) {
    for (const f of c.rows) {
      const row = {
        title: f.title, file: f.file, line: f.line,
        severity: f.severity, claim: f.claim, dimension: f.dimension,
      }
      if (withCount) row.claims_in_group = c.count
      out.push(row)
    }
  }
  out.sort((x, y) => RANK[x.severity] - RANK[y.severity])
  return out
}

// Synthesis happens in the MAIN LOOP, not in an agent: it is the cheapest place
// for it, the main loop is what acts on the report, and a synthesising agent that
// dies on a session limit takes the whole run's value with it - which is exactly
// what happened the first time it was an agent.
return {
  swept: found.length,
  locations: clusters.length,
  verified_clusters: toVerify.length,
  verifier_agents: batches.length,
  confirmed,
  // Sent to a verifier and never ruled on. NOT the same as refuted, and not the
  // same as minor - these are unchecked, and the report has to say so.
  unresolved,
  refuted: refuted.map((r) => ({ title: r.title, why: r.reasoning })),
  // EVERY row, not the cluster lead. These two buckets are the ones nobody
  // verified, so a lead-only list is the same silent loss this file warns about
  // when it sends a whole group to the verifier rather than a lead - one layer
  // further down, and worse here because no agent ever looked at these at all.
  // A cluster can hold two genuinely different bugs (measured), and dropping the
  // second from an UNCHECKED bucket means it is never seen by anyone.
  serious_but_over_cap: expand(overCap, true),
  minor: expand(minor, false),
  // Schema-valid but empty of content, so never clustered or verified. Held here
  // rather than deleted: the rule that recognises filler is a heuristic, and a
  // heuristic that deletes eventually deletes something real in a repo this was
  // never run against. If a dimension's whole output is in here, that dimension
  // did not run - say UNSWEPT, not clean.
  suspect,
  // What each pass says it actually read, plus how many findings it produced.
  // The count is what makes a dead dimension visible: `traced` is the finder's
  // own account of its work and a failed one still writes a confident sentence.
  coverage,
}
