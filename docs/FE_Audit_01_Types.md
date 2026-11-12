# FE Audit 01 - shared types bridge

## Stato attuale

Il file funziona come bridge di tipi dal backend verso il frontend. Riesporta direttamente numerosi contratti da `../../src/types/domain.js` e `../../src/types/analytics.js` e definisce localmente soltanto `WorkspaceFile`.

Questa scelta ha un vantaggio immediato: il FE non replica manualmente i contratti BE e quindi segue automaticamente l'evoluzione di tipi come `WorkbenchSessionState`, `VerificationVerdict`, `IterationRecord`, telemetria, failure e remediation.

## Stato rispetto al BE congelato

Dal solo file analizzato non emerge un mismatch strutturale obbligatorio con il BE auditato. I nuovi concetti BE rilevanti sono già esposti al FE tramite re-export, inclusi `OracleStatus`, `ExecutionFailure`, `RollbackResult`, `ComputationalTelemetry`, `AgentUsage`, `WorkbenchSessionState` e `WorkbenchStreamEvent`.

Il file può quindi rimanere molto piccolo: non è opportuno duplicare qui i tipi già autoritativi nel backend.

## Gap e rischi

### FE-01 - Dipendenza del FE dalla struttura sorgente del BE

Il bridge importa da percorsi relativi `../../src/types/...`. Questo accoppia la compilazione FE alla posizione fisica dei sorgenti BE. Non è un bug dimostrabile nel file, ma è un punto architetturale da validare nella configurazione del progetto e nella build FE.

La fix minima non è copiare i tipi nel frontend. Occorre verificare che la build/typecheck FE supporti intenzionalmente questi import cross-boundary. Se l'assetto è supportato e stabile, il punto può essere chiuso senza modifica; se non lo è, serve un package/shared-contract boundary mantenendo una sola fonte autoritativa.

### Nessuna duplicazione dei contratti BE

Non introdurre interfacce FE parallele per session state, Oracle, telemetry o failure. Con il BE appena congelato questo aumenterebbe il rischio di drift.

### WorkspaceFile

`WorkspaceFile` è un modello esclusivamente FE e non presenta, in questo file, incompatibilità evidente con il BE. Prima di modificarlo va verificato il suo utilizzo effettivo nei componenti che materializzano patch CREATE/REPAIR.

## Obiettivo

Mantenere questo file come boundary leggero dei contratti condivisi:

1. una sola fonte autoritativa per i tipi BE;
2. nessuna replica manuale dei nuovi stati backend;
3. build FE deterministica rispetto ai contratti condivisi;
4. soli tipi UI realmente frontend-specific definiti localmente.

## Ordine di intervento

1. Verificare la configurazione TypeScript/build del FE rispetto agli import `../../src/types/...`.
2. Analizzare i consumer reali di `WorkbenchSessionState` e `WorkbenchStreamEvent` per individuare i mismatch UI introdotti dal nuovo BE.
3. Analizzare i consumer di `WorkspaceFile` prima di estendere o cambiare questo contratto.

## Fix Excel individuata

### FE-01

ID: FE-01
Priorità: P1
Sprint/Area: FE / Shared Contracts
Attività: Verificare il boundary dei tipi condivisi FE-BE
Problema/Rischio: Il frontend importa direttamente i contratti TypeScript dai sorgenti backend tramite percorsi relativi `../../src/types/...`; la correttezza dipende dalla configurazione di build/typecheck e dalla stabilità della struttura del repository.
File coinvolti: file FE dei tipi condivisi; configurazione TypeScript/build FE da identificare
Fix minima: Verificare che typecheck e build FE supportino intenzionalmente gli import cross-boundary. Se supportati, mantenere il bridge senza duplicare i tipi; se non supportati, introdurre un boundary shared/package mantenendo un'unica fonte autoritativa.
Criterio di chiusura: Typecheck e build FE passano usando i contratti condivisi senza copie locali divergenti; `WorkbenchSessionState` e `WorkbenchStreamEvent` sono risolti dal contratto autoritativo BE/shared.
Stato: Da verificare
Completata?: No
Data prevista: Da pianificare
Data completamento: 
Owner: Da assegnare
Note: Non modificare `WorkspaceFile` finché non vengono analizzati i suoi consumer. Nessun mismatch BE obbligatorio è visibile nel solo file corrente.

## Valutazione del file

Il file corrente non richiede una riscrittura immediata. Il lavoro FE sostanziale è atteso nei consumer dei contratti, non in questo bridge.
