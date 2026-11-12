# Artifact Schema Evolution Policy

## Current schema

`schemaVersion: 2` is the current frozen artifact schema.

Once an artifact schema is frozen, its required contract must not be
extended in place.

## Evolution rule

A change requires a new `schemaVersion` when it introduces:

- a new required provenance field;
- a new required experimental configuration;
- a breaking structural change;
- a semantic change that makes an existing field incompatible with
  its previous meaning.

The next breaking artifact contract must therefore use
`schemaVersion: 3`.

## Backward compatibility

Frozen artifacts remain associated with their original schema version.

Reading an older artifact must not silently convert it to a newer
schema version.

Missing provenance must remain unavailable when it cannot be derived
authoritatively from the original artifact.

The reader must not fabricate values using current defaults.

For example, an older artifact that does not contain a future
`someProfileId` must not be interpreted as if it had used the current
default profile.

## Legacy materialization and comparability

Legacy V1 artifacts remain unchanged on disk.

The reader may materialize compatibility values in memory when required
to represent a V1 artifact through the current runtime types. Such values
must not be interpreted or exposed as observed experimental provenance.

In particular:

- a missing legacy inference timeout may be materialized with a technical
  fallback for runtime compatibility, but it is not an observed timeout;
- missing per-agent token usage must remain unavailable and must not be
  reconstructed by assigning cumulative usage to CODER;
- missing REVIEWER usage must remain unavailable and must not be represented
  as observed zero usage;
- legacy-derived oracle duration remains non-comparable with V2 observed
  oracle duration;
- metrics or pairings that require unavailable provenance must exclude the
  affected V1 runs or explicitly mark them as non-comparable.

Runtime materialization must never rewrite the original V1 artifact.

`schemaVersion: 2` remains frozen. These rules affect only the
read/summary/analytics interpretation of legacy artifacts and do not extend
the persisted V2 contract.

## Migration

If an explicit migration is introduced in the future:

1. the original artifact remains unchanged;
2. migration must produce a distinct artifact or in-memory
   representation;
3. reconstructed values must only be produced when they are
   deterministically derivable from authoritative data;
4. unavailable provenance remains explicitly unavailable.

## Version policy

- V1: legacy schema.
- V2: current frozen schema.
- V3+: reserved for future breaking schema evolution.

A new mandatory provenance field must never be added directly to V2.
