# Backend Freeze Audit 06 - `TestHarness.ts`

## 1. Scopo

Audit di `TestHarness.ts` nel freeze-check backend, con focus su:

- semantica `PASS` / `FAIL` / `NOT_AVAILABLE` / `EXECUTION_ERROR`;
- functional oracle task-driven;
- oracle file espliciti e discovery implicita;
- expected exit policy;
- zero-test/parsing/timeout/process failures;
- evidence sperimentale;
- coerenza con `VerificationInvariants.ts`, `OracleDecision.ts` e `RefinementFSM.ts`.

---

## 2. Sintesi esecutiva

**Esito: PASS - nessun nuovo gap bloccante emerso nel file.**

Il producer Functional Test implementa un contratto fail-closed robusto. La configurazione è esterna e viene conservata nell'evidence; l'assenza di configurazione o di oracle file quando la discovery implicita è vietata produce `NOT_AVAILABLE`; timeout, process failure, exit code non interpretabile, output/parsing invalido, zero test e contraddizioni tra exit code e summary producono `EXECUTION_ERROR`; solo una suite strettamente conforme può produrre `PASS`; le non-conformità valide del test suite producono `FAIL`.

La semantica osservata è compatibile con `reportStateViolations()` e `assertFunctionalTestResultInvariants()` già auditati.

Non propongo nuovi punti Excel sulla base di questo file.

---

## 3. Configurazione task-driven

`TestHarness.evaluate()` riceve un `FunctionalTestOracleConfig` opzionale e non hardcoda command, cwd, args, timeout, env allow-list, oracle files o expected exit policy.

Il parser ha un default pytest:

```ts
private readonly resultParser: TestResultParser = pytestResultParser
```

ma è iniettabile tramite il costruttore. Il runner è quindi separato dal parser e il contratto consente profili futuri senza riscrivere la decision logic del TestHarness.

---

## 4. Disponibilità dell'oracle

### 4.1 Config assente

`config === undefined` restituisce `NOT_AVAILABLE` tramite `createNotAvailableResult()`.

Il producer non interpreta l'assenza dell'oracle come PASS.

### 4.2 Oracle file assenti con discovery vietata

Se, dopo trim/filter:

```ts
oracleFiles.length === 0 && !config.allowImplicitDiscovery
```

viene restituito `NOT_AVAILABLE`.

Questo evita discovery silenziosa quando il task contract richiede oracle espliciti.

### 4.3 Discovery implicita

La discovery è considerata usata solo quando `oracleFiles.length === 0`. Il flag `implicitDiscoveryUsed` viene persistito nel report, rendendo osservabile il comportamento effettivo.

---

## 5. Expected exit policy

Il file distingue esplicitamente:

- `passExitCodes`;
- `failExitCodes`;
- `executionErrorExitCodes`;
- exit code inattesi.

L'exit code non viene interpretato isolatamente: viene confrontato anche con il test summary.

Questa strategia impedisce casi pericolosi quali:

- exit code di successo con test failed/errors;
- exit code di failure senza evidenza di test failed/errors;
- exit code classificato come execution error trattato come normale test FAIL;
- exit code non previsto accettato implicitamente.

---

## 6. Semantica `EXECUTION_ERROR`

Vengono classificati come oracle execution failure almeno i seguenti casi:

- timeout;
- `ProcessRunner.executionError`;
- `exitCode === null`;
- nessun output;
- exit code appartenente agli execution-error codes;
- exit code inatteso;
- parser senza summary valido;
- zero test collected;
- exit success ma summary contenente failed/errors;
- exit failure senza reali failed/errors;
- exception imprevista nel boundary `try/catch`.

Questa classificazione è scientificamente corretta: questi casi non costituiscono una normale evidenza negativa sul comportamento del candidato.

---

## 7. Semantica `PASS`

`isSuccess` richiede simultaneamente:

- expected pass exit;
- nessun timeout;
- nessuna oracle failure;
- summary valido;
- almeno un test passed;
- zero failed;
- zero skipped;
- zero xfailed;
- zero xpassed;
- zero errors;
- `passedTests === totalTests`.

Il contratto è quindi intenzionalmente strict e impedisce convergenza con test skipped/xfail/xpass.

---

## 8. Semantica `FAIL`

