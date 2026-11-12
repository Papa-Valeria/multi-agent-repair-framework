# Backend Freeze Audit 18 - `TelemetryStorage.ts`

## 1. Scopo

Audit di `TelemetryStorage.ts` nel freeze-check backend, con focus su persistenza artifact, lettura legacy, immutabilita schema, analytics, pairing Baseline/Multi-Agent, provenance sperimentale e semantica delle metriche.

## 2. Sintesi esecutiva

**Esito: PASS CON UN GAP P1 PRE-FREEZE.**

Il percorso di scrittura V2 e robusto: assegna `runId`, costruisce metadata, applica il Persistence Gate prima della scrittura e usa write-temp + rename. `updateRun()` rifiuta V1 e rivalida V2 prima di riscriverlo. Le metriche distinguono correttamente run validi, infrastructure failure e experimental failure; le oracle duration legacy vengono escluse dalle medie comparabili.

E emerso pero un gap importante rispetto a BE-P1-21: `materializeRun()` trasforma i V1 in una rappresentazione V1 normalizzata e `normalizeLegacyV1()` **ricostruisce/inventa valori mancanti usando default correnti o assunzioni**, ad esempio `LEGACY_INFERENCE_TIMEOUT_MS = 120_000`, attribution dell'usage mancante interamente al CODER, REVIEWER usage `0/0 available=true` e ricostruzione dello status/report Pytest. Questi valori possono essere utili per compatibility view, ma oggi sono indistinguibili da dati originariamente osservati. La policy appena formalizzata richiede che provenance/metriche mancanti non vengano retro-applicate come se fossero storiche.

Propongo **BE-P1-30**: separare esplicitamente compatibilita legacy da provenance osservata e rappresentare i dati non dimostrabili come unavailable/non-comparable.

## 3. Persistenza V2

`saveRun()` crea esclusivamente `StoredRunV2`, assegna UUID e timestamp, include `ExperimentProfile`, session con `runId` e target sources.

Prima della scrittura richiama:

```ts
assertStoredRunV2PersistenceInvariants(run)
```

Quindi il file non persiste un nuovo V2 senza passare dal gate gia auditato.

## 4. Scrittura atomica

`writeRun()`:

1. crea la directory;
2. scrive JSON in un file temporaneo univoco;
3. esegue `rename()` verso la destinazione.

Questo evita di lasciare normalmente un artifact finale parzialmente scritto.

## 5. Update run

`updateRun()`:

- richiede un run esistente;
- rifiuta esplicitamente schema diversi da V2;
- conserva `experimentProfile` e timestamp originali;
- rigenera metadata dallo stato aggiornato;
- rivalida l'intero V2 prima della scrittura.

Questa scelta e coerente con la policy di non migrare implicitamente V1 durante un update.

## 6. Reader e schema discrimination

`isStoredRun()` accetta solo schemaVersion 1 o 2. Per V2 richiede la presenza di un oggetto `experimentProfile`.

La validazione di lettura e intenzionalmente piu permissiva del Persistence Gate; i V2 correnti non vengono normalizzati da `materializeRun()`, ma restituiti come memorizzati.

Questo e positivo rispetto al freeze schema V2: il reader non aggiunge `semgrepProfileId`, fixture o altri default ai V2.

## 7. Legacy V1 materialization

`normalizeLegacyV1()` costruisce una compatibility representation per V1:

- normalizza telemetry;
- prova a ricostruire test report da stdout/stderr Pytest;
- ricalcola candidate verification;
- deriva autonomous status;
- aggiunge finalization status quando mancante;
- ricostruisce oracle duration legacy;
- applica un timeout legacy predefinito quando assente.

Il run restituito resta `schemaVersion: 1`, quindi non viene convertito formalmente in V2. Tuttavia alcune proprieta ricostruite vengono presentate nello stesso shape delle proprieta osservate.

## 8. Analytics: outcome e convergence

`aggregateMode()` distingue:

- raw convergence su tutti i run;
- valid-run convergence limitata a `CONVERGED`/`UNRESOLVED`;
- invalid run count (`FAILED` / `INFRASTRUCTURE_ERROR`);
- distribution con conteggio separato dei run invalidi.

