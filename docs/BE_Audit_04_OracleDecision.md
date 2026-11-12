# Backend Freeze Audit 04 - `OracleDecision.ts`

## 1. Scopo

Audit di `OracleDecision.ts` nel freeze-check backend, con focus su:

- completezza del profilo Oracle;
- decisione di convergenza;
- missing/duplicate/mismatch;
- distinzione tra FAIL, NOT_AVAILABLE ed EXECUTION_ERROR;
- coerenza con `VerificationInvariants.ts` e `RefinementFSM.ts` già analizzati;
- Freeze Gate G2 - Oracle Integrity Gate.

---

## 2. Sintesi esecutiva

**Esito: PASS - nessun nuovo gap emerso nel file.**

`DEFAULT_ORACLE_PROFILE` richiede esplicitamente tutti e quattro gli oracle del contratto corrente:

- `APPLICABILITY`;
- `BUILD_SYNTAX`;
- `SEMGREP`;
- `FUNCTIONAL_TEST`.

`decideOracleResults()` è fail-closed: la convergenza richiede una e una sola evidenza PASS per ogni oracle required, con `required=true`, nessun oracle mancante o duplicato, nessun mismatch del flag required, nessun execution error, nessun required unavailable e nessun FAIL.

La funzione separa correttamente gli outcome che consentono refinement (`FAIL`) da quelli che rendono il run non valutabile (`EXECUTION_ERROR`, `NOT_AVAILABLE`, invariant violations).

Non propongo nuovi ticket Excel sulla base di questo file.

---

## 3. Profilo Oracle

Il profilo corrente è esplicitamente identificato da:

```ts
id: "FULL_VERIFICATION_V1"
```

e rende required tutti i quattro oracoli. Il mapping è frozen tramite `Object.freeze()` sia sull'oggetto principale sia su `requirements`.

Questo fornisce una fonte autorevole per stabilire completezza e requiredness del verification contract.

---

## 4. Rilevamento delle violazioni strutturali

### 4.1 Oracle required mancanti

La funzione calcola `missingRequiredOracles` verificando che ciascun oracle required abbia almeno un risultato.

Un missing required contribuisce direttamente a:

```ts
hasInvariantViolation = true
```

Di conseguenza impedisce sia `converged` sia `shouldRefine`.

### 4.2 Oracle duplicati

`duplicateOracles` rileva più risultati per lo stesso nome Oracle dichiarato dal profilo.

La duplicazione viene trattata come invariant violation e non come semplice FAIL sperimentale. Questa scelta è corretta perché una duplicazione rende ambiguo quale evidenza sia autorevole.

### 4.3 Required flag incoerente

`requirementMismatches` confronta il flag `result.required` con la policy del profilo.

Una divergenza viene classificata come invariant violation e impedisce la convergenza.

Questo è coerente con `RefinementFSM.validateApplicabilityRequirement()` e con la filosofia producer-independent delle invarianti.

---

## 5. Classificazione degli outcome required

La funzione separa:

- `FAIL` -> `failedResults`;
- `EXECUTION_ERROR` -> `executionErrors`;
- `NOT_AVAILABLE` -> `requiredUnavailable`.

La distinzione è semanticamente importante:

- un FAIL rappresenta evidenza valida negativa sul candidato e può consentire refinement;
- un execution error rende l'esecuzione dell'oracle non affidabile;
- un required oracle non disponibile impedisce di dimostrare convergenza.

`shouldRefine` è true solo in presenza di almeno un FAIL e in assenza di problemi strutturali, execution error o required unavailable.

---

## 6. Contratto di convergenza

`allRequiredPassed` richiede, per ogni oracle required:

```text
esattamente 1 risultato
status = PASS
required = true
```

`converged` aggiunge le ulteriori condizioni:

- nessuna invariant violation;
- nessun execution error;
- nessun required unavailable;
- nessun failed required result;
- tutti i required passed.

