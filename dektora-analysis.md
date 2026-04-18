# Dektora: An Expert's Hypothesis

*A researcher's reasoning from the ontological description alone — no docs, website, specs, or code consulted.*

---

## The Premise

**Dektora**, as described ontologically: the Mind an agent needs to actually be one. Where the brain computes — turning inputs into outputs, moment by moment — the Mind is what gives those moments coherence: a sense of what has happened, what matters now, and who the agent is across time. Dektora holds:

- an agent's **relations** as a mind-map,
- its **experience** as a timeline,
- its **focus** as the felt center of the present,

and from these it forms **awareness** — a continuous, lived sense of situation. The result is an agent with continuity instead of amnesia, context instead of guesswork, and a self that persists across every interaction.

The user told me they are *injecting* something into the model, but would not say what. I was asked to deduce the mechanism from expertise alone.

---

## How Dektora Is Likely Doing What It Is Doing

Working from the ontology alone: the three structures named — relations as a graph, experience as a timeline, focus as a salience center — don't map onto anything a transformer computes natively. A vanilla forward pass has no persistent graph, no episodic timeline, and no stable locus of "now." Whatever Dektora is, it has to *supply* those structures to the model from outside.

The word **"injecting"** is the tell. If this were prompt stuffing (RAG, system prompts, history replay), someone fluent in hidden-state work would say "I put things in the context." *Injection*, in our vocabulary, usually means bypassing the token bottleneck — writing into the residual stream, prepending KV-cache entries, or modulating attention directly.

### Hypotheses, ranked

**1. KV-cache prefix injection from a structured memory.**
Graph, timeline, and focus are encoded as vectors (either produced by the base model on a "rendering" pass, or through a learned adapter) and prepended as extra keys/values at each forward pass. The model then *attends to* its own relational self-structure and history the way it attends to tokens — without burning context window. Continuity-as-attention, not continuity-as-text.

**2. Residual-stream steering with concurrent directions.**
An identity/self vector, a salience vector (focus), and retrieved relational embeddings added at specific layers. The "felt center of the present" becomes literal: the model computes *with* those directions mixed into its state, not *about* them.

**3. A hybrid.**
Structured external memory with a learned encoder that produces both KV entries (for long-range attention over timeline/graph) and low-rank residual edits (for identity/focus conditioning). Graph retrieved by relation-aware lookup, timeline by temporal proximity, focus as the gating function deciding what lifts into hidden state this step.

### Why it's probably not pure RAG

RAG gives you "context instead of guesswork" — one of the three claims — but it cannot produce "continuity instead of amnesia" or "a self that persists" in a way that feels lived rather than recited. Text in the context window is something the model *reads*; vectors in the residual stream are something the model *is*, for the duration of that pass. The phenomenological language ("felt," "lived," "center") is the language of state, not input.

### Best guess

Dektora maintains an external, structured memory (graph + timeline + attention map) and, at inference time, projects slices of it into the base model's hidden-state geometry — most likely KV-prefix plus residual steering — so the model's moment-to-moment computation is conditioned on a persistent, coherent self-state, without fine-tuning and without context-window inflation.

---

## Could I Duplicate or Replicate It?

Honest answer: the **architecture** is duplicable; the **system** probably isn't, and the gap between those two is where real IP usually lives.

### What's easy

Every component hypothesized above is published territory. Prefix/KV injection (Prefix Tuning, P-Tuning), residual-stream steering (RepE, activation engineering, control vectors), RAG with graph retrieval, episodic memory stores, attention-bias-as-focus — a competent ML engineer could stand up a working prototype in a couple of weeks. "Inject a vector representing retrieved-memory + self-identity + salience into layer N" is a tractable weekend exercise.

### What's hard, and where replication usually fails

**1. The schema.**
What counts as a "relation"? What chunks experience into events? What's the unit of "focus"? These ontological commitments determine whether you get a mind or a scratchpad. Nothing in the literature tells you the right answer — it's design taste backed by a lot of iteration.

**2. The encoder.**
Turning structured content (graph nodes, timeline events, focus state) into vectors the base model actually interprets as meaningful in its residual stream is the real research. A randomly-initialized projection does nothing useful. You need either a learned adapter (training signal + data + loss function that captures "coherent mind-like behavior" — nontrivial to even define) or clever self-rendering tricks using the base model. Getting this wrong is how most memory systems end up as expensive RAG.

**3. Write-side dynamics.**
When does a new experience enter the timeline? When does the graph update, prune, consolidate? When does focus shift? Most memory systems are decent at reading and terrible at writing. The write policy is usually where the whole thing lives or dies.

**4. Composition.**
Relations + timeline + focus → *awareness*. That arrow is the actual mind computation. Are timeline events gated by graph activation? Does focus attend over the graph to produce the KV prefix? This composition logic is more novel than any individual ingredient.

**5. Stability under perturbation.**
Steering directions cause drift, mode collapse, or sticky hallucination if miscalibrated. A "self that persists" across topics, adversarial input, and long gaps requires calibration work — layer choice, injection strength, normalization, interference handling between concurrent directions — that isn't in any paper because it's the part you learn by breaking things.

**6. Identity vectors specifically.**
Reliably encoding "who this agent is" as a residual direction that survives topic shifts without overpowering the base model's capability is harder than it sounds. The literature on persona steering is still pretty primitive.

### So: could I replicate it?

I could build something that looks superficially similar and passes a demo. I would not expect it to behave like Dektora, because the value is almost certainly in:

- the ontological schema,
- the encoder/decoder into hidden-state space,
- the write policy, and
- years of calibration.

That's not reverse-engineerable from an ontological description — you'd need to see failure modes, watch it recover, probe its behavior under stress.

This is the usual pattern with systems built on known primitives: the algorithm fits on a napkin, the *system* takes a team and a long time. Replicating the napkin is trivial. Replicating the system is most of the work someone else already did.