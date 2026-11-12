# BE Audit 29 — domain.ts

## 1. Esito sintetico

**Valutazione complessiva: PASS con un nuovo hardening P1 proposto.**

`domain.ts` formalizza in modo ampio e coerente lo stato della sessione, i risultati degli oracle, la telemetry, gli errori tipizzati, la provenance del reviewer, il rollback e gli eventi di streaming. Il file riflette correttamente gli hardening già svolti su terminal-state model, verification invariants, agent usage, remediation provenance e oracle evidence.

Emerge però un gap nel contratto della telemetria: `ComputationalTelemetry.oracleDurationMs` è obbligatorio e non nullable, mentre nel contratto analytics auditato precedentemente la durata Oracle è stata esplicitamente resa nullable/comparabile per evitare che valori legacy o non misurabili entrino nelle medie scientifiche come misure valide. Il dominio runtime non può quindi rappresentare direttamente una durata Oracle “non disponibile/non comparabile”; può soltanto fornire un numero. Questo crea pressione verso valori sentinella o sintetici prima della persistenza.

## 2. Oracle model

`OracleEvidenceMap` lega ogni oracle alla propria evidence specifica e `OracleResultMap` conserva la correlazione tipizzata tra nome dell'oracle ed evidence. Questo evita un generico union payload scollegato dal discriminante `oracle`.

Gli status distinguono `PASS`, `FAIL`, `NOT_AVAILABLE` ed `EXECUTION_ERROR`, separando indisponibilità infrastrutturale/esecutiva da fallimento della verifica.

## 3. Build/Syntax evidence

`BuildSyntaxOracleEvidence` conserva comando, args, cwd, timeout, allow-list, exit code, timeout, stdout/stderr, truncation ed execution error. La struttura è coerente con il contratto corrente di `ProcessRunner` e rende osservabile l'evidence necessaria senza ridurre tutto a un booleano.

## 4. Functional Test evidence

`TestExecutionReport` conserva configuration provenance, exit policy, file oracle eseguiti, discovery implicita, exit code, outcome della suite, categorie test, pass rate, durata, failure details, stdout/stderr e truncation.

La shape consente di distinguere `oracleStatus`, `suitePassed`, `oracleFailed`, `timedOut` ed eventuale `oracleFailureReason`. Il fatto che esistano campi semanticamente correlati richiede invarianti runtime, ma tali invarianti sono già responsabilità dei componenti dedicati analizzati in precedenza e non viene creato un duplicato dal solo type file.

## 5. Reviewer provenance

`ReviewerMode` distingue `LLM`, `DETERMINISTIC_FALLBACK` e `ORCHESTRATOR`. `ReviewerReviewResult` abbina feedback, modalità e possibile `fallbackReason`.

Il contratto supporta quindi esplicitamente la provenance del reviewer e non costringe a inferire a posteriori se l'output provenga dal modello o dal fallback deterministico.

## 6. Remediation tracking

`TargetRemediation` e `CumulativeRemediation` rappresentano remediation strutturate e relativo ciclo di osservazione (`firstObservedIteration`, `lastObservedIteration`, `observationCount`). L'identificatore `key` consente la deduplicazione/provenance cumulativa già introdotta nell'hardening Reviewer/Coder.

## 7. Telemetry agent-specific

`AgentUsage` rappresenta token nullable, availability esplicita e inference duration. `ComputationalTelemetry.agentUsage` usa un `Record<AgentRole, AgentUsage>` con ruoli `CODER` e `REVIEWER`.

Il contratto evita quindi di interpretare automaticamente token indisponibili come zero.

## 8. Nuovo finding: Oracle duration obbligatoria nel dominio runtime

`ComputationalTelemetry` dichiara:

`readonly oracleDurationMs: number;`

Nel contratto analytics auditato, `RunQualityMetrics.oracleDurationMs` è invece `number | null` ed è accompagnato da `oracleDurationComparable`. Questa distinzione è stata introdotta proprio per separare misure scientificamente comparabili da valori legacy/non disponibili.

Il domain model runtime non dispone di un equivalente per rappresentare l'assenza/non-comparabilità della misura. Se un percorso non dispone di una durata Oracle attendibile, il producer deve comunque materializzare un `number` prima che il dato raggiunga il layer analytics.

Il rischio non è che il type dimostri oggi una formula errata, ma che il boundary renda rappresentabile soltanto una misura numerica apparentemente valida, incoraggiando `0` o valori sintetici nei failure/legacy path.

## 9. Fix minima proposta

Allineare il contratto runtime al principio già presente negli analytics. Possibili implementazioni minime:

- rendere `oracleDurationMs` nullable e conservare esplicitamente la comparabilità/disponibilità; oppure
- introdurre un tipo discriminato equivalente che distingua valore misurato e misura non disponibile.

La modifica deve essere propagata ai producer/consumer senza sintetizzare valori per i dati legacy e senza reintrodurre durate non comparabili nelle medie.

## 10. Criterio di chiusura tecnico

Il dominio runtime deve poter rappresentare esplicitamente un'oracle duration non disponibile/non comparabile senza utilizzare `0` o altro valore sentinella. I consumer analytics devono continuare a includere nelle medie soltanto le durate dichiarate comparabili. I regression test relativi a TelemetryTracker/TelemetryStorage e ai failure path devono restare verdi.

## 11. Session state e terminal-state model

`WorkbenchSessionState` distingue:

- stato attivo/terminale;
- `autonomousStatus`;
- `finalizationStatus`;
- `candidateVerified`;
- `autonomousRunSucceeded`;
- human augmentation;
- failure/termination reason;
- rollback result.

Il contratto è coerente con il modello terminale già formalizzato. La presenza di optionals non viene trattata come bug del type system: le combinazioni lecite devono essere enforceate dalle invarianti runtime già analizzate.

## 12. Error model

`ExecutionFailure` combina fase, categoria, messaggio, error name opzionale, iteration/oracle opzionali e `recoverable`. Le categorie coprono in modo esplicito context build, model generation, diff, scope/apply, oracle, reviewer, refinement, rollback, persistence, infrastructure e unknown failure.

Questo mantiene la failure provenance tipizzata anziché affidarsi al solo testo dell'errore.

## 13. Rollback provenance

`RollbackResult` conserva stato, HEAD iniziale/finale, pulizia repository, working-tree status e messaggio opzionale. È una shape coerente con la necessità di rendere auditabile il cleanup repository dopo l'esecuzione.

## 14. Stream events

`WorkbenchStreamEvent` è una discriminated union per phase transition, oracle progress, telemetry update e iteration complete. Il modello non altera lo stato scientifico persistito e costituisce un contratto di emissione separato.

## 15. Tracker Excel

### Nuovo punto da aggiungere

**BE-P1-34 — Rappresentare Oracle duration non disponibile nel domain model.**

### Perché non duplica i punti precedenti

Il finding è distinto dal lavoro già svolto sulla comparabilità analytics: quel lavoro protegge aggregazione/persistenza, mentre questo punto chiude il gap a monte nel contratto `ComputationalTelemetry`, impedendo che il runtime sia costretto a rappresentare sempre una durata numerica.

## 16. Verdetto finale

`domain.ts` è complessivamente coerente con l'architettura hardenizzata. Il principale gap residuo è l'asimmetria tra `ComputationalTelemetry.oracleDurationMs: number` e la semantica nullable/comparable consolidata nel layer analytics. Si propone pertanto **BE-P1-34**; non emergono altri nuovi ticket dal file.
