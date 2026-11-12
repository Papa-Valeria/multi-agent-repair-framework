# FE Audit 02 - App.tsx

## Sintesi

`App.tsx` è ancora costruito attorno a una semantica precedente del backend in almeno tre aree: finalizzazione (`status` usato come APPROVED/REJECTED), ricostruzione del workspace leggendo il repository corrente anziché la sorgente della fixture, e configurazione/model provenance incompleta rispetto al contratto sperimentale corrente. Il run principale usa già `executionMode`, invia Build/Functional config esplicite e gestisce gli outcome autonomi principali, quindi non serve una riscrittura totale: serve separare correttamente stato autonomo, finalizzazione e replay, quindi riallineare la materializzazione dei file.

## Stato attuale

### Aspetti già allineati

- Usa `executionMode: BASELINE | MULTI_AGENT` nella request `/execute`.
- Mantiene internamente il profilo Python/pytest senza esporre comandi tecnici nella UI.
- Invia esplicitamente Build/Syntax e Functional Test Oracle config.
- Supporta `REPAIR` e `CREATE`.
- Gestisce gli outcome autonomi `CONVERGED`, `UNRESOLVED`, `FAILED`, `INFRASTRUCTURE_ERROR` nel completamento del run.
- Espone telemetria di iterazione e cumulativa ai componenti dedicati.
- Supporta replay dei run archiviati.
- Usa `run.targetSources` nel bootstrap del replay, evitando di inventare il sorgente originale.

## Gap rispetto al backend congelato

### FE-02 - Stato di finalizzazione rappresentato nel campo sbagliato

Dopo approve il FE esegue localmente `status: 'APPROVED'`; dopo reject esegue `status: 'REJECTED'`. Nel backend congelato `status`/`autonomousStatus` preservano l'outcome autonomo (`CONVERGED`, `UNRESOLVED`, `FAILED`, `INFRASTRUCTURE_ERROR`) e la decisione umana vive in `finalizationStatus` (`NOT_FINALIZED`, `APPROVED`, `REJECTED`).

Questo è il mismatch principale del file. Può corrompere la rappresentazione client dello stato scientifico, rompere componenti tipizzati contro `WorkbenchSessionState` aggiornato e nascondere l'outcome autonomo dopo la finalizzazione.

Fix minima: dopo approve/reject aggiornare `finalizationStatus`, `approvalCommitHash`, `isHumanAugmented`, `finalPatch` dove applicabile, ma non sovrascrivere `status` e `autonomousStatus`. Anche `currentPhase`, `SessionHeader`, `ActionToolbar` e `PatchWorkspace.readOnly` devono usare separatamente outcome autonomo e finalizzazione.

### FE-03 - La response di approve non restituisce la sessione aggiornata

`callFinalization()` ricostruisce localmente uno stato parziale dalla response `{ commitHash, ... }`. Il backend mantiene invece una sessione aggiornata con finalization status e provenance.

La fix minima, senza cambiare il BE, è aggiornare localmente soltanto i campi deterministici restituiti/conosciuti: `finalizationStatus: 'APPROVED'`, `approvalCommitHash`, `isHumanAugmented`, eventuale `finalPatch`. Non cambiare l'outcome autonomo. Valutare nei consumer se serva una GET/session endpoint; non è richiesta dal solo file attuale.

### FE-04 - Workspace live ricostruito dal repository dopo rollback

`updateWorkspace()` legge ogni `fileDiff.file` tramite `/api/files/read` e usa quel contenuto come `originalContent`. La FSM backend effettua rollback all'HEAD iniziale dopo la valutazione, quindi per run live questo può funzionare quando il repository è rimasto invariato, ma rende la visualizzazione dipendente dallo stato filesystem corrente anziché dalla fixture che ha prodotto l'esperimento.

Il BE V3 persiste `targetSources`; il FE dovrebbe preferire sorgenti appartenenti al run/fixture quando disponibili, soprattutto in replay. Per l'esecuzione live `App.tsx` conserva soltanto `originalCode` del target principale, non uno snapshot di tutti i target coinvolti. È necessario introdurre uno snapshot FE dei target prima del run oppure ottenere i sorgenti autoritativi persistiti dal run dopo la persistenza.

### FE-05 - Human Override limitato al singolo file selezionato e full-replacement diff

`handleHumanOverride()` produce una patch di sostituzione completa per `selectedFilePath || targetFile`. Il backend consente patch che possono interessare più target (e CREATE può creare più file autorizzati). La UI attuale non rappresenta un override multi-file atomico e rischia di perdere modifiche su altri file della candidata.

Fix minima: definire esplicitamente che Human Override opera su un solo file autorizzato alla volta oppure costruire un unico diff aggregato da tutti i `WorkspaceFile` modificati. Dato il nuovo backend multi-file, la seconda opzione è quella coerente con il workspace.

### FE-06 - `createFullReplacementDiff()` è un generatore diff fragile

Il diff viene generato manualmente con conteggi basati su `split('\\n')`, incluso il trailing empty element. Casi di file vuoto, newline finale e `CREATE` possono produrre hunk non canonici o inutilmente massivi. Il backend ora applica gate Applicability rigorosi, quindi questa funzione diventa un punto di failure evitabile.

Fix minima: usare la stessa utility diff del dominio se disponibile oppure creare/testare un generatore Unified Diff corretto per file esistente, file vuoto, no-final-newline e nuovo file `/dev/null`.

### FE-07 - `executionMode` viene perso nel replay

`handleReplay()` imposta `executionMode(null)` anche se `run.metadata.mode` contiene il valore autoritativo. La UI quindi non preserva fedelmente la provenance BASELINE/MULTI_AGENT durante il replay.

Fix minima: `setExecutionMode(run.metadata.mode)`.

### FE-08 - Replay non ripristina `taskCategory`

`handleReplay()` ripristina task, issue, modello e target, ma non `taskCategory`. Un run CREATE aperto dopo una sessione REPAIR può quindi essere mostrato con modalità UI errata.

Fix minima: `setTaskCategory(run.metadata.category)`.

### FE-09 - Replay non ripristina il file di test/profilo fixture completo

Il replay usa soltanto `run.session.targetFiles[0]`; non aggiorna `testFile` dalla sessione e non materializza immediatamente tutti i target. Questo è incompatibile con il modello multi-file presente nel BE.

Fix minima: almeno ripristinare `testFile` da `run.session.testFiles[0]` e materializzare `WorkspaceFile[]` dai file presenti nella patch/targetSources senza assumere un solo target.

### FE-10 - Parametro `inferenceTimeoutMs` non inviato dalla UI

Il BE/model profile corrente include `inferenceTimeoutMs` nella comparabilità, nel pairing e nel persistence profile. `App.tsx` invia `apiBaseUrl`, `modelIdentifier`, `seed`, `temperature`, `topP`, ma non `inferenceTimeoutMs`, affidandosi quindi al default dello schema BE.

Questo non è necessariamente un errore runtime, ma rende invisibile nel FE una dimensione sperimentale che il BE considera parte della configurazione comparabile. La fix minima, coerente con la scelta corrente di UI semplificata, è mantenere un valore hardcoded esplicito lato FE oppure documentare intenzionalmente che viene usato il default BE. Se deve essere riproducibile dalla request, inviarlo esplicitamente.

### FE-11 - Parsing SSE usa shape locali non derivate da `WorkbenchStreamEvent`

Gli handler SSE definiscono cast manuali (`{ iteration; state }`, `{ tool; findingsCount }`) invece di sfruttare il discriminated union condiviso. Dopo il consolidamento BE degli eventi, questo aumenta il rischio di drift silenzioso.

Fix minima: introdurre helper/type guards basati su `WorkbenchStreamEvent` o sui payload esportati dal contratto condiviso e gestire JSON malformato senza far fallire callback non controllate.

### FE-12 - Race tra risposta HTTP `/execute` e `ITERATION_COMPLETE` SSE

Sia la response HTTP sia l'evento SSE scrivono `session`, `statusMessage`, `currentPhase` e `isRunning`. È possibile ricevere i due segnali in ordine differente. Con lo stato terminale più ricco del nuovo BE, due writer indipendenti rendono più fragile la UI.

Fix minima: definire una fonte autoritativa per il completamento. Ad esempio HTTP come risultato finale e SSE come progress-only, oppure deduplicare `ITERATION_COMPLETE` sulla stessa sessione/run.

### FE-13 - `sseListeners` lato BE supporta un listener per task; il FE ricrea EventSource legato a `isRunning`

L'effetto apre/chiude lo stream ogni volta che `isRunning` cambia. Il pattern può perdere l'ultimo evento mentre la response HTTP sta chiudendo il run. È collegato a FE-12 e va risolto nello stesso intervento, non come nuova architettura indipendente.

### FE-14 - Gestione locale `isHumanAugmented` errata nell'ActionToolbar

Il prop è calcolato come `session.status === 'CONVERGED' && session.isHumanAugmented`. Dopo il nuovo BE, Human Override può essere approvato partendo anche da `UNRESOLVED` o `FAILED`. Una sessione human-augmented approvata non deve essere annullata solo perché l'outcome autonomo non era CONVERGED.

Fix minima: basarsi su `session.finalizationStatus === 'APPROVED' && session.isHumanAugmented === true`.

### FE-15 - Condizioni di `readOnly`, approve e reject usano `status` per finalizzazione

`PatchWorkspace.readOnly` verifica `session?.status === 'APPROVED' || 'REJECTED'`; `ActionToolbar.isApproved` fa lo stesso. Ora devono utilizzare `finalizationStatus`.

Inoltre `canReject` deve combinare stato autonomo finalizzabile con `finalizationStatus === 'NOT_FINALIZED'`, evitando pulsanti incoerenti dopo approve/reject.

### FE-16 - UI configurazione ancora single-target/single-test

Il BE e i tipi usano `targetFiles[]` e `testFiles[]`; `App.tsx` mantiene due stringhe singole `targetFile` e `testFile` e crea array di un elemento. Questo limita CREATE e task multi-file e impedisce di rappresentare completamente fixture e manifest Oracle.

Fix minima: migrare stato e controlli UI a liste di target/test, mantenendo eventualmente editor semplice per il primo file ma inviando/manipolando l'intero manifest.

## Nota sugli URL presenti nel testo incollato

Nel messaggio gli URL sono avvolti da markup HTML della chat. Nel sorgente TypeScript devono rimanere stringhe URL normali. Se il markup è realmente nel file, è un errore sintattico da correggere subito. Non viene trattato come issue di architettura perché può essere un artefatto del copia/incolla.

## Obiettivo finale per App.tsx

`App.tsx` deve diventare l'orchestratore UI del nuovo contratto, senza reinterpretarlo:

- `status`/`autonomousStatus` mostrano esclusivamente l'outcome autonomo;
- `finalizationStatus` mostra APPROVED/REJECTED/NOT_FINALIZED;
- replay preserva category, mode, fixture e configurazione;
- workspace è multi-file e ricostruibile da dati appartenenti al run;
- Human Override produce una patch valida e completa con provenance umana;
- SSE è progressivo e non compete con HTTP per lo stato finale;
- configurazione sperimentale inviata al BE è esplicita e riproducibile.

## Sequenza consigliata

1. FE-02/03/14/15: separazione autonomous outcome vs finalization.
2. FE-07/08/09: replay fedele.
3. FE-16: modello UI multi-file.
4. FE-04/05/06: workspace e Human Override deterministici.
5. FE-10: provenance model timeout.
6. FE-11/12/13: razionalizzazione SSE.

## Punti Excel

### FE-02
ID: FE-02
Priorità: P0
Sprint/Area: FE / Session State
Attività: Separare outcome autonomo e stato di finalizzazione
Problema/Rischio: Dopo approve/reject `App.tsx` sovrascrive `session.status` con APPROVED/REJECTED, in conflitto con il contratto BE che preserva l'outcome autonomo e usa `finalizationStatus`.
File coinvolti: App.tsx; SessionHeader; ActionToolbar; PipelineStatusPanel
Fix minima: Non modificare `status`/`autonomousStatus` durante approve/reject; aggiornare `finalizationStatus` e i campi di finalizzazione.
Criterio di chiusura: Dopo approve/reject l'outcome autonomo originale resta invariato e la UI visualizza separatamente `finalizationStatus`.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Blocker per l'allineamento al nuovo terminal-state model.

### FE-03
ID: FE-03
Priorità: P0
Sprint/Area: FE / Finalization
Attività: Riallineare l'aggiornamento client dopo approve/reject
Problema/Rischio: Il FE ricostruisce localmente uno stato parziale di finalizzazione usando il vecchio modello.
File coinvolti: App.tsx
Fix minima: Aggiornare solo `finalizationStatus`, `approvalCommitHash`, `isHumanAugmented` e `finalPatch` quando applicabile, preservando lo stato autonomo.
Criterio di chiusura: Lo stato React dopo finalizzazione è compatibile con `WorkbenchSessionState` corrente e non introduce status legacy.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Da chiudere insieme a FE-02.

