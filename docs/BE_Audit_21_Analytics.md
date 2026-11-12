# Freeze Audit BE — `analytics.ts`

## 1. Esito sintetico

**Valutazione complessiva: PASS per il contratto tipizzato corrente, con un nuovo hardening P1 consigliato.**

`analytics.ts` è il contratto centrale dei dati sperimentali: modelli/config, limiti, fixture identity, metadata, artifact versionati, metriche di qualità, aggregati e pairing. Il file riflette correttamente molte remediation già chiuse nel tracker, ma mostra un gap di provenance nel contratto `ExperimentFixtureIdentity`: la fixture conserva `id`, `taskId`, `category`, `targetFiles` e `testFiles`, mentre l'hash descritto da BE-P1-19 include anche `issueSpec`. Il digest consente di rilevare differenze, ma l'artifact non conserva l'`issueSpec` osservato come provenance esplicita e ispezionabile.

Questo finding è distinto da BE-P1-19 e non ne invalida la chiusura: l'identità deterministica esiste ed è persistita. È un hardening della provenance necessario se si vuole che il profilo sperimentale renda direttamente auditabili tutti gli input semantici che compongono l'identità.

---

## 2. Ruolo del file

Il file definisce esclusivamente tipi e contratti. Non implementa formule analytics o validazione runtime. Di conseguenza l'audit può verificare:

- presenza e separazione semantica dei campi;
- forma degli artifact V1/V2;
- rappresentabilità delle metriche dichiarate;
- disponibilità nel contratto dei dati di provenance.

Non può, da solo, dimostrare che `TelemetryStorage.ts` calcoli correttamente aggregati, pairing, denominatori o migrazione legacy.

---

## 3. Contratti sperimentali

### 3.1 Mode e category

`ExperimentMode` separa `BASELINE` e `MULTI_AGENT`; `ExperimentCategory` separa `REPAIR` e `CREATE`. È una rappresentazione chiusa e coerente con il disegno corrente.

### 3.2 Model provenance

`ExperimentModelConfig` contiene `baseUrl`, `modelName`, `seed`, `temperature`, `topP` e `inferenceTimeoutMs`. Il timeout è quindi parte della provenance V2 insieme ai principali parametri di sampling.

### 3.3 Semgrep provenance

Il contratto distingue:

- `semgrepProfileId`, identità della policy/ruleset;
- `semgrepConfig`, configurazione operativa (`command`, `timeoutMs`, `envAllowList`).

Questa separazione è coerente con BE-P1-20.

### 3.4 Limiti di refinement

`ExperimentLimits` contiene `maxIterations` e `maxTechnicalAttempts`; `ExperimentProfile` li persiste tramite `limits`. Il contratto supporta quindi BE-P1-18.

---

## 4. Fixture identity

`ExperimentFixtureIdentity` espone:

- `id`;
- `taskId`;
- `category`;
- `targetFiles`;
- `testFiles`.

La presenza dell'`id` permette al run V2 di portare la fixture identity richiesta da BE-P1-19. Target e test file sono inoltre visibili come provenance.

### Gap osservato: `issueSpec`

L'implementazione auditata di `FixtureIdentity.ts` calcola l'hash anche su `issueSpec`. In `ExperimentFixtureIdentity`, però, `issueSpec` non è conservato.

Ne consegue una distinzione importante:

- la fixture è **identificabile deterministicamente** tramite digest;
- non è però **integralmente ispezionabile dal solo `ExperimentProfile`** rispetto all'input `issueSpec` che ha contribuito al digest.

Non è opportuno modificare retroattivamente lo schema V2 già frozen. Qualunque proprietà obbligatoria futura deve rispettare BE-P1-21 e quindi richiedere evoluzione esplicita dello schema.

---

## 5. Artifact schema e immutabilità

La discriminated union:

- `StoredRunV1` → `schemaVersion: 1`;
- `StoredRunV2` → `schemaVersion: 2` + `experimentProfile`;

formalizza correttamente la separazione tra artifact legacy e profilo sperimentale completo. La struttura è coerente con BE-P0-11 e con la policy di evoluzione BE-P1-21.

Il file non mostra alcuna reinterpretazione automatica dei V1: tale comportamento va verificato in `TelemetryStorage.ts`.

