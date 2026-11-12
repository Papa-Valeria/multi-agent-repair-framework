# Backend Freeze Audit 17 - `TelemetryTracker.ts`

## 1. Scopo

Audit di `TelemetryTracker.ts` nel freeze-check backend, con focus su:

- accumulo di token e durate LLM;
- semantica `tokenUsageAvailable`;
- separazione usage cumulativo/per-iterazione;
- CPU orchestration telemetry;
- oracle duration;
- total wall-clock duration;
- compatibilita con `VerificationInvariants.ts`, `OpenAICompatibleClient.ts` e `RefinementFSM.ts`.

## 2. Sintesi esecutiva

**Esito: PASS - nessun nuovo ticket autonomo.**

Il tracker implementa correttamente accumulo cumulativo e per agente, invalida globalmente i conteggi token se anche una sola chiamata non fornisce usage, conserva comunque le durate di inferenza, usa CPU process time per l'orchestration overhead e wall-clock per il tempo complessivo. Gli snapshot sono copie e non espongono lo stato mutabile interno.

L'audit conferma e rende piu precisa la fix gia proposta come **BE-P1-29**: `TelemetryTracker.recordLLMUsage()` e gia tecnicamente in grado di registrare un tentativo fallito con `promptTokens=null`, `completionTokens=null` e durata valida. Quindi il gap e nel caller `OpenAICompatibleClient`, non nel modello dati del tracker.

## 3. Token usage contract

`recordLLMUsage()` valida separatamente i token quando presenti e considera l'usage completo soltanto quando entrambi i conteggi sono disponibili.

Se uno dei due e `null`:

- `tokenUsageAvailable` cumulativo diventa `false`;
- lo stesso avviene per l'agente corrente e la relativa iteration usage;
- i conteggi parziali non vengono sommati;
- la durata di inferenza viene comunque sommata prima del return.

Questo e coerente con il contratto producer-independent gia verificato in `VerificationInvariants.ts`.

## 4. Semantica cumulativa dei token

Una volta che una chiamata rende l'usage indisponibile, il flag cumulativo resta false per l'intero run. `getSnapshot()` restituisce quindi `promptTokens` e `completionTokens` null, evitando di presentare come totale completo una somma parziale.

La stessa semantica viene mantenuta per singolo ruolo e per iteration usage.

Questo conferma il precedente hardening sulla rappresentazione `null/unavailable`.

## 5. Durata inferenza

La durata viene sommata indipendentemente dalla disponibilita dei token:

```ts
this.inferenceDurationMs += durationMs
```

ed e attribuita sia all'usage cumulativo dell'agente sia all'usage della current iteration.

Quindi il tracker supporta gia il requisito di BE-P1-29: una chiamata fallita puo essere registrata con token null e durata reale senza introdurre nuove API obbligatorie.

## 6. Iteration usage

`startIteration()` resetta soltanto:

```ts
this.iterationAgentUsage
```

Non resetta accumuli globali, oracle duration o orchestration CPU.

`getIterationAgentUsage()` restituisce quindi usage locale della semantic iteration corrente, mentre `getSnapshot()` restituisce telemetry cumulativa del run.

Questo e coerente con la semantica gia osservata nella FSM e avvalora BE-P1-09.

## 7. Orchestration CPU

`startCpuMeasurement()` usa `process.cpuUsage()` e `recordOrchestrationCpu()` calcola il delta user+system convertito da microsecondi a millisecondi.

La metrica rappresenta dunque CPU process time, non wall-clock overhead. Questo e coerente con `orchestrationOverheadBasis: NODE_PROCESS_CPU` presente nel persistence model gia auditato.

Non vengono calcolate percentuali di overhead non difendibili.

## 8. Oracle duration

`recordOracleDuration()` accetta soltanto numeri finiti e non negativi e somma le duration native degli oracle.

La FSM gia auditata invoca questo metodo dopo Applicability, Build, Semgrep e Functional Test.

## 9. Total duration

`startRun()` puo essere invocato una sola volta. `getSnapshot()` calcola:

```ts
performance.now() - startWallClock
```

quando il run e stato avviato, altrimenti restituisce zero.