La recovery rate usa come eligible baseline gli `UNRESOLVED`; infrastructure e other failure vengono esclusi e contati separatamente.

Questa semantica e coerente con il failure model gia auditato.

## 9. Oracle duration comparability

`toSummary()` marca:

```ts
oracleDurationComparable = run.schemaVersion === 2
```

I V1 ricevono `oracleDurationMs: null` nella summary comparabile e vengono contati come legacy esclusi.

Questa e una scelta scientificamente corretta: anche se viene costruita una durata legacy interna, non viene mescolata alle medie V2.

## 10. Pairing Baseline/Multi-Agent

Le chiavi di pairing includono:

- fixtureId quando disponibile, altrimenti taskId;
- category;
- model name;
- API base URL;
- seed;
- temperature;
- topP;
- inference timeout.

Per ogni chiave viene selezionato il run piu recente per modalita.

L'uso di `fixtureId` per V2 riduce il rischio di confrontare task nominalmente uguali ma con source fixture differenti.

## 11. Gap emerso - materializzazione legacy retro-inferisce dati non osservati

### Evidenze

In assenza di agent usage storico, `normalizeTelemetry()` attribuisce i token/duration al CODER e crea REVIEWER come:

```text
promptTokens = 0
completionTokens = 0
tokenUsageAvailable = true
inferenceDurationMs = 0
```

Inoltre, se `inferenceTimeoutMs` non e finito, usa:

```ts
LEGACY_INFERENCE_TIMEOUT_MS = 120_000
```

`normalizeLegacyV1()` ricostruisce anche `oracleStatus`, conteggi e status session sulla base di output legacy.

### Rischio

Questi valori possono apparire ai consumer come misure/provenance effettivamente osservate nel run originale, mentre sono compatibility assumptions introdotte dal reader corrente.

Questo confligge con il principio formalizzato in BE-P1-21:

> dati/provenance mancanti non devono essere retro-applicati inventando default correnti o storicamente non dimostrabili.

Il problema non e la migration in-place: il file mantiene `schemaVersion: 1`. Il problema e **la perdita di distinzione tra observed e reconstructed/unavailable nel modello materializzato**.

### Fix minima

Non e necessario eliminare la compatibility view. Occorre renderne esplicita la non-comparabilita:

- non assegnare un inference timeout storico arbitrario come se fosse osservato; rappresentarlo come legacy/unavailable nel layer analytics oppure escludere tali V1 dai confronti che richiedono timeout;
- non attribuire implicitamente tutto l'usage al CODER e zero usage al REVIEWER come dato osservato; rendere l'agent attribution unavailable/non-comparable per V1 privi del dato;
- mantenere le ricostruzioni test-report soltanto come `legacy derived` o usarle esclusivamente per compatibility, senza confonderle con evidence V2;
- non riscrivere mai il file V1 originale.

La soluzione esatta dipendera dai tipi disponibili: potrebbe essere necessario aggiungere flag di comparabilita legacy a `RunQualityMetrics` invece di ampliare `StoredRunV1`.

## 12. Nuova riga da aggiungere all'Excel

**ID:** BE-P1-30  
**Priorita:** P1  
**Sprint/Area:** P1 - Hardening  
**Attivita:** Separare dati legacy ricostruiti da provenance e metriche osservate  
**Problema/Rischio:** `TelemetryStorage.normalizeLegacyV1()` e `normalizeTelemetry()` materializzano campi V1 mancanti con assunzioni correnti o sintetiche, tra cui timeout legacy 120000 ms, attribution dell'usage mancante al CODER e REVIEWER usage 0/0 disponibile. Le ricostruzioni mantengono schemaVersion 1 ma possono essere indistinguibili da dati realmente osservati, in contrasto con la policy BE-P1-21 che vieta retro-applicazione di provenance mancante.  
**File coinvolti:** `TelemetryStorage.ts; analytics.ts; documentazione Artifact Schema Evolution; test legacy materialization/analytics comparability`  
**Fix minima:** Conservare i V1 immutati su disco e distinguere esplicitamente nei summary/analytics i valori legacy unavailable o derived. Non assegnare come osservati timeout, agent attribution o altre provenance non presenti nell'artifact originale; escludere i campi non comparabili dalle metriche che li richiedono oppure introdurre flag di comparabilita/derivazione nel layer analytics.  
**Criterio di chiusura:** Un V1 privo di timeout/agent usage continua a essere leggibile senza essere riscritto, ma i campi mancanti non vengono presentati come provenance osservata; pairing/medie che richiedono tali dati li escludono o li marcano non comparabili; V2 resta invariato/frozen; regression test legacy e full suite backend verdi.  
**Stato:** Da fare  
**Completata?:** ☐  
**Data prevista:** Da pianificare  
**Data completamento:** —  
**Owner:** Valeria  
**Note:** Emerso durante freeze audit di `TelemetryStorage.ts`. E un completamento operativo di BE-P1-21: nessuna migrazione distruttiva, nessuna provenance legacy inventata. Non introdurre V3 per correggere la lettura V1.

