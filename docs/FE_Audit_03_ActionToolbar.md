# FE Audit 03 - ActionToolbar.tsx

## Esito

`ActionToolbar.tsx` non e ancora allineato al modello BE congelato. Il componente riceve booleani derivati nel parent invece dei due assi autoritativi della sessione: outcome autonomo e finalizzazione. Inoltre usa `isHumanAugmented` come condizione per abilitare Approve, ma quel campo descrive la provenance di una finalizzazione gia avvenuta, non l'eleggibilita dell'override prima della finalizzazione.

## Stato attuale

Props correnti:

- `isConverged`
- `isHumanAugmented`
- `isApproved`
- `canReject`
- `isFinalizing`

La toolbar non conosce direttamente `autonomousStatus` e `finalizationStatus`. Di conseguenza la semantica finale dipende interamente da calcoli effettuati in `App.tsx`, dove sono gia emersi mismatch con il BE.

La regola corrente di approve e:

`isFinalizing || isApproved || (!isConverged && !isHumanAugmented)`.

Questa regola mescola convergenza autonoma e provenance Human-Augmented.

## Obiettivo

La toolbar deve rappresentare esclusivamente azioni di finalizzazione e derivare il proprio stato da dati coerenti col contratto BE:

- outcome autonomo preservato separatamente;
- finalizzazione separata;
- approve autonomo disponibile solo per candidata autonomamente convergente/verificata, secondo la decisione gia presa in App;
- Human Override non deve essere abilitato perche `isHumanAugmented=true`: quel flag descrive un risultato gia human-augmented;
- reject disponibile solo prima della finalizzazione;
- dopo APPROVED o REJECTED nessuna nuova azione mutativa deve risultare disponibile.

## Fix individuate

### FE-17 - Rimuovere `isHumanAugmented` dalla logica di eleggibilita Approve

`isHumanAugmented` e provenance della sessione finalizzata. Non deve rendere approvabile una sessione non convergente. L'Human Override avviene tramite il salvataggio dell'override nel workspace e viene poi verificato dal BE.

La toolbar deve ricevere un booleano esplicito come `canApprove` oppure una policy gia derivata dal parent. La condizione `(!isConverged && !isHumanAugmented)` deve sparire.

### FE-18 - Rendere la finalizzazione esplicita invece di usare `isApproved`

La toolbar distingue soltanto `isApproved`, ma il BE possiede tre stati di finalizzazione: NOT_FINALIZED, APPROVED, REJECTED. Serve almeno una prop `finalizationStatus` oppure booleani non ambigui derivati da essa.

Questo permette di disabilitare entrambe le azioni anche dopo REJECTED e di mostrare un'etichetta coerente.

### FE-19 - Separare label Human-Augmented da autorizzazione all'azione

Il testo `Approva Human-Augmented Patch` viene scelto usando `isHumanAugmented`. Prima che l'override sia approvato, il campo non dovrebbe ancora descrivere una finalizzazione human-augmented. Se si vuole distinguere il bottone di override, serve una prop UI separata come `hasPendingHumanOverride`, derivata dallo stato dell'editor, non dalla provenance persistita della sessione.

## Punti Excel

### FE-17
ID: FE-17
Priorita: P0
Sprint/Area: FE / Finalization UI
Attivita: Rimuovere `isHumanAugmented` dalla policy di abilitazione Approve
Problema/Rischio: `approveDisabled` consente semanticamente di usare `isHumanAugmented` come alternativa a `isConverged`, ma `isHumanAugmented` rappresenta la provenance di una finalizzazione gia approvata e non l'eleggibilita di una nuova approvazione.
File coinvolti: ActionToolbar.tsx; App.tsx
Fix minima: Sostituire la combinazione `isConverged`/`isHumanAugmented` con una prop esplicita `canApprove` derivata nel parent dalla policy corrente; non usare `isHumanAugmented` per autorizzare l'azione.
Criterio di chiusura: La toolbar abilita Approve soltanto quando `canApprove` e true e non usa piu `isHumanAugmented` come condizione di eleggibilita.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Collegato a FE-02, FE-03 e FE-14.

### FE-18
ID: FE-18
Priorita: P0
Sprint/Area: FE / Finalization UI
Attivita: Gestire esplicitamente NOT_FINALIZED, APPROVED e REJECTED nella toolbar
Problema/Rischio: Il componente riceve solo `isApproved`; non rappresenta REJECTED e puo lasciare semantiche di azione incoerenti dopo la finalizzazione.
File coinvolti: ActionToolbar.tsx; App.tsx
Fix minima: Passare `finalizationStatus` oppure un set di booleani derivati senza ambiguita e disabilitare le azioni quando la finalizzazione non e NOT_FINALIZED.
Criterio di chiusura: APPROVED e REJECTED sono entrambi rappresentati correttamente e nessuna nuova approve/reject e disponibile dopo una finalizzazione conclusa.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Da chiudere insieme a FE-15.

### FE-19
ID: FE-19
Priorita: P1
Sprint/Area: FE / Human Override UI
Attivita: Separare pending Human Override da provenance Human-Augmented
Problema/Rischio: La label del bottone usa `isHumanAugmented`, che descrive una sessione gia finalizzata, per rappresentare implicitamente una patch di override ancora da approvare.
File coinvolti: ActionToolbar.tsx; App.tsx; PatchWorkspace.tsx
Fix minima: Se la UI deve distinguere una modifica umana pendente, introdurre uno stato/prop dedicato (`hasPendingHumanOverride` o equivalente) separato da `session.isHumanAugmented`.
Criterio di chiusura: La UI distingue chiaramente override pendente e sessione gia approvata come Human-Augmented; `isHumanAugmented` viene usato solo come provenance persistita.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Dipende dal flusso Human Override di FE-05/FE-06.