---

## 6. Outcome autonomo vs umano

`ExperimentMetadata` mantiene distinti:

- `status`;
- `autonomousStatus`;
- `finalizationStatus`;
- `candidateVerified`;
- `autonomousRunSucceeded`;
- `isHumanAugmented`;
- `resolutionVerified`.

Il contratto rende quindi rappresentabili sia la separazione autonomous/finalization di BE-P0-15 sia la separazione candidate verification/run success di BE-P0-16.

Non emergono collisioni semantiche nuove nel tipo. La coerenza tra questi campi deve essere garantita dalle invarianti runtime, tema già censito in BE-P1-23.

---

## 7. Token telemetry

Sia `ExperimentMetadata` sia `RunQualityMetrics` distinguono token reali da usage indisponibile tramite valori nullable e flag di availability.

`RunQualityMetrics` separa inoltre usage totale, Coder e Reviewer. Il contratto supporta BE-P0-10 e non forza l'equivalenza fra token mancanti e zero.

Il problema legacy relativo all'attribuzione/materializzazione sintetica non nasce dal tipo: è già censito come BE-P1-30 nel layer `TelemetryStorage.ts`.

---

## 8. Metriche temporali

Il contratto conserva:

- `totalDurationMs`;
- `inferenceDurationMs`;
- `oracleDurationMs`;
- `orchestrationOverheadMs` con basis fissa `NODE_PROCESS_CPU`.

In `RunQualityMetrics`, `oracleDurationMs` è nullable ed è accompagnata da `oracleDurationComparable`. Gli aggregati riportano sia la media sia i conteggi comparable/excluded legacy.

Questo è coerente con:

- BE-P0-08: CPU overhead mantenuto come diagnostica, senza percentuali scientifiche;
- BE-P0-20: durata Oracle legacy separabile dai run comparabili;
- BE-P1-29: il tipo può rappresentare la durata di inferenza, ma il failure-path recording resta responsabilità del client LLM ed è già un punto aperto.

---

## 9. Process vs final patch metrics

`RunQualityMetrics` distingue chiaramente:

- `processPatchGrounding` / `finalPatchGrounding`;
- process/final ungrounded rates;
- `processAddedLines` / `finalAddedLines`;
- `processDeletedLines` / `finalDeletedLines`.

`AggregatedMetricsReport` mantiene anche `averageProcessCodeChurnLines` e `averageFinalCodeChurnLines` separati. Il contratto avvalora BE-P1-13.

---

## 10. Raw vs valid-run convergence

`ModeAggregateMetrics` espone esplicitamente:

- numeratore e denominatore raw;
- `rawConvergenceRatePct`;
- numeratore e denominatore valid-run;
- `validRunConvergenceRatePct`;
- `invalidRunCount`.

Questo avvalora il contratto introdotto da BE-P0-18. `successRatePct` resta presente come campo legacy, coerentemente con la nota del tracker che lo mantiene come alias della raw convergence. Un'eventuale rimozione futura rientra nel già censito BE-P2-12, non richiede un nuovo ticket.

---

## 11. Convergence distribution

La distribuzione usa bucket `1 | 2 | 3 | N_MAX` e dispone separatamente di `convergenceDistributionInvalidRunCount`.

Il tipo consente quindi di rappresentare la semantica di BE-P0-19. La correttezza dell'assegnazione di run ai bucket non è verificabile in questo file e deve restare responsabilità di `TelemetryStorage.ts`.

Nota: il dominio dei bucket è oggi deliberatamente accoppiato al profilo corrente con massimo tre iterazioni. Poiché i limiti sono ora configurabili, l'eventuale generalizzazione del reporting oltre il profilo sperimentale frozen deve essere trattata come evoluzione futura e non come blocker del contratto corrente.

---

## 12. Pairing

`PairedTaskMetrics` contiene `pairKey`, `taskId`, `category`, `modelName`, i due summary e `recoveredAfterRefinement`. Ogni `RunSummary` espone anche `fixtureId` nullable.

Il contratto consente il pairing V2 tramite fixture identity e il fallback legacy tramite dato nullable. La correttezza del `pairKey` e dei criteri di equivalenza effettivi non è dimostrabile qui; il tracker attribuisce tale logica a `TelemetryStorage.ts`.

