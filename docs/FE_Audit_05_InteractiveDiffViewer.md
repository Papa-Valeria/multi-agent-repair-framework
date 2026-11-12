# FE Audit 05 - InteractiveDiffViewer.tsx

## Esito

Il componente e complessivamente pulito come editor Monaco, ma non e ancora congelabile nel nuovo flusso FE. Sono emersi 3 punti: gestione dei finding per file/range, stato di override pendente, e robustezza del callback asincrono di salvataggio/finalizzazione.

## Stato attuale

Il componente:
- determina correttamente il linguaggio Monaco dal path;
- mantiene un buffer locale del contenuto modificato;
- rileva una modifica rispetto a `modifiedCode`;
- pulisce il listener Monaco in unmount;
- applica marker Semgrep al modello modified;
- supporta split/unified view;
- rispetta `readOnly` per l'editing.

## Obiettivo

L'editor deve restare un componente di editing/visualizzazione, senza reinterpretare la semantica BE. Deve però comunicare correttamente al parent quando esiste un override umano pendente, mostrare soltanto finding pertinenti al file visualizzato e gestire in modo esplicito il ciclo asincrono di submit dell'override.

## Fix individuate

### FE-24 - Filtrare e clampare i marker Semgrep sul file/modello corrente

Il componente trasforma tutti i `findings` ricevuti in marker senza verificare `finding.path === filePath`. Oggi il parent sembra passare tutti i finding dell'iterazione. Nel workspace multi-file questo puo mostrare finding di altri file sul modello corrente. Inoltre le linee vengono solo clampate a >=1, non alla line count del modello.

Fix minima: filtrare i finding per path canonico del file visualizzato e limitare start/end alla line count del modello prima di chiamare `setModelMarkers`.

### FE-25 - Esporre al parent lo stato di override umano pendente

`isEdited` resta locale a `InteractiveDiffViewer`. Il nuovo modello FE richiede di distinguere una modifica manuale pendente dalla provenance persistita `isHumanAugmented`. Senza notificare il parent, `ActionToolbar`/`PatchWorkspace` non possono rappresentare correttamente il pending Human Override.

Fix minima: aggiungere callback come `onDirtyChange(filePath, isEdited)` o gestire il dirty state a livello workspace.

### FE-26 - Rendere asincrono e protetto il submit dell'override

`onSaveOverride` e tipizzato `void`, ma in App il callback reale e asincrono (`handleHumanOverride(): Promise<void>`). Il bottone non attende l'esito, non ha stato submitting locale e non impedisce doppi click prima che il parent propaghi `readOnly/isFinalizing`.

Fix minima: tipizzare `onSaveOverride` come `() => Promise<void>`/`(updatedCode) => Promise<void>`, attendere la Promise, disabilitare il bottone durante il submit e lasciare la gestione dell'errore al parent o a un callback esplicito.

## Punti Excel

### FE-24
ID: FE-24
Priorita: P1
Sprint/Area: FE / Patch Workspace Diagnostics
Attivita: Limitare i marker Semgrep al file attualmente visualizzato
Problema/Rischio: InteractiveDiffViewer converte tutti i finding ricevuti in marker senza verificare il path; in un workspace multi-file un finding di un altro file puo essere mostrato sulle linee del file corrente. Le linee non sono inoltre clampate alla dimensione reale del modello.
File coinvolti: InteractiveDiffViewer.tsx; PatchWorkspace.tsx
Fix minima: Filtrare i finding sul path canonico del file corrente e clampare start/end alla line count del modello prima di impostare i marker Monaco.
Criterio di chiusura: In un'iterazione multi-file ogni editor mostra esclusivamente i finding del proprio file e nessun marker usa linee fuori dal modello.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Collegato a FE-16 e al workspace multi-file.

### FE-25
ID: FE-25
Priorita: P1
Sprint/Area: FE / Human Override State
Attivita: Esporre lo stato dirty/pending Human Override al workspace
Problema/Rischio: `isEdited` e confinato nel viewer; il parent non puo distinguere una modifica umana non ancora finalizzata da una sessione gia persistita come `isHumanAugmented`.
File coinvolti: InteractiveDiffViewer.tsx; PatchWorkspace.tsx; App.tsx; ActionToolbar.tsx
Fix minima: Propagare al parent il dirty state per file tramite callback dedicata o spostare la source of truth delle modifiche manuali nel workspace.
Criterio di chiusura: Il FE distingue in modo deterministico candidata autonoma, override umano pendente e finalizzazione Human-Augmented senza usare `session.isHumanAugmented` come dirty flag.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Chiude la dipendenza emersa in FE-19.

### FE-26
ID: FE-26
Priorita: P1
Sprint/Area: FE / Human Override Submission
Attivita: Gestire esplicitamente il submit asincrono dell'Human Override
Problema/Rischio: `onSaveOverride` e dichiarato sincrono ma il callback reale esegue una finalizzazione asincrona; il viewer non attende l'operazione e puo consentire submit ripetuti prima dell'aggiornamento del parent.
File coinvolti: InteractiveDiffViewer.tsx; PatchWorkspace.tsx; App.tsx
Fix minima: Tipizzare `onSaveOverride` come callback asincrona, attendere la Promise e disabilitare il comando di salvataggio mentre il submit e in corso.
Criterio di chiusura: Un click produce al massimo una finalizzazione in-flight, il bottone resta disabilitato fino al completamento e il type contract riflette `Promise<void>`.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Mantenere il lock globale di App come seconda difesa.
