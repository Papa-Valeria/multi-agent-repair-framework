# Backend Freeze Audit 02 - `RefinementFSM.ts`

## 1. Scopo

Analisi completa di `RefinementFSM.ts` rispetto al tracker backend, con particolare attenzione a:

- **G1 - Terminal State Gate**;
- **G2 - Oracle Integrity Gate**;
- **G3 - Workspace Isolation Gate**;
- **G5 - Telemetry Gate**;
- **G10 - Experimental E2E Gate**;
- punti già dichiarati completati che coinvolgono direttamente la FSM.

Il file è stato valutato come orchestratore autorevole dei percorsi Baseline e Multi-Agent.

---

## 2. Sintesi esecutiva

**Esito complessivo: PASS CON DUE RISCHI RESIDUI DA REGISTRARE.**

La FSM usa sistematicamente `TerminalStatePolicy` per derivare gli outcome autonomi, conserva la `TerminalStateResolution` completa, separa `candidateVerified` da `autonomousRunSucceeded`, esegue rollback transazionale nei principali failure path, applica limiti sperimentali iniettati e sottopone lo stato finale alle invarianti producer-independent prima della pubblicazione.

Non risultano assegnazioni autonome terminali divergenti da `resolveTerminalState()`. Questo avvalora BE-P0-01, BE-P0-02 e BE-P0-03 anche dal lato consumer della policy.

Sono però emersi due failure path eccezionali non completamente strutturati:

1. nel percorso **Baseline**, una exception sollevata da `evaluateApplicability()` o da `computePatchHash()` può uscire da `runBaseline()` senza produrre un `WorkbenchSessionState` terminale;
2. nel percorso Reviewer, il controllo `reviewResult === undefined` solleva una exception fuori dal relativo `try/catch`, quindi l'eventuale violazione runtime non viene classificata come `REVIEWER_FAILURE`.

Il primo punto è materialmente rilevante per G10 e va aggiunto al tracker come hardening pre-freeze. Il secondo può essere accorpato allo stesso punto oppure registrato come sottocaso.

---

## 3. Verifica del Terminal State Gate

### 3.1 Nessuna assegnazione terminale autonoma locale

Gli stati terminali di `runBaseline()`, `runLoop()` e `createFailureState()` derivano da:

```ts
this.resolveTerminalResolution(...)
```

che delega integralmente a:

```ts
resolveTerminalState(...)
```

Gli oggetti finali copiano poi:

```ts
status: terminalResolution.status
autonomousStatus: terminalResolution.status
```

Non sono presenti rami che assegnano direttamente `CONVERGED`, `UNRESOLVED`, `FAILED` o `INFRASTRUCTURE_ERROR` come decisione terminale autonoma.

### 3.2 Reason canonica preservata

La reason viene conservata nella `TerminalStateResolution` e trasformata in testo tramite:

```ts
describeTerminalState(terminalResolution, terminalFailure)
```

Questo avvalora direttamente BE-P0-03.

### 3.3 Fallback senza evidenze

Alla fine di `runLoop()`:

```ts
const resolvedTerminalState =
  terminalResolution ??
  this.resolveTerminalResolution({});
```

Il contesto vuoto viene quindi affidato alla policy, che lo classifica come infrastructure error. Non viene ricostruito localmente come output sperimentale fallito.

### 3.4 Precedenza rollback failure

Nei percorsi che applicano una patch, un eventuale rollback failure sostituisce correttamente la failure precedente:

```ts
if (rollbackFailure) {
  terminalFailure = rollbackFailure;
}
```

La risoluzione terminale successiva riceve quindi `ROLLBACK_FAILURE`, producendo un run non riuscito anche se la candidata era verificata.

### Valutazione G1

**A livello di codice, G1 risulta soddisfatto.** La chiusura formale del gate richiede soltanto il rerun della suite completa già prevista dal freeze-check.

---

## 4. Verifica Oracle Integrity

### 4.1 Applicability required

`validateApplicabilityRequirement()` confronta il flag prodotto con:

```ts
DEFAULT_ORACLE_PROFILE.requirements.APPLICABILITY
```

Una discrepanza viene classificata come:

```text
ORACLE_INVARIANT_FAILURE
```

### 4.2 Oracle post-apply

`evaluateAppliedPatch()` esegue:

