# FE Audit 06 - PatchWorkspace.tsx

## Esito

`PatchWorkspace.tsx` e gia impostato meglio del vecchio modello single-file: possiede una lista `files`, una selezione esplicita e filtra i finding per file prima di passarli al viewer. Non e pero ancora congelabile rispetto al nuovo flusso multi-file/Human Override.

## Stato attuale

Aspetti gia corretti:

- la sidebar supporta piu `WorkspaceFile`;
- distingue `NEW` e `MODIFIED`;
- seleziona un file tramite `selectedFilePath`;
- filtra i finding per path prima di passarli a `InteractiveDiffViewer`;
- propaga `readOnly`;
- non ricalcola status Oracle.

## Gap rispetto all'obiettivo

### FE-27 - Eliminare la doppia source of truth del contenuto selezionato

Il componente riceve sia `files[]` sia `originalCode`/`modifiedCode` dal parent. Il file selezionato viene gia individuato con `files.find(...)`, ma il viewer non usa `selectedFile.originalContent` e `selectedFile.modifiedContent`: usa due props esterne indipendenti. Questo permette stati incoerenti durante cambio file, replay o aggiornamento asincrono del workspace.

Fix minima: quando esiste `selectedFile`, derivare i contenuti direttamente da esso. Mantenere un fallback separato solo per lo stato senza `files`, se realmente necessario.

### FE-28 - Propagare l'identita del file nel callback Human Override

`onSaveOverride` riceve soltanto `updatedSource`. Con il modello multi-file il parent deve sapere in modo non ambiguo quale file e stato modificato. Oggi App si affida a `selectedFilePath` esterno, che puo cambiare mentre un flusso asincrono e in corso.

Fix minima: cambiare il contratto in `onSaveOverride(filePath, updatedSource)` e inoltrare il path del file visualizzato al momento del submit.

### FE-29 - Propagare dirty state per file dal viewer al workspace

Per realizzare FE-25/FE-19 il workspace deve diventare il punto naturale di aggregazione del dirty state multi-file. Attualmente non riceve alcun evento `onDirtyChange` dal viewer e non puo costruire l'elenco dei file modificati manualmente.

Fix minima: aggiungere un callback con identita file e propagare al parent `filePath + dirty`, oppure mantenere localmente una mappa dirty e comunicarne lo snapshot ad App.

### FE-30 - Canonicalizzazione path FE non condivisa

`normalizePath()` implementa localmente strip di `./`, `a/`, `b/` e lower-case incondizionato. E una logica utile per matching UI, ma differisce dalla semantica repository-aware del BE e puo collassare path distinti su filesystem case-sensitive.

Fix minima: utilizzare una canonicalizzazione FE condivisa e specifica per matching dei path restituiti dal diff/Semgrep, senza imporre lower-case su tutte le piattaforme se il contratto autoritativo non lo garantisce. Non importare funzioni filesystem-only del BE nel browser.

## Obiettivo

`PatchWorkspace` deve essere il boundary multi-file tra App e Monaco:

- `files[]` source of truth dei contenuti;
- selezione file solo per la vista;
- dirty/override identificati per file;
- callback asincroni file-aware;
- matching finding/path deterministico senza semantiche filesystem inventate nel browser.

## Punti Excel

### FE-27
ID: FE-27
Priorita: P1
Sprint/Area: FE / Patch Workspace State
Attivita: Eliminare la doppia source of truth dei contenuti del file selezionato
Problema/Rischio: `PatchWorkspace` riceve sia `files[]` sia `originalCode`/`modifiedCode`; il viewer puo quindi ricevere contenuti non coerenti con `selectedFilePath` durante selezione, replay o aggiornamenti asincroni.
File coinvolti: PatchWorkspace.tsx; App.tsx
Fix minima: Derivare `originalCode` e `modifiedCode` da `selectedFile` quando il workspace contiene file; mantenere un fallback separato solo per lo stato realmente privo di `files`.
Criterio di chiusura: Selezionando qualunque file, path, original e modified provengono dallo stesso `WorkspaceFile` e non esiste uno stato intermedio con contenuto di un altro file.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Riduce race e complessita di FE-04/FE-09.

### FE-28
ID: FE-28
Priorita: P1
Sprint/Area: FE / Human Override Multi-file
Attivita: Rendere file-aware il callback di Human Override
Problema/Rischio: `onSaveOverride` riceve solo `updatedSource`; il parent deduce il file da uno stato esterno (`selectedFilePath`), creando ambiguita nel modello multi-file e durante operazioni asincrone.
File coinvolti: PatchWorkspace.tsx; InteractiveDiffViewer.tsx; App.tsx
Fix minima: Cambiare il callback in `onSaveOverride(filePath, updatedSource)` e catturare il path del file visualizzato al momento del submit.
Criterio di chiusura: Ogni override inviato al parent contiene esplicitamente il path del file cui appartiene e non dipende dalla selezione corrente successiva al click.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Necessario prima dell'override aggregato FE-05.

### FE-29
ID: FE-29
Priorita: P1
Sprint/Area: FE / Human Override State
Attivita: Aggregare dirty state per file nel Patch Workspace
Problema/Rischio: Il workspace non riceve lo stato `isEdited` del viewer e non puo sapere quali file contengono modifiche umane pendenti; cio impedisce una patch Human Override multi-file deterministica.
File coinvolti: PatchWorkspace.tsx; InteractiveDiffViewer.tsx; App.tsx; ActionToolbar.tsx
Fix minima: Propagare `onDirtyChange(filePath, dirty)` e mantenere/trasmettere una mappa dei file con override pendente.
Criterio di chiusura: Modificando, ripristinando e cambiando selezione su piu file, il FE mantiene correttamente l'insieme dei file dirty e lo azzera solo quando le modifiche vengono annullate o finalizzate.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Implementazione concreta di FE-25.

### FE-30
ID: FE-30
Priorita: P1
Sprint/Area: FE / Path Matching
Attivita: Centralizzare la canonicalizzazione dei path usata dal workspace
Problema/Rischio: `normalizePath()` e locale e converte sempre in lower-case; su ambienti case-sensitive puo collassare path distinti e la logica puo divergere da quella usata negli altri componenti per diff/finding matching.
File coinvolti: PatchWorkspace.tsx; InteractiveDiffViewer.tsx; eventuale utility FE path condivisa
Fix minima: Introdurre una utility browser-safe condivisa per normalizzare i path di matching, rimuovendo solo prefissi diff e separatori secondo il contratto necessario e applicando case-folding solo quando esplicitamente appropriato.
Criterio di chiusura: PatchWorkspace e viewer usano la stessa funzione di matching; path equivalenti del diff vengono riconosciuti e path distinti per case non vengono collassati su configurazioni case-sensitive.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Non importare nel browser utility che richiedono `node:fs`.