Questo rende la convergenza fail-closed e non permette convergenza parziale.

### Caso zero required oracle

`allRequiredPassed` richiede esplicitamente:

```ts
requiredOracleNames.length > 0
```

quindi un profilo senza required oracle non converge vacuamente. È una protezione corretta.

---

## 7. Interazione con i file già analizzati

### Con `VerificationInvariants.ts`

`VerificationInvariants.ts` ricalcola la decisione da `verdict.oracleResults` e verifica che `verified` coincida con `decision.converged` nella verifica completa.

Quindi `OracleDecision.ts` è effettivamente la fonte decisionale, mentre il verdict non può dichiararsi autonomamente verificato.

### Con `RefinementFSM.ts`

La FSM usa `decision.converged`, `decision.shouldRefine`, `hasExecutionError`, `hasRequiredUnavailable` e `hasInvariantViolation`, delegando poi l'outcome terminale alla Terminal State Policy.

Non risultano incompatibilità tra questo decision contract e i consumer già analizzati.

---

## 8. Osservazioni non bloccanti

### 8.1 Profilo custom con chiavi incomplete

La funzione assume che `OracleProfile.requirements` sia già un contratto valido. La verifica strutturale del tipo/profile non appartiene necessariamente a `decideOracleResults()` e non rappresenta un bug di questo file.

### 8.2 Unexpected oracle

Risultati relativi a nomi Oracle validi ma non elencati nel profilo non contribuiscono ai required results. Nel contratto corrente `DEFAULT_ORACLE_PROFILE` elenca tutti gli OracleName usati dal backend, quindi non emerge un problema concreto da registrare nel freeze audit.

---

## 9. Punti già svolti avvalorati

Il file supporta direttamente la chiusura dei punti già lavorati relativi a:

- completezza degli oracle required;
- gestione required/unavailable;
- detection di missing e duplicate oracle;
- enforcement `required` coerente col profilo;
- convergenza basata sul set completo degli oracle;
- distinzione failure sperimentale vs execution/invariant failure.

Nessun punto già segnato come completato richiede riapertura sulla base di `OracleDecision.ts`.

---

## 10. Righe da aggiungere all'Excel

**Nessuna nuova riga.**

Non sono emersi bug o hardening autonomi che giustifichino un nuovo BE-P1/P2. Le osservazioni residue sono già coperte dagli audit dei consumer e dai gate di freeze.

---

## 11. Freeze Gate G2 - Oracle Integrity Gate

### Stato dopo questo file

**Fortemente avvalorato, ma non ancora formalmente chiuso.**

Evidenza accumulata finora:

- `VerificationInvariants.ts`: controlli producer-independent su Build, Semgrep, Functional Test e verdict;
- `OracleDecision.ts`: completezza dei quattro oracle, detection missing/duplicate/mismatch, distinzione FAIL/NOT_AVAILABLE/EXECUTION_ERROR, convergenza fail-closed;
- `RefinementFSM.ts`: consumer della decisione e delle invarianti.

Per la chiusura definitiva restano da auditare i producer:

1. `BuildSyntaxOracle.ts`;
2. `TestHarness.ts`;
3. `SemgrepEngine.ts`.

---

## 12. Esito finale

| Area | Esito |
|---|---|
| Profilo Oracle versionato | Conforme |
| Required oracle completeness | Conforme |
| Missing required detection | Conforme |
| Duplicate detection | Conforme |
| required mismatch detection | Conforme |
| FAIL classification | Conforme |
| EXECUTION_ERROR classification | Conforme |
| NOT_AVAILABLE classification | Conforme |
| Convergenza fail-closed | Conforme |
| shouldRefine semantics | Conforme |
| Nuovi punti Excel | Nessuno |

**Verdetto:** `PASS - nessuna fix richiesta in OracleDecision.ts`.

**Prossimo file raccomandato:** `BuildSyntaxOracle.ts`.