1. `BUILD_SYNTAX`;
2. `SEMGREP`;
3. `FUNCTIONAL_TEST`.

`createVerificationVerdict()` aggiunge `APPLICABILITY`, ottenendo il set completo dei quattro oracle richiesti.

### 4.3 Invarianti producer-independent

Subito dopo ciascun producer vengono richiamate:

- `assertBuildSyntaxResultInvariants()`;
- `assertSemgrepResultInvariants()`;
- `assertFunctionalTestResultInvariants()`.

Sul verdetto aggregato viene inoltre applicata:

```ts
assertVerificationVerdictInvariants(
  verdict,
  DEFAULT_ORACLE_PROFILE,
  true
);
```

### 4.4 Convergenza

Il campo:

```ts
verified: decision.converged
```

è calcolato dalla decisione Oracle e successivamente validato. Lo stato terminale `CONVERGED` viene richiesto alla Terminal State Policy, non assegnato direttamente.

### Valutazione G2

Il file supporta correttamente il criterio G2: una candidata convergente deriva da quattro oracle completi, validati e coerenti. Chiusura definitiva subordinata alla verifica di `OracleDecision.ts` e `VerificationInvariants.ts`.

---

## 5. Baseline e Multi-Agent

### 5.1 Information contract iniziale

Entrambi i percorsi invocano:

```ts
contextBuilder.buildInitialPayload(params)
```

prima della generazione Coder. Questo è coerente con BE-P0-26 sulla parità del contesto iniziale.

### 5.2 Differenza intenzionale dei budget

La FSM non hardcoda i budget. Usa:

```ts
this.limits.maxIterations
this.limits.maxTechnicalAttempts
```

Il percorso Baseline viene limitato a una singola iterazione dal composition root mediante limiti effettivi `1/1`; la FSM conserva il valore iniettato nello stato.

### 5.3 Refinement Multi-Agent

Il percorso iterativo gestisce:

- retry tecnici di Applicability;
- normalizzazione della patch rifiutata;
- feedback Reviewer;
- remediation cumulative;
- stagnazione/flapping;
- rollback prima del refinement successivo;
- limiti semantici e tecnici separati.

Questo è coerente con BE-P1-18 e con i test `RefinementFSMLimits.test.ts` già registrati nel tracker.

---

## 6. Failure model osservato

### 6.1 Failure Coder tipizzate

La classificazione usa tipi concreti:

- `CoderOutputExtractionError` -> `DIFF_EXTRACTION_FAILURE`;
- `CoderModelInvocationError` -> `MODEL_GENERATION_FAILURE`;
- altro -> `UNKNOWN_FAILURE`.

Non viene effettuato parsing del testo del messaggio. BE-P1-01 risulta correttamente avvalorato.

### 6.2 Failure di contesto

- initial context -> `CONTEXT_BUILD_FAILURE`;
- refinement context -> `REFINEMENT_CONTEXT_FAILURE`.

Entrambe sono infrastrutturali e terminano tramite policy.

### 6.3 Failure Oracle

- producer throw o errore di esecuzione -> `ORACLE_EXECUTION_FAILURE`;
- contraddizione/invariante -> `ORACLE_INVARIANT_FAILURE`;
- required unavailable -> `UNRESOLVED / REQUIRED_ORACLE_UNAVAILABLE` tramite policy.

### 6.4 Patch application

Un errore di apply viene classificato come `PATCH_APPLICATION_FAILURE`; nei percorsi Multi-Agent segue rollback transazionale e risoluzione terminale strutturata.

### 6.5 Stagnazione

Il riuso di un hash già valutato con remediation cumulative attive produce:

```text
REFINEMENT_STAGNATION
```

con feedback orchestrator esplicito e `flappingDetected: true`.

---

## 7. Telemetria

### 7.1 Misure CPU orchestration

Le operazioni di orchestrazione sono racchiuse da:

```ts
startCpuMeasurement()
recordOrchestrationCpu(...)
```

con `finally`, inclusi Coder, Reviewer, context building, Applicability, apply, rollback e oracle invocation overhead.

### 7.2 Snapshot dopo i finally

Nei principali failure path gli snapshot vengono acquisiti dopo la chiusura della misura. Nei casi in cui una failure avviene dopo la creazione dell'ultimo record, `refreshLatestIterationTelemetry()` riallinea telemetria e agent usage.