## 13. Relazione con BE-P1-21

BE-P1-21 resta concettualmente corretto: V2 frozen e nessuna nuova provenance obbligatoria deve essere retro-applicata ai V2.

Il file mostra pero che la stessa policy deve essere applicata anche alla compatibility materialization V1. BE-P1-30 e quindi un hardening attuativo del principio gia deciso, non una modifica della schema evolution policy.

## 14. Relazione con BE-P1-29

`averageInferenceDurationMs` usa la telemetria persistita. Se i failure LLM non vengono registrati dal client, le medie possono essere sottostimate. Quindi BE-P1-29 resta necessario e impatta direttamente le analytics prodotte da questo file.

Nessun nuovo ticket aggiuntivo e necessario.

## 15. Osservazione su `isStoredRun()`

Il reader effettua una validazione minima e non richiama il Persistence Gate sui V2 letti. Questo puo essere intenzionale per compatibilita e recovery, ma significa che un JSON V2 manualmente corrotto puo entrare nel layer analytics fino a eventuali accessi a proprieta mancanti.

Non apro un ticket separato in questa fase: prima va verificata la policy desiderata per reader strict vs writer strict negli artifact docs. Se la documentazione stabilisce che i V2 frozen devono essere sempre validati in lettura, questo puo essere accorpato a BE-P1-30 o a un test schema-evolution, senza creare proliferazione di ticket.

## 16. Punti gia svolti avvalorati

Il file avvalora:

- persistence failure gate prima del write;
- artifact V2 con ExperimentProfile;
- V1 non aggiornabile implicitamente;
- write temp + rename;
- separation autonomous/finalization metadata;
- fixture-based pairing V2;
- oracle duration legacy esclusa dalle medie comparabili;
- recovery/infrastructure failure denominator separation;
- artifact schema V2 non normalizzato in lettura.

## 17. Righe da aggiungere all'Excel

Aggiungere soltanto **BE-P1-30** con i 14 campi riportati nella sezione 12.

Nessun altro nuovo punto da questo file.

## 18. Freeze gates

### G5 - Telemetry Gate

Resta aperto per BE-P1-29 e BE-P1-30. Il modello di aggregazione e nel complesso coerente, ma failure-duration e legacy provenance devono essere resi scientificamente non ambigui.

### Artifact/Provenance Gate

V2 writer e persistence gate sono conformi. La lettura V1 richiede BE-P1-30 per rispettare pienamente il principio "missing remains unavailable".

### G10 - Experimental E2E Gate

Il pairing V2 e ben ancorato alla fixture e al model configuration. I legacy V1 non devono pero entrare in confronti che richiedono provenance ricostruita come se fosse osservata.

## 19. Esito finale

| Area | Esito |
|---|---|
| V2 save + persistence gate | Conforme |
| Atomic write | Conforme |
| V2 update | Conforme |
| V2 frozen read | Conforme |
| Legacy file immutability | Conforme |
| Legacy materialization semantics | Gap P1 |
| Outcome aggregation | Conforme |
| Recovery denominator | Conforme |
| Oracle duration comparability | Conforme |
| V2 fixture pairing | Conforme |
| Nuovi punti Excel | 1 (`BE-P1-30`) |

**Verdetto:** `PASS CON GAP PRE-FREEZE`.

**Prossimo file raccomandato:** `ArtifactPersistenceInvariants.ts`, per completare il persistence/provenance gate e confrontare BE-P1-30 con le garanzie di scrittura correnti.
