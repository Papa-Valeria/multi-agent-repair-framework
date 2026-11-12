# Backend Freeze Audit 03 - `VerificationInvariants.ts`

## 1. Scopo

Audit di `VerificationInvariants.ts` nel freeze-check backend, con focus su integrità producer-independent di oracle, verdict, telemetria e stato finale.

## 2. Sintesi esecutiva

**Esito: PASS CON GAP P1 PRE-FREEZE.**

Il file è solido sui contratti locali di `BUILD_SYNTAX`, `SEMGREP`, `FUNCTIONAL_TEST`, sulla coerenza `VerificationVerdict` e sulla provenance Reviewer. Il controllo `CONVERGED` richiama correttamente la verifica completa e impedisce `verified=true` senza una `OracleDecision.converged` coerente.

È però emerso un gap importante sul contratto globale di `WorkbenchSessionState`: per stati diversi da `CONVERGED`, `assertWorkbenchSessionInvariants()` non verifica che `candidateVerified`, `autonomousRunSucceeded`, `status`, `autonomousStatus`, `currentIteration/maxIterations` siano coerenti tra loro e con l'ultima iterazione. Alcune di queste incoerenze vengono intercettate più tardi dal Persistence Gate, ma il boundary finale della FSM (`publishFinalState`) usa proprio questa funzione. Quindi uno stato contraddittorio potrebbe essere pubblicato prima della persistenza.

Propongo un nuovo punto P1, separato dal BE-P1-22 già emerso su `RefinementFSM.ts`.

---

## 3. Contratti correttamente implementati

### 3.1 Telemetria e token

`appendTokenUsageViolations()` applica il contratto:

- usage disponibile -> token interi non negativi;
- usage indisponibile -> entrambi i conteggi null.

`assertComputationalTelemetryInvariants()` valida inoltre tutte le principali durate come finite e non negative e valida l'usage dei ruoli `CODER` e `REVIEWER`.

Questo avvalora i punti di hardening su token usage e telemetria già svolti.

### 3.2 Functional Test Oracle

`reportStateViolations()` verifica in modo dettagliato:

- conteggi non negativi;
- `totalTests` uguale alla somma degli outcome;
- `passRate` coerente;
- durate finite e non negative;
- semantica differenziata per `PASS`, `FAIL`, `NOT_AVAILABLE`, `EXECUTION_ERROR`;
- coerenza con `expectedExitPolicy` per PASS/FAIL.

`assertFunctionalTestResultInvariants()` verifica inoltre che `OracleResult.status` coincida con `report.oracleStatus`.

### 3.3 Build/Syntax Oracle

`assertBuildSyntaxResultInvariants()` impone contratti espliciti per ogni stato:

- PASS -> exit 0, no timeout, no execution error;
- FAIL -> exit non-null e non-zero, no timeout/execution error;
- NOT_AVAILABLE -> exit null, no timeout/execution error;
- EXECUTION_ERROR -> evidenza concreta di failure di esecuzione.

Questo avvalora BE-P1-05.

### 3.4 Semgrep Oracle

`assertSemgrepResultInvariants()` impone:

- PASS -> zero findings e almeno un file scansionato;
- FAIL -> almeno un finding e almeno un file;
- NOT_AVAILABLE -> nessun finding/file e nessun execution error;
- EXECUTION_ERROR -> findings vuoti e `executionError` non vuoto.

Questo avvalora BE-P1-06.

### 3.5 VerificationVerdict

Il verdict viene confrontato strutturalmente con le fonti autorevoli:

- `verdict.testReport` deve coincidere con il report del `FUNCTIONAL_TEST` quando unico;
- `verdict.sastFindings` deve coincidere con i findings Semgrep;
- `verdict.semgrepDurationMs` deve coincidere con la durata Semgrep;
- `verified=true` non è ammesso senza convergenza;
- con `requireCompleteVerification=true`, `verified` deve coincidere esattamente con `decision.converged`.

Questo è un forte controllo contro divergenza tra dati derivati e risultati oracle.

---

## 4. Integrità della sessione

### 4.1 Reviewer provenance

Per ogni iterazione viene imposto:

- feedback presente <-> `reviewerMode` presente;
- `fallbackReason` solo con `DETERMINISTIC_FALLBACK`;
- fallback deterministico richiede reason non vuota;
- `LLM` e `ORCHESTRATOR` non consentono fallback reason.

Questo supporta BE-P0-28.

### 4.2 Stato `CONVERGED`

Per `state.status === 'CONVERGED'`:

- è obbligatoria almeno un'iterazione;
- l'ultima verification viene validata in modalità completa;
- `verification.verified` deve essere true.

Poiché la decision completa viene ricalcolata da `oracleResults`, un `CONVERGED` non può essere accettato senza una convergenza Oracle effettiva.

---

## 5. Gap emerso

### WorkbenchSessionState non è validato globalmente per tutti gli stati terminali

`assertWorkbenchSessionInvariants()` applica il contratto forte solo quando:

```ts
state.status === 'CONVERGED'
```

Non verifica invece globalmente almeno queste relazioni:

1. `state.status === state.autonomousStatus` nel risultato autonomo;
2. `state.candidateVerified === (finalIteration?.verification.verified === true)`;
3. `state.autonomousRunSucceeded === (state.autonomousStatus === 'CONVERGED' && state.candidateVerified)`;
4. `state.currentIteration === state.iterations.length`;
5. `state.currentIteration <= state.maxIterations`;
6. sessione non-CONVERGED con `candidateVerified=true` o `autonomousRunSucceeded=true` contraddittori;
7. coerenza di un eventuale `finalPatch` con l'ultima candidata, dove il contratto lo richiede.