### FE-04
ID: FE-04
Priorità: P1
Sprint/Area: FE / Patch Workspace
Attività: Rendere deterministica la sorgente originale del workspace
Problema/Rischio: Il workspace live ricostruisce i file leggendo il repository corrente anziché una snapshot appartenente al run/fixture.
File coinvolti: App.tsx; PatchWorkspace.tsx
Fix minima: Conservare/materializzare le sorgenti originali del run per tutti i target e usarle nell'applicazione degli hunk, evitando dipendenza dal filesystem corrente quando è disponibile una snapshot autoritativa.
Criterio di chiusura: La stessa iterazione mostra lo stesso original/modified content anche dopo rollback o replay, usando dati appartenenti al run.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Importante per riproducibilità e replay.

### FE-05
ID: FE-05
Priorità: P1
Sprint/Area: FE / Human Override
Attività: Supportare Human Override coerente con patch multi-file
Problema/Rischio: L'override genera un diff solo per il file selezionato mentre il BE supporta task e patch multi-file.
File coinvolti: App.tsx; PatchWorkspace.tsx
Fix minima: Generare una singola patch di override comprendente tutti i `WorkspaceFile` modificati/autorizzati oppure rendere esplicito e vincolato il modello single-file.
Criterio di chiusura: Un override multi-file conserva tutte le modifiche deliberate dall'utente e supera i quattro gate BE prima del commit.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Preferire patch aggregata per coerenza con il contratto backend.

### FE-06
ID: FE-06
Priorità: P1
Sprint/Area: FE / Diff Generation
Attività: Rendere robusta la generazione Unified Diff dell'Human Override
Problema/Rischio: `createFullReplacementDiff()` costruisce manualmente hunk full-file e può gestire male file vuoti, newline finale e CREATE.
File coinvolti: App.tsx; eventuale utility diff condivisa; test FE dedicati
Fix minima: Sostituire o hardenizzare il generatore e coprire file esistente, file vuoto, nuovo file e newline finale.
Criterio di chiusura: I diff generati per i casi coperti passano `APPLICABILITY` e i regression test dedicati.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Test mirati obbligatori.

### FE-07
ID: FE-07
Priorità: P1
Sprint/Area: FE / Replay
Attività: Ripristinare execution mode nel replay
Problema/Rischio: `handleReplay()` azzera `executionMode` invece di usare `run.metadata.mode`.
File coinvolti: App.tsx; PipelineStatusPanel.tsx
Fix minima: Impostare execution mode dal metadata del run.
Criterio di chiusura: Replay BASELINE e MULTI_AGENT visualizzano la modalità archiviata corretta.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note:

### FE-08
ID: FE-08
Priorità: P1
Sprint/Area: FE / Replay
Attività: Ripristinare category nel replay
Problema/Rischio: Il replay non aggiorna `taskCategory`, quindi CREATE/REPAIR può essere mostrato in modo errato.
File coinvolti: App.tsx
Fix minima: Impostare `taskCategory` da `run.metadata.category`.
Criterio di chiusura: Ogni replay visualizza e utilizza la category archiviata del run.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note:

### FE-09
ID: FE-09
Priorità: P1
Sprint/Area: FE / Replay
Attività: Ripristinare manifest file completo nel replay
Problema/Rischio: Il replay assume il primo target e non ripristina test file/manifest completo.
File coinvolti: App.tsx; PatchWorkspace.tsx
Fix minima: Ripristinare target/test manifest dalla sessione e materializzare i file rilevanti senza assumere un solo target.
Criterio di chiusura: Replay di run multi-file espone correttamente target, test e workspace della sessione archiviata.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note:

### FE-10
ID: FE-10
Priorità: P1
Sprint/Area: FE / Experiment Configuration
Attività: Rendere esplicito `inferenceTimeoutMs` nella configurazione FE
Problema/Rischio: Il BE include `inferenceTimeoutMs` nella comparabilità ma la request FE non lo invia esplicitamente.
File coinvolti: App.tsx
Fix minima: Mantenere un valore FE esplicito coerente col profilo corrente e inviarlo in `modelConfig`, senza necessariamente esporlo nella UI.
Criterio di chiusura: Ogni nuova request `/execute` contiene `inferenceTimeoutMs` deterministico e il replay conserva il valore archiviato.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Compatibile con la scelta corrente di non mostrare ancora configurazioni tecniche avanzate.