Questo avvalora BE-P0-07.

### 7.3 Oracle duration

Le durate native vengono registrate per:

- Applicability;
- Build/Syntax;
- Semgrep;
- Functional Test.

Il file non calcola percentuali di overhead o metriche scientificamente non difendibili.

### 7.4 Semantica IterationRecord

`iteration.telemetry` usa `TelemetryTracker.getSnapshot()`, quindi conserva uno snapshot cumulativo; `agentUsage` è ottenuto da `getIterationAgentUsage()`. Questo è coerente con BE-P1-09.

---

## 8. Provenance Reviewer

La FSM valida e registra:

- `LLM`;
- `DETERMINISTIC_FALLBACK`;
- `ORCHESTRATOR`.

Regole osservate:

- fallback deterministico richiede `fallbackReason` non vuota;
- modalità LLM non può dichiarare `fallbackReason`;
- feedback sintetico per generation/applicability failure è marcato `ORCHESTRATOR`.

Questo avvalora BE-P0-28.

---

## 9. Workspace isolation e rollback

### 9.1 Inizializzazione transazionale

Prima dell'esecuzione viene registrato l'HEAD iniziale e verificato il working tree clean.

### 9.2 Safe rollback

`safeRollback()`:

- fallisce se l'HEAD iniziale non è disponibile;
- conserva `rollbackResult`;
- trasforma rollback incompleto o exception in `ROLLBACK_FAILURE`;
- registra CPU in `finally`.

### 9.3 Rollback prima del refinement

Dopo una patch applicata ma non convergente, il repository viene ripristinato prima di costruire il payload successivo.

### Valutazione G3

Il comportamento orchestrativo è coerente, ma G3 richiede anche l'audit di `GitManager.ts`, `RepositoryPathPolicy.ts` e dei test di contamination/partial write.

---

## 10. Rischi e difetti emersi

## Nuovo punto A - Baseline non struttura tutte le exception di Applicability/hash

### Evidenza

Nel percorso Baseline:

```ts
const patchHash = this.gitManager.computePatchHash(patchDiff);
```

non è protetto da un boundary di failure.

Anche:

```ts
applicability = await this.gitManager.evaluateApplicability(...)
```

è dentro un `try/finally`, ma non dentro un `catch` che produca `ORACLE_EXECUTION_FAILURE` o altra failure strutturata.

Se una delle due operazioni solleva un'exception, `runBaseline()` rigetta la Promise. Il composition root potrà restituire HTTP 500, ma non verrà necessariamente prodotto un `WorkbenchSessionState` terminale con failure, autonomousStatus e terminationReason.

### Impatto

- G1: il terminal path eccezionale non raggiunge la policy;
- G10: un failure path Baseline può non produrre artifact/stato coerente;
- osservabilità: il run può uscire dal modello sperimentale strutturato.

### Fix minima proposta

- catturare `computePatchHash()` e `evaluateApplicability()` nel percorso Baseline;
- mappare l'exception a una categoria strutturata coerente;
- costruire iteration record/failure state;
- risolvere lo stato tramite `resolveTerminalState()`;
- aggiungere test mirato Baseline.

### Priorità proposta

**P1 - pre-freeze hardening**, perché incide sui failure path e sul gate E2E.

---

## Nuovo punto B - Reviewer result assente può uscire senza failure strutturata

### Evidenza

Dopo il blocco `try/catch` della review è presente:

```ts
if (reviewResult === undefined) {
  throw new Error(
    'Invariante interna violata: risultato Reviewer assente dopo una review completata.'
  );
}
```

L'eccezione viene sollevata fuori dal `catch` che classifica `REVIEWER_FAILURE`.

### Impatto

Il caso è improbabile con implementazione TypeScript conforme, ma una regressione runtime o un mock scorretto può far uscire `runLoop()` senza stato finale strutturato.

### Fix minima proposta

Integrare il controllo nel boundary della review oppure trasformarlo direttamente in `ExecutionFailure` `REVIEWER_FAILURE`, seguendo lo stesso percorso già usato per gli altri errori Reviewer.

### Trattamento tracker consigliato

Accorpare questo sottocaso al nuovo punto A come **completezza dei failure boundary della FSM**, evitando due ticket quasi duplicati.

---

## 11. Punti tracker già svolti avvalorati

Il file fornisce evidenza diretta o forte per:

