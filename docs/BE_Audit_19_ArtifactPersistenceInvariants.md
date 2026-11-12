# Backend Freeze Audit 19 - `ArtifactPersistenceInvariants.ts`

## 1. Scopo

Audit del Persistence Gate V2 con focus su identita run, profili sperimentali, limiti, fixture provenance, metadata, telemetria e coerenza con gli audit di `VerificationInvariants.ts` e `TelemetryStorage.ts`.

## 2. Sintesi esecutiva

**Esito: PASS CON UN GAP P1 PRE-FREEZE, da accorpare a BE-P1-23.**

Il gate V2 e complessivamente rigoroso: valida schemaVersion, run/task/category/status, profili Oracle/Prompt/Semgrep, configurazione modello, execution configs, exit policy, limiti, fixture, metadata e telemetria. Inoltre impedisce persistenza di numeri non finiti.

Non emerge un nuovo ticket autonomo. Emerge pero una lacuna gia concettualmente coperta da **BE-P1-23**: `maxIterations` viene confrontato con la sessione, ma il gate non verifica direttamente `session.currentIteration <= session.maxIterations`; inoltre `maxTechnicalAttempts` viene controllato solo quando `iteration.technicalAttempts` e presente. Queste regole devono diventare invarianti globali del `WorkbenchSessionState`, non nuove regole isolate del Persistence Gate.

## 3. Schema V2

Il gate accetta esclusivamente `schemaVersion === 2`. Non effettua migrazioni ne normalizzazioni legacy.

Questo e coerente con il writer di `TelemetryStorage`: il Persistence Gate governa i nuovi artifact V2, mentre la compatibilita V1 resta un problema separato di lettura.

## 4. Run identity

Sono richiesti e confrontati:

- `metadata.runId`;
- `session.runId`;
- taskId metadata/session;
- category metadata/session;
- status metadata/session.

Un artifact non puo quindi persistere due identita divergenti per lo stesso run.

## 5. Session invariants composition

Il gate richiama prima:

```ts
assertWorkbenchSessionInvariants(run.session, DEFAULT_ORACLE_PROFILE)
```

ed incapsula eventuali violation come `SESSION_INVARIANTS`.

Questa composizione e architetturalmente corretta: lo stato runtime viene controllato dal proprio boundary e poi il persistence layer aggiunge invarianti specifiche dell'artifact.

Il gap globale di `assertWorkbenchSessionInvariants()` resta quello gia registrato in BE-P1-23.

## 6. Model config

Sono validati:

- seed finito, intero, non negativo;
- temperature [0,2];
- topP (0,1];
- inference timeout intero tra 1000 e 600000 ms;
- baseUrl/modelName non vuoti.

Il `profile.modelConfig` deve poi coincidere esattamente col `modelConfig` top-level.

## 7. Profile provenance

Il gate verifica in modo esplicito:

```text
oracleProfileId  == DEFAULT_ORACLE_PROFILE.id
promptProfileId  == DEFAULT_PROMPT_PROFILE.id
semgrepProfileId == DEFAULT_SEMGREP_PROFILE.id
```

Questo avvalora i lavori precedenti su provenance Oracle, Prompt e Semgrep e impedisce che il V2 dichiari un profile ID diverso dal framework corrente.

## 8. Execution config

Build, Functional Test e Semgrep config devono avere command non vuoto, timeout positivo ed env allow-list valida e priva di duplicati.

Build/Functional aggiungono poi controlli specifici su args/cwd; Functional valida anche oracleFiles, allowImplicitDiscovery ed expected exit policy.

## 9. Expected exit policy

Le tre classi di exit code:

- pass;
- fail;
- execution error

devono essere non vuote, contenere interi non negativi, non avere duplicati interni e non sovrapporsi globalmente.

Questo rende persistibile soltanto una policy deterministica.

## 10. Experiment limits

`maxIterations` e `maxTechnicalAttempts` devono essere interi positivi.

`profile.limits.maxIterations` deve coincidere con `session.maxIterations`.

Per ogni iteration, se `technicalAttempts` e presente, non puo superare `maxTechnicalAttempts`.

### Gap gia coperto da BE-P1-23

Manca una verifica esplicita:

```text
session.currentIteration <= session.maxIterations
```

Il gate controlla `currentIteration === iterations.length`, ma non il budget upper bound.

Inoltre un iteration record senza `technicalAttempts` non viene dichiarato incoerente, anche nei percorsi per cui il dato dovrebbe esistere.

Non apro BE-P1-31: queste sono invarianti del `WorkbenchSessionState` e vanno incluse in BE-P1-23.

## 11. Fixture identity

Il fixture ID deve avere formato SHA-256 esadecimale; taskId e category devono coincidere con la sessione.

Target/test files vengono confrontati come insiemi normalizzati e le chiavi `targetSources` devono coincidere con i fixture target files.

Il gate verifica quindi la **coerenza interna** della fixture identity.

La verifica crittografica che `fixture.id` sia effettivamente il digest ri-calcolato dai source/issue/test input non appartiene a questo file, perche `StoredRunV2` persiste soltanto `targetSources`, non tutti gli input necessari alla ricostruzione. Il composition root genera l'identita prima della persistenza. Non apro un ticket separato senza prima auditare `FixtureIdentity.ts`.