Il Persistence Gate contiene già parte di queste verifiche, ma `RefinementFSM.publishFinalState()` chiama `assertWorkbenchSessionInvariants()` prima della persistenza. Il boundary runtime dovrebbe impedire che uno stato contraddittorio venga pubblicato, non delegare tutta la protezione alla persistenza successiva.

### Perché è un punto distinto da BE-P1-22

BE-P1-22 riguarda failure path che possono uscire senza uno stato strutturato. Questo gap riguarda invece **uno stato strutturato ma internamente incoerente** che potrebbe superare il producer-independent boundary.

---

## 6. Fix minima proposta

Estendere `assertWorkbenchSessionInvariants()` senza cambiare i producer:

- validare sempre `currentIteration`, `iterations.length` e `maxIterations`;
- validare `candidateVerified` rispetto all'ultima verification;
- validare `autonomousRunSucceeded` rispetto a `autonomousStatus` e `candidateVerified`;
- validare la coerenza tra `status` e `autonomousStatus` per lo stato autonomo pre-finalizzazione;
- mantenere il controllo completo degli oracle per `CONVERGED`;
- aggiungere regression test su stati terminali contraddittori.

L'obiettivo è mantenere una sola fonte producer-independent per il contratto runtime della sessione e non duplicare logica di business nella FSM.

---

## 7. Nuova riga da aggiungere all'Excel

**ID:** BE-P1-23  
**Priorità:** P1  
**Sprint/Area:** P1 - Hardening  
**Attività:** Rafforzare le invarianti globali di WorkbenchSessionState  
**Problema/Rischio:** `assertWorkbenchSessionInvariants()` valida in modo forte la verifica Oracle quando `status=CONVERGED`, ma non controlla globalmente la coerenza tra `status`, `autonomousStatus`, `candidateVerified`, `autonomousRunSucceeded`, `currentIteration`, `iterations.length` e `maxIterations`. Uno stato terminale strutturato ma contraddittorio può quindi superare `publishFinalState()` ed essere pubblicato prima dell'eventuale rejection del Persistence Gate.  
**File coinvolti:** `VerificationInvariants.ts; test VerificationInvariants/WorkbenchSessionState; RefinementFSM.ts come consumer`  
**Fix minima:** Estendere `assertWorkbenchSessionInvariants()` con invarianti globali su contatore iterazioni, budget, candidate verification e successo autonomo, mantenendo la convalida Oracle completa per `CONVERGED` e senza duplicare la decision logic nella FSM.  
**Criterio di chiusura:** Stati con `currentIteration != iterations.length`, iterazioni oltre `maxIterations`, `candidateVerified` incoerente con l'ultima verification, `autonomousRunSucceeded` incoerente con `autonomousStatus/candidateVerified` o outcome autonomi contraddittori vengono rifiutati da `assertWorkbenchSessionInvariants()`; gli stati validi Baseline e Multi-Agent continuano a passare; regression suite backend verde.  
**Stato:** Da fare  
**Completata?:** ☐  
**Data prevista:** Da pianificare  
**Data completamento:** —  
**Owner:** Valeria  
**Note:** Emerso durante freeze audit di `VerificationInvariants.ts`. Rafforza G1/G2 e allinea il boundary runtime alle invarianti già parzialmente presenti nel Persistence Gate. Da chiudere prima del freeze finale P0/P1.

---

## 8. Punti già svolti avvalorati

Il file fornisce evidenza favorevole per i punti già completati relativi a:

- invarianti Build/Syntax;
- invarianti Semgrep;
- completezza e coerenza del Functional Test report;
- decisione Oracle producer-independent;
- coerenza `VerificationVerdict`;
- telemetria finita/non-negativa;
- token usage null/available;
- provenance Reviewer.

Non emerge necessità di riaprire questi ticket sulla base del file analizzato.

---

## 9. Freeze gates

### G1 - Terminal State Gate

Resta aperto. `VerificationInvariants.ts` non protegge ancora tutte le combinazioni contraddittorie di stato terminale. Il gap è registrato come BE-P1-23, oltre a BE-P1-22 emerso nella FSM.

### G2 - Oracle Integrity Gate

Il file fornisce evidenza forte a favore del gate: producer oracle e verdict sono ricontrollati indipendentemente. La chiusura definitiva richiede ancora l'audit di `OracleDecision.ts` e dei producer `BuildSyntaxOracle.ts`, `TestHarness.ts`, `SemgrepEngine.ts`.

### G5 - Telemetry Gate

Il file valida semanticamente token e durate ma non può dimostrare da solo correttezza temporale o accumulo. G5 resta subordinato a `TelemetryTracker.ts` e ai test.

---

## 10. Esito finale

| Area | Esito |
|---|---|
| Build/Syntax invariants | Conforme |
| Functional Test invariants | Conforme |
| Semgrep invariants | Conforme |
| VerificationVerdict invariants | Conforme |
| Reviewer provenance | Conforme |
| Telemetry shape/value invariants | Conforme |
| CONVERGED completeness | Conforme |
| Global WorkbenchSessionState consistency | Gap P1 |
| Nuovi punti Excel | 1 (`BE-P1-23`) |

**Verdetto:** PASS CON GAP PRE-FREEZE.

**Prossimo file raccomandato:** `OracleDecision.ts`, per completare il nucleo del Gate G2 prima di analizzare individualmente i producer Oracle.