- BE-P0-01 - centralizzazione stati terminali;
- BE-P0-02 - fallback tramite policy;
- BE-P0-03 - reason canonica;
- BE-P0-07 - snapshot dopo i finally;
- BE-P0-16 - candidate verification separata dal run success;
- BE-P0-25 - rollback orchestrato dopo apply failure;
- BE-P0-26 - stesso initial context contract;
- BE-P0-27 - context build failure fail-closed;
- BE-P0-28 - reviewer provenance;
- BE-P1-01 - errori Coder tipizzati;
- BE-P1-05 - Build invariants al boundary;
- BE-P1-06 - Semgrep invariants al boundary;
- BE-P1-09 - snapshot telemetry cumulativo;
- BE-P1-18 - limiti iniettati e applicati a runtime.

Lo stato `Completata` di questi punti resta supportato.

---

## 12. Aggiornamenti da aggiungere all'Excel

### Nuova riga Backlog BE proposta

- **ID:** `BE-P1-22`
- **Priorità:** `P1`
- **Sprint/Area:** `P1 - Hardening`
- **Attività:** `Completare i failure boundary della RefinementFSM`
- **Problema/Rischio:** `Nel percorso Baseline, exception di computePatchHash/evaluateApplicability possono uscire senza WorkbenchSessionState terminale; il controllo reviewResult assente è fuori dal boundary REVIEWER_FAILURE.`
- **File coinvolti:** `RefinementFSM.ts; test FSM Baseline/Reviewer`
- **Fix minima:** `Catturare i failure eccezionali nei boundary interessati, mapparli a ExecutionFailure strutturate e instradarli attraverso TerminalStatePolicy senza riscrivere la FSM.`
- **Criterio di chiusura:** `Ogni exception di hash/applicability nel Baseline e ogni risultato Reviewer assente produce uno stato terminale strutturato, reason canonica e nessun rigetto non gestito della FSM.`
- **Stato:** `Da fare`
- **Completata?:** `☐`
- **Data prevista:** lasciare da pianificare secondo il ciclo corrente
- **Owner:** `Valeria`
- **Note:** `Emerso durante freeze audit di RefinementFSM.ts. Richiesti regression test mirati prima della chiusura G1/G10.`

### Freeze Gates

#### G1 - Terminal State Gate

- **Valutazione codice:** PASS;
- **Stato tracker consigliato:** mantenere `Da fare` finché BE-P1-22 non è risolto e la full suite non è verde;
- **Evidenza/Test da aggiungere:**

```text
Audit TerminalStatePolicy.ts + RefinementFSM.ts: tutti i normali terminal path derivano da TerminalStatePolicy e preservano la reason canonica. Resta un gap sui failure boundary eccezionali Baseline/Reviewer, registrato come BE-P1-22.
```

#### G2 - Oracle Integrity Gate

- **Valutazione FSM:** parzialmente avvalorato;
- **Evidenza provvisoria:**

```text
RefinementFSM costruisce il verdetto da Applicability + Build/Syntax + Semgrep + Functional Test, applica invariant producer-independent e usa OracleDecision per la convergenza. Chiusura subordinata all'audit di OracleDecision.ts e VerificationInvariants.ts.
```

#### G10 - Experimental E2E Gate

- **Valutazione:** non chiudibile;
- **Nota:** il nuovo BE-P1-22 riguarda un failure path Baseline che può non produrre stato/artifact coerente.

---

## 13. Esito finale

| Area | Esito |
|---|---|
| Terminal state normali | Conforme |
| Reason canonica | Conforme |
| Oracle aggregation | Conforme |
| Oracle invariants | Conforme nel consumer |
| Limiti refinement runtime | Conforme |
| Reviewer provenance | Conforme, salvo boundary `undefined` |
| Rollback orchestration | Conforme |
| Telemetria failure path | Conforme nei rami gestiti |
| Completezza failure boundary | Da correggere |
| Nuovi punti Excel | 1 (`BE-P1-22`) |

**Verdetto:** `PASS CON GAP PRE-FREEZE`.

Il file non richiede una riscrittura architetturale. È necessaria una correzione locale dei failure boundary prima di chiudere G1 e G10.

**Prossimo file raccomandato:** `VerificationInvariants.ts`, per completare l'audit del Gate G2 prima di passare ai producer Oracle.