---

## 13. Autonomous Recovery

`AggregatedMetricsReport` separa:

- eligible pairs;
- infrastructure-excluded pairs;
- other-failure-excluded pairs;
- baseline failures;
- recovery rate.

Questa struttura supporta il requisito BE-P0-17 di non confondere nel denominatore le failure infrastrutturali con baseline validamente non risolte.

---

## 14. Punti del tracker avvalorati da `analytics.ts`

### Chiusi e coerenti con il contratto

- BE-P0-08 — quarantena overhead non difendibili;
- BE-P0-09 — inference timeout in provenance;
- BE-P0-10 — token unavailable distinto da zero;
- BE-P0-11 — artifact schema V2;
- BE-P0-14 — profilo sperimentale completo;
- BE-P0-15 — outcome autonomo vs finalizzazione;
- BE-P0-16 — candidate verification vs run success;
- BE-P0-17 — recovery denominator rappresentabile;
- BE-P0-18 — raw vs valid-run convergence;
- BE-P0-19 — convergence distribution separata dagli invalid;
- BE-P0-20 — Oracle duration comparability;
- BE-P1-12 — naming delle metriche;
- BE-P1-13 — process vs final patch metrics;
- BE-P1-17 — prompt profile provenance;
- BE-P1-18 — experiment limits;
- BE-P1-19 — fixture identity;
- BE-P1-20 — Semgrep profile versionato;
- BE-P1-21 — discriminazione delle versioni artifact.

### Aperti ma non nuovi

- BE-P1-23: invarianti globali di sessione, non risolvibili tramite soli tipi;
- BE-P1-29: durata inferenza nei failure path, problema del producer;
- BE-P1-30: provenance legacy sintetizzata, problema del layer di materializzazione/analytics.

---

## 15. Nuovo finding proposto

### BE-P1-32 — Rendere auditabile `issueSpec` nella Fixture Provenance

**Priorità:** P1  
**Sprint/Area:** P1 - Hardening

**Attività**  
Rendere auditabile l'`issueSpec` che contribuisce alla fixture identity.

**Problema/Rischio**  
`FixtureIdentity.ts` include `issueSpec` nel materiale canonicalizzato e hashato, ma `ExperimentFixtureIdentity` conserva soltanto `id`, `taskId`, `category`, `targetFiles` e `testFiles`. Due artifact consentono quindi di confrontare il digest, ma il profilo V2 non permette di ispezionare direttamente l'`issueSpec` effettivamente associato all'identità. Questo indebolisce l'auditabilità della provenance, pur senza compromettere il determinismo del digest.

**File coinvolti**  
`analytics.ts`; `app.ts`; `TelemetryStorage.ts`; Artifact schema/provenance tests.

**Fix minima**  
Non modificare retroattivamente `StoredRunV2`, che il tracker dichiara frozen. Introdurre il campo in una futura schema version esplicita, oppure definire una provenance referenziale immutabile equivalente che permetta di recuperare/verificare l'issue spec esatto associato al digest senza inventare dati legacy.

**Criterio di chiusura**  
Per i nuovi artifact, ogni fixture identity permette di verificare non soltanto category/path/content identity ma anche l'issue spec esatto che ha contribuito al digest; artifact V1/V2 storici restano leggibili senza backfill sintetici; test di schema evolution e round-trip verdi.

**Stato:** Da fare  
**Completata?:** ☐  
**Data prevista:** 30/10/2026  
**Data completamento:** vuota  
**Owner:** Valeria  
**Note:** emerso durante freeze audit di `analytics.ts`; non riapre BE-P1-19 e deve rispettare BE-P1-21.

---

## 16. Verdetto finale

`analytics.ts` è complessivamente coerente con l'architettura di freeze raggiunta. I principali concetti sperimentali risultano separati e rappresentabili nel type system, e non emergono regressioni che giustifichino la riapertura dei P0/P1 già chiusi.

Il solo nuovo hardening identificato è la mancata persistenza esplicita dell'`issueSpec` nella fixture provenance. Si propone quindi **BE-P1-32**, sfruttando la riga P1 già disponibile nel tracker e rispettando la policy di evoluzione dello schema V2 già congelato.