## 12. Metadata/autonomous semantics

Il gate verifica:

- autonomousStatus presente;
- metadata.autonomousStatus == session.autonomousStatus;
- metadata.status conserva l'outcome autonomo;
- finalizationStatus coerente;
- candidateVerified coerente;
- autonomousRunSucceeded coerente;
- resolutionVerified == autonomousRunSucceeded;
- human augmentation solo per APPROVED.

Questa parte e piu forte dell'attuale `assertWorkbenchSessionInvariants()` ed e precisamente il motivo per cui BE-P1-23 deve spostare le core state invariants anche nel boundary runtime.

## 13. Telemetria

Il Persistence Gate verifica:

- token pair disponibili/non disponibili;
- token integer/non-negative;
- durate finite/non-negative;
- agent usage;
- somma CODER+REVIEWER quando cumulative usage e disponibile;
- metadata durations identiche alla cumulative telemetry;
- `orchestrationOverheadBasis = NODE_PROCESS_CPU`;
- total tokens coerenti.

Questo e compatibile con `TelemetryTracker.ts` gia auditato.

## 14. Non-finite deep scan

A fine validazione viene effettuata una scansione ricorsiva dell'intero artifact per rifiutare NaN/Infinity anche in campi non raggiunti dai controlli dedicati.

E una protezione utile per la serializzazione JSON e l'integrita scientifica dell'artifact.

## 15. Target sources

`targetSources` deve essere una mappa; le chiavi devono essere stringhe non vuote e senza NUL; i contenuti devono essere stringhe.

Il file non ricalcola il containment path dei nomi, ma la corrispondenza con `fixture.targetFiles` e il composition root gia confinato riducono la duplicazione di path policy nel persistence layer.

## 16. Aggiornamento BE-P1-23

Aggiornare la riga **BE-P1-23 - Rafforzare le invarianti globali di WorkbenchSessionState** come segue.

**Problema/Rischio:** aggiungere che il Persistence Gate verifica `currentIteration === iterations.length`, ma non `currentIteration <= maxIterations`; il runtime boundary deve inoltre chiarire quando `technicalAttempts` e obbligatorio e verificarne il limite rispetto all'ExperimentProfile.

**File coinvolti:** `VerificationInvariants.ts; ArtifactPersistenceInvariants.ts; test WorkbenchSessionState/Persistence; RefinementFSM.ts come consumer`.

**Fix minima:** includere nelle invarianti globali anche `currentIteration <= maxIterations`; definire la presenza/semantica di `technicalAttempts` per gli IterationRecord prodotti dai percorsi applicabili e mantenere nel Persistence Gate la verifica contro `experimentProfile.limits.maxTechnicalAttempts`.

**Criterio di chiusura:** oltre ai criteri gia definiti, una sessione che supera `maxIterations` viene rifiutata prima della pubblicazione/persistenza; iteration technical attempts incoerenti col contratto/limite vengono rifiutati senza alterare i percorsi che legittimamente non hanno un tentativo tecnico.

**Note:** `ArtifactPersistenceInvariants.ts` auditato: il persistence layer contiene gia parte delle state invariants; BE-P1-23 deve rendere il boundary runtime almeno coerente sulle invarianti core, evitando che uno stato invalido venga pubblicato e fallisca solo in persistenza.

## 17. Relazione con BE-P1-30

Questo file non normalizza V1 e non inventa provenance legacy. BE-P1-30 resta interamente sul reader/materialization path di `TelemetryStorage.ts` e sul modello analytics legacy.

Non serve modificare il Persistence Gate V2 per risolvere BE-P1-30.

## 18. Righe da aggiungere all'Excel

**Nessuna nuova riga.**

Aggiornare soltanto la riga gia proposta **BE-P1-23** con le integrazioni della sezione 16.

## 19. Freeze gates

### Persistence / Provenance Gate

Il writer V2 e il gate di persistenza risultano staticamente solidi. Profile IDs, model config, fixture, limits, metadata e telemetry sono cross-validated.

### G1/G2

BE-P1-23 resta aperto perche alcune core state invariants vengono intercettate solo qui, troppo tardi rispetto a `publishFinalState()`.

### G5

Il gate e coerente col TelemetryTracker. Restano BE-P1-29 e BE-P1-30 per completezza della raccolta e semantica legacy.

## 20. Esito finale

| Area | Esito |
|---|---|
| Schema V2 | Conforme |
| Run identity | Conforme |
| Model config | Conforme |
| Oracle profile provenance | Conforme |
| Prompt profile provenance | Conforme |
| Semgrep profile provenance | Conforme |
| Execution configs | Conforme |
| Exit policy | Conforme |
| Experiment limits | Conforme con gap core gia BE-P1-23 |
| Fixture internal consistency | Conforme |
| Metadata/session consistency | Conforme |
| Telemetry persistence invariants | Conforme |
| Non-finite rejection | Conforme |
| Nuovi punti Excel | Nessuno |

**Verdetto:** `PASS - nessun nuovo ticket; aggiornare BE-P1-23 con currentIteration <= maxIterations e technicalAttempts contract.`

**Prossimo file raccomandato:** `FixtureIdentity.ts`, per verificare che l'ID fixture validato qui sia realmente costruito in modo canonico e riproducibile dagli input sperimentali.
