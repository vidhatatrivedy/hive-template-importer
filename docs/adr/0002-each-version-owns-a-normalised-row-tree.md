# Each Version owns a full normalised row tree

The schema is fully normalised: every fact is stored once, children point at their parent, and nothing derivable is stored. Unsaved edits live only in the browser and every Save makes a Version, so the server has no "live tree" apart from the Versions. Content therefore hangs off the Version, not the Template: Template → Version → Section → Item → Comment. Each Version owns its own rows, and each Save, Restore and Duplicate writes a complete new tree in one transaction. The latest Version *is* the Template's saved content. Current and old Versions are read with the same queries, and a Version is immutable by construction (a trigger refuses UPDATE on content rows).

## Considered Options

- **Live tree keyed by Template + a jsonb snapshot per Version.** Rejected: the snapshots are denormalised documents, a second schema that can drift from the tables, and the live tree duplicates the latest snapshot.
- **Structural sharing** (immutable Comment rows, with Versions referencing them through membership tables that carry position and parent). Rejected: it avoids repeating unchanged rows, but every read joins through membership, Save must compute what changed, and Restore, reorder and deletion need reference counting. That's a lot of machinery to save a few hundred KB per Save against a 500 MB budget.

## Consequences

- A Save of the largest fixture (Ben, 1,248 Comments) writes about 1.4k content rows; 100 such Saves are about 140k rows.
- Row ids change on every Save. The client uses temporary ids for unsaved nodes and reloads after Save. Links that must survive a Save (for example Trust Report → Comment) go through the Comment's Source row, which is carried into every Version.
- Raw export rows and Import issues aren't Version content. They belong to the Import run, which Comments in any Version or Copy reference by id, never copy.