Se il runner è interpretabile e non esistono condizioni di execution error, una suite non conforme produce `FAIL`.

I failure details distinguono non-conformità della suite da failure funzionale e preservano un messaggio che ricorda che i test sono oracle e che la correzione deve riguardare il target source.

Questa parte è coerente con il modello di immutabilità degli oracle test usato dal framework.

---

## 9. Evidence e riproducibilità

`TestExecutionReport` conserva:

- command;
- args effettivi;
- cwd;
- timeout;
- env allow-list;
- oracle files eseguiti;
- uso della discovery implicita;
- expected exit policy;
- exit code;
- stato suite/oracle;
- conteggi completi;
- pass rate;
- durata;
- failure details;
- stdout/stderr + raw;
- truncation flags;
- execution duration.

Il report è sufficientemente ricco per essere ricontrollato da `VerificationInvariants.ts` senza dipendere dal producer.

---

## 10. Compatibilità con `VerificationInvariants.ts`

I principali contratti producer/invariant coincidono:

- `PASS`: suitePassed true, oracleFailed false, timeout false, almeno un test, tutti passed, passRate 1, expected pass exit;
- `FAIL`: suitePassed false, oracleFailed false, timeout false e policy violation interpretabile;
- `NOT_AVAILABLE`: exit null e counters zero;
- `EXECUTION_ERROR`: suitePassed false e oracleFailed true.

Non emergono contraddizioni tra quanto prodotto dal TestHarness e quanto richiesto dalle invarianti.

---

## 11. Exception boundary

L'intera esecuzione/parsing/classificazione è racchiusa in un `try/catch` che converte exception inattese in `OracleResult<'FUNCTIONAL_TEST'>` con status `EXECUTION_ERROR` e report strutturato.

Questa proprietà evita che un failure interno del TestHarness bypassi direttamente la Terminal State Policy. La FSM riceve un OracleResult osservabile e applica poi le invarianti producer-independent.

---

## 12. Osservazioni non bloccanti

### 12.1 Parser pytest di default

Il default rimane `pytestResultParser`, ma l'interfaccia `TestResultParser` è iniettata. Questo non richiede un ticket pre-freeze; eventuale generalizzazione ulteriore appartiene al post-freeze/configurazione runtime.

### 12.2 `oracleFilesExecuted`

Nel caso di discovery implicita rimane un array vuoto mentre `implicitDiscoveryUsed=true`. Il dato non finge quali file siano stati raccolti, quindi non introduce provenance inventata.

---

## 13. Punti già svolti avvalorati

Il file avvalora il lavoro già completato su:

- zero-test handling;
- configurazione functional oracle task-driven;
- oracle files espliciti;
- expected exit policy;
- distinzione execution failure vs test failure;
- strict convergence policy;
- parser abstraction;
- evidence del comando realmente eseguito.

Nessun punto completato richiede riapertura sulla base del file.

---

## 14. Righe da aggiungere all'Excel

**Nessuna nuova riga.**

Non sono emersi difetti autonomi che richiedano un nuovo ticket.

---

## 15. Freeze Gate G2 - Oracle Integrity Gate

Con questo file risultano auditati positivamente:

- `OracleDecision.ts`;
- `VerificationInvariants.ts` lato oracle;
- `BuildSyntaxOracle.ts`;
- `TestHarness.ts`;
- consumer `RefinementFSM.ts`.

Per chiudere il nucleo dei producer resta `SemgrepEngine.ts`.

---

## 16. Esito finale

| Area | Esito |
|---|---|
| Configurazione task-driven | Conforme |
| Oracle files / discovery | Conforme |
| Expected exit policy | Conforme |
| Zero tests | Conforme fail-closed |
| Timeout/process failure | Conforme |
| PASS strict | Conforme |
| FAIL semantic | Conforme |
| NOT_AVAILABLE semantic | Conforme |
| EXECUTION_ERROR semantic | Conforme |
| Evidence | Conforme |
| Exception boundary | Conforme |
| Coerenza con invarianti | Conforme |
| Nuovi punti Excel | Nessuno |

**Verdetto:** `PASS - nessuna fix richiesta in TestHarness.ts`.

**Prossimo file raccomandato:** `SemgrepEngine.ts`.