Questa metrica e wall-clock e resta semanticamente separata dalle CPU duration e dalle durate LLM/oracle accumulate.

## 10. Snapshot immutability

`copyAgentUsage()` costruisce nuovi oggetti `AgentUsage`; gli snapshot non espongono `MutableAgentUsage` direttamente.

Questo impedisce al consumer di mutare gli accumulatori interni del tracker attraverso l'oggetto restituito.

## 11. Validazione input numerici

Le durate devono essere finite e non negative; i token devono essere interi non negativi quando presenti.

Il tracker fallisce esplicitamente su NaN, Infinity, valori negativi o token frazionari, coerentemente con le invarianti e con il Persistence Gate.

## 12. Relazione con BE-P1-29

L'audit di `OpenAICompatibleClient.ts` ha rilevato che i failure prima del parsing successful response non chiamano `recordLLMUsage()`.

Questo file dimostra che **non serve modificare necessariamente TelemetryTracker** per chiudere il problema: la chiamata seguente e gia valida e semanticamente corretta:

```ts
recordLLMUsage(role, null, null, failedAttemptDurationMs)
```

### Aggiornamento consigliato alla riga BE-P1-29

**Fix minima:** precisare che la modifica primaria puo restare in `OpenAICompatibleClient.completeChat()`: usare un guard/finally/catch per invocare `recordLLMUsage(role, null, null, durationMs)` sui failure avvenuti prima della registrazione successful, garantendo esattamente una registrazione per attempt. Modificare `TelemetryTracker.ts` solo se serve un helper per evitare doppio conteggio, non per cambiare il contratto dati.

**Note:** `TelemetryTracker.ts` auditato PASS; supporta gia duration con usage null. Il gap BE-P1-29 e nel caller, non nell'accumulatore.

## 13. Osservazioni non bloccanti

### 13.1 Rounding

Le durate cumulative vengono arrotondate a due decimali nello snapshot, mentre gli accumulatori interni mantengono precisione maggiore. Questa scelta e deterministica e coerente per tutti i consumer; non emerge un motivo per modificarla pre-freeze.

### 13.2 `startIteration()` prima di `startRun()`

Il tracker non impone un ordine fra questi due metodi. Nel composition root/FSM gia auditati `startRun()` viene chiamato prima dell'esecuzione e `startIteration()` all'inizio delle iterazioni. Non emerge un nuovo runtime path da registrare come P1.

## 14. Punti gia svolti avvalorati

Il file avvalora:

- BE-P0-07 - snapshot telemetry aggiornati dopo i finally, lato modello accumulatore;
- BE-P0-08 - CPU orchestration mantenuta come diagnostica, non percentuale scientifica;
- BE-P0-10 - usage mancante come null/unavailable;
- BE-P1-09 - IterationRecord basato su snapshot cumulativo con agent usage per iterazione;
- separazione CODER/REVIEWER usage.

Nessun punto completato richiede riapertura dal solo file.

## 15. Righe da aggiungere all'Excel

**Nessuna nuova riga.**

Aggiornare solo **BE-P1-29** come specificato nella sezione 12.

## 16. Freeze Gate G5 - Telemetry Gate

Il tracker stesso e staticamente conforme. G5 resta aperto per:

1. BE-P1-29 nel client di inferenza;
2. audit di `TelemetryStorage.ts` / analytics per verificare che le metriche conservino la stessa semantica in persistenza e aggregazione;
3. full regression suite finale.

## 17. Esito finale

| Area | Esito |
|---|---|
| Token validation | Conforme |
| Missing usage semantics | Conforme |
| Cumulative token semantics | Conforme |
| Agent attribution | Conforme |
| Iteration usage reset | Conforme |
| Inference duration accumulation | Conforme |
| Oracle duration | Conforme |
| CPU orchestration | Conforme |
| Total wall-clock | Conforme |
| Snapshot isolation | Conforme |
| Supporto BE-P1-29 | Gia presente |
| Nuovi punti Excel | Nessuno |

**Verdetto:** `PASS - nessuna fix autonoma richiesta in TelemetryTracker.ts; aggiornare BE-P1-29 indicando che il gap e nel caller OpenAICompatibleClient.`

**Prossimo file raccomandato:** `TelemetryStorage.ts`.