### FE-11
ID: FE-11
Priorità: P1
Sprint/Area: FE / SSE Contract
Attività: Tipizzare gli eventi SSE con il contratto condiviso
Problema/Rischio: I payload SSE sono castati manualmente e possono divergere da `WorkbenchStreamEvent`.
File coinvolti: App.tsx; types.ts
Fix minima: Centralizzare parsing/type narrowing degli eventi SSE sul contratto condiviso e gestire payload JSON invalidi.
Criterio di chiusura: Nessun payload SSE è interpretato tramite shape locale divergente; typecheck e test eventi passano.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note:

### FE-12
ID: FE-12
Priorità: P0
Sprint/Area: FE / Execution State
Attività: Eliminare la race tra HTTP execute e SSE completion
Problema/Rischio: Response `/execute` e `ITERATION_COMPLETE` aggiornano indipendentemente sessione, fase, running state e status message.
File coinvolti: App.tsx; PipelineEventStream.tsx
Fix minima: Definire una sola fonte autoritativa dello stato finale e usare l'altro canale solo per progress/deduplica.
Criterio di chiusura: Un run produce un solo aggiornamento terminale deterministico indipendentemente dall'ordine di arrivo HTTP/SSE.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Da trattare insieme a FE-13.

### FE-13
ID: FE-13
Priorità: P1
Sprint/Area: FE / SSE Lifecycle
Attività: Stabilizzare il lifecycle EventSource
Problema/Rischio: EventSource viene aperto/chiuso in funzione di `isRunning`, aumentando il rischio di perdita o duplicazione del completamento.
File coinvolti: App.tsx
Fix minima: Allineare apertura/chiusura stream alla strategia definita in FE-12 e chiudere esplicitamente lo stream solo quando il lifecycle del task è concluso.
Criterio di chiusura: Nessun evento terminale perso o duplicato nei test di esecuzione e cleanup EventSource verificato.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note:

### FE-14
ID: FE-14
Priorità: P0
Sprint/Area: FE / Human Augmentation
Attività: Correggere la visualizzazione Human-Augmented
Problema/Rischio: `isHumanAugmented` viene mostrato solo se `session.status === CONVERGED`, ma l'override può finalizzare anche outcome autonomi UNRESOLVED/FAILED.
File coinvolti: App.tsx; ActionToolbar.tsx
Fix minima: Derivare lo stato human-augmented da `finalizationStatus === APPROVED && isHumanAugmented === true` senza alterare l'outcome autonomo.
Criterio di chiusura: Override approvato da CONVERGED, UNRESOLVED o FAILED è identificato correttamente come Human-Augmented mantenendo l'outcome originale.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note:

### FE-15
ID: FE-15
Priorità: P0
Sprint/Area: FE / Finalization UI
Attività: Migrare controlli UI da status legacy a finalizationStatus
Problema/Rischio: readOnly, isApproved e rejectability cercano APPROVED/REJECTED in `session.status`.
File coinvolti: App.tsx; PatchWorkspace.tsx; ActionToolbar.tsx; SessionHeader.tsx
Fix minima: Usare `finalizationStatus` per APPROVED/REJECTED/NOT_FINALIZED e `status`/`autonomousStatus` solo per outcome autonomo.
Criterio di chiusura: Pulsanti, editor e header rispettano entrambe le dimensioni senza status sintetici legacy.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Da chiudere insieme a FE-02.

### FE-16
ID: FE-16
Priorità: P1
Sprint/Area: FE / Task Configuration
Attività: Migrare la configurazione task a manifest multi-file
Problema/Rischio: La UI mantiene un solo target e un solo test mentre il BE usa `targetFiles[]`/`testFiles[]` e fixture multi-file.
File coinvolti: App.tsx; componenti configurazione task; PatchWorkspace.tsx
Fix minima: Rappresentare target e test come liste e inviare il manifest completo; adattare preset e selezione workspace.
Criterio di chiusura: Il FE può eseguire e riprodurre task con più target/test senza perdita di informazioni.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Necessario soprattutto per CREATE e patch multi-file.
