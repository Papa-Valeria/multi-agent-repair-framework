# FE Audit 04 - DiagnosticsInspector.tsx

## Esito

Il componente non e ancora congelabile. Il problema principale e semantico: mostra l'assenza di finding come "Conforme" senza conoscere lo status SEMGREP, e riduce il Functional Test a `suitePassed/oracleFailed/timedOut`, nonostante il BE esponga ora `oracleStatus` come stato autoritativo. Questo puo trasformare NOT_AVAILABLE o EXECUTION_ERROR in una rappresentazione visiva simile a un normale fallimento o, per Semgrep, addirittura a conformita.

## Stato attuale

Il componente riceve soltanto:

- `findings`
- `testReport`

Non riceve il risultato Oracle SEMGREP completo. Per il test harness dispone invece di `testReport.oracleStatus`, ma non lo usa come discriminante principale.

## Obiettivo

La diagnostica deve rappresentare fedelmente quattro stati per ogni Oracle: PASS, FAIL, NOT_AVAILABLE, EXECUTION_ERROR. L'assenza di evidenze non deve essere interpretata come PASS. Per Semgrep serve quindi lo status Oracle oltre ai finding; per Functional Test lo status e gia presente nel report e deve guidare badge, testo e dettaglio.

## Fix individuate

### FE-20 - Esporre lo status SEMGREP e non inferire PASS da `findings.length === 0`

La UI mostra "Conforme" quando non ci sono finding. Ma `VerificationInvariants` stabilisce che anche NOT_AVAILABLE ed EXECUTION_ERROR richiedono findings vuoto. Quindi zero finding non prova che Semgrep sia passato.

Fix minima: passare al componente il risultato SEMGREP o almeno `semgrepStatus`; derivare "Conforme" solo da `status === 'PASS'`; rappresentare separatamente FAIL, NOT_AVAILABLE ed EXECUTION_ERROR.

### FE-21 - Usare `testReport.oracleStatus` come stato autoritativo del Test Harness

Il badge attuale combina `timedOut`, `oracleFailed` e `suitePassed`. Il nuovo contratto espone direttamente PASS, FAIL, NOT_AVAILABLE, EXECUTION_ERROR e ne congela le invarianti. La UI deve usare `oracleStatus` come discriminante principale, lasciando `timedOut` e `oracleFailureReason` come dettagli dell'EXECUTION_ERROR.

### FE-22 - Non mostrare metriche test come risultati scientifici validi per NOT_AVAILABLE/EXECUTION_ERROR

Attualmente, se esiste `testReport`, vengono sempre mostrati exit code, pass rate e contatori. Per NOT_AVAILABLE ed errori infrastrutturali i valori zero sono sentinelle strutturali e non una misura di qualita della candidata. Il pannello deve distinguere valori osservati da valori non disponibili.

Fix minima: mostrare pass rate e test counts come risultato della suite solo per PASS/FAIL; per NOT_AVAILABLE ed EXECUTION_ERROR mostrare stato e motivo diagnostico, mantenendo gli eventuali dettagli tecnici separati.

### FE-23 - Rendere visibili xpassed e failure reason

Il riepilogo visualizza xfailed ma omette xpassed, nonostante xpassed partecipi alla strict convergence policy del BE. Inoltre `oracleFailureReason` non viene mostrato direttamente, se non eventualmente attraverso `failureDetails`.

Fix minima: includere `xpassedTests` nel riepilogo PASS/FAIL e mostrare `oracleFailureReason` nei casi EXECUTION_ERROR quando disponibile.

## Punti Excel

### FE-20
ID: FE-20
Priorita: P0
Sprint/Area: FE / Oracle Diagnostics
Attivita: Rappresentare lo stato SEMGREP senza inferirlo dal numero di finding
Problema/Rischio: `findings.length === 0` viene visualizzato come "Conforme", ma anche SEMGREP NOT_AVAILABLE ed EXECUTION_ERROR hanno findings vuoto; la UI puo quindi mostrare un falso PASS.
File coinvolti: DiagnosticInspector.tsx; App.tsx
Fix minima: Passare lo status/risultato SEMGREP al componente e mostrare "Conforme" esclusivamente per `PASS`; rappresentare separatamente FAIL, NOT_AVAILABLE ed EXECUTION_ERROR.
Criterio di chiusura: Per ciascuno dei quattro OracleStatus SEMGREP il badge e il messaggio sono distinti e zero finding non produce automaticamente PASS.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Blocker per correttezza scientifica della diagnostica FE.

### FE-21
ID: FE-21
Priorita: P0
Sprint/Area: FE / Oracle Diagnostics
Attivita: Usare `testReport.oracleStatus` come stato autoritativo del Functional Test
Problema/Rischio: Il badge Test Harness ricostruisce lo stato da `timedOut`, `oracleFailed` e `suitePassed` invece di usare l'OracleStatus congelato dal BE, con rischio di rappresentazioni ambigue tra FAIL, NOT_AVAILABLE ed EXECUTION_ERROR.
File coinvolti: DiagnosticInspector.tsx
Fix minima: Rendere `testReport.oracleStatus` il discriminante principale della UI e usare gli altri campi soltanto come dettagli coerenti con lo status.
Criterio di chiusura: PASS, FAIL, NOT_AVAILABLE ed EXECUTION_ERROR producono quattro rappresentazioni UI corrette e testate.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Allineare test UI alle invarianti di TestExecutionReport.

### FE-22
ID: FE-22
Priorita: P0
Sprint/Area: FE / Research Metrics
Attivita: Separare metriche test osservate da valori non disponibili
Problema/Rischio: Il pannello mostra sempre pass rate e conteggi quando esiste un report; per NOT_AVAILABLE/EXECUTION_ERROR gli zero strutturali possono essere letti come risultati effettivi della suite, contaminando l'interpretazione scientifica.
File coinvolti: DiagnosticInspector.tsx
Fix minima: Visualizzare pass rate e test counts come metriche della candidata solo per PASS/FAIL; per NOT_AVAILABLE/EXECUTION_ERROR mostrare stato e diagnostica, senza presentare gli zero come performance osservata.
Criterio di chiusura: La UI non visualizza 0%/0 test come misura della candidata quando l'Oracle non e disponibile o ha avuto execution error.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Coerente con la distinzione raw/valid e availability introdotta nel BE.

### FE-23
ID: FE-23
Priorita: P1
Sprint/Area: FE / Oracle Diagnostics
Attivita: Completare i dettagli diagnostici del Functional Test
Problema/Rischio: Il riepilogo omette `xpassedTests`, nonostante xpassed impedisca il PASS nella strict policy, e non espone direttamente `oracleFailureReason` per gli errori di esecuzione.
File coinvolti: DiagnosticInspector.tsx
Fix minima: Aggiungere xpassed al riepilogo PASS/FAIL e visualizzare `oracleFailureReason` per EXECUTION_ERROR quando presente.
Criterio di chiusura: Tutti gli outcome che partecipano alla policy (`passed`, `failed`, `errors`, `skipped`, `xfailed`, `xpassed`) sono visibili nei report validi e gli execution error mostrano il motivo diagnostico disponibile.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Non usare questi dettagli per ricalcolare OracleStatus lato FE.
