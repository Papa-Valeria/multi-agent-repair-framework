# FE Audit 08 - PipelineStatusPanel.tsx

## Esito

Il componente non e ancora congelabile. Conferma il mismatch gia emerso in App.tsx: `phase` mescola fase FSM, outcome autonomo e finalizzazione. Inoltre `UNRESOLVED`, che e un outcome terminale esplicito del BE, cade oggi nel tono NEUTRAL.

## Stato attuale

`pipelinePresentation()` interpreta una singola stringa `phase` e include valori appartenenti a domini differenti:
- fase/progresso runtime;
- outcome autonomo (`CONVERGED`, `FAILED`, `INFRASTRUCTURE_ERROR`);
- finalizzazione legacy (`APPROVED`, `REJECTED`).

`APPROVED` viene colorato SUCCESS e `REJECTED` WARNING, ma questi non appartengono piu a `status`/`autonomousStatus` nel contratto BE congelato.

## Obiettivo

Il pannello deve separare:
1. fase/progresso live;
2. outcome autonomo terminale;
3. finalization status;
4. replay mode e provenance BASELINE/MULTI_AGENT.

Non deve ricevere una stringa libera capace di rappresentare tutti questi concetti contemporaneamente.

## Fix individuate

### FE-31 - Rimuovere APPROVED/REJECTED dalla presentazione della pipeline autonoma

`pipelinePresentation()` tratta APPROVED e REJECTED come valori di `phase`. Dopo il freeze BE queste informazioni appartengono a `finalizationStatus`. Fix minima: passare `autonomousStatus` e `finalizationStatus` separatamente oppure lasciare a `phase` soltanto il progresso live e a props tipizzate gli stati terminali.

### FE-32 - Rappresentare UNRESOLVED come outcome terminale esplicito

`UNRESOLVED` non e gestito nello switch e quindi diventa NEUTRAL. Il BE lo considera un outcome autonomo terminale distinto, spesso associato a required oracle unavailable, budget exhausted, stagnation o verification gates failed. La UI deve dargli una presentazione WARNING distinta dal normale IDLE/neutral.

### FE-33 - Tipizzare il contratto `phase` invece di usare `string`

`phase: string` permette valori arbitrari e impedisce al compilatore di segnalare drift rispetto alle fasi note. Fix minima: introdurre un tipo UI discriminato per `IDLE`/progress oppure passare direttamente campi separati (`livePhase`, `autonomousStatus`, `finalizationStatus`).

## Punti Excel

### FE-31
ID: FE-31
Priorita: P0
Sprint/Area: FE / Pipeline Status
Attivita: Separare finalizzazione e outcome autonomo nel PipelineStatusPanel
Problema/Rischio: `pipelinePresentation()` tratta APPROVED e REJECTED come valori della pipeline/status, mentre il BE li espone tramite `finalizationStatus`; la UI perde la separazione tra risultato autonomo e decisione umana.
File coinvolti: PipelineStatusPanel.tsx; App.tsx
Fix minima: Passare e visualizzare separatamente stato/progresso autonomo e `finalizationStatus`; rimuovere APPROVED/REJECTED dallo switch dell'outcome autonomo.
Criterio di chiusura: Un run mantiene e mostra il proprio outcome autonomo dopo approve/reject e la finalizzazione viene presentata come dimensione separata.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Implementazione UI diretta di FE-02 e FE-15.

### FE-32
ID: FE-32
Priorita: P1
Sprint/Area: FE / Pipeline Status
Attivita: Rappresentare UNRESOLVED come outcome terminale distinto
Problema/Rischio: `UNRESOLVED` cade nel default NEUTRAL e puo risultare visivamente equivalente a uno stato non terminale/idle, nonostante sia un outcome autonomo terminale del BE.
File coinvolti: PipelineStatusPanel.tsx
Fix minima: Aggiungere una presentazione esplicita per UNRESOLVED con tono WARNING e label non ambigua.
Criterio di chiusura: CONVERGED, UNRESOLVED, FAILED e INFRASTRUCTURE_ERROR hanno presentazioni terminali distinte e coerenti.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Non inferire la reason; visualizzare eventuale terminationReason altrove se disponibile.

### FE-33
ID: FE-33
Priorita: P1
Sprint/Area: FE / Type Safety
Attivita: Tipizzare il contratto di stato/progresso del PipelineStatusPanel
Problema/Rischio: `phase` e una stringa libera che mescola fasi FSM, replay label e stati terminali, impedendo exhaustive checking e facilitando drift con i contratti condivisi.
File coinvolti: PipelineStatusPanel.tsx; App.tsx; types.ts se serve un tipo UI dedicato
Fix minima: Sostituire `phase: string` con props/tipi discriminati che distinguano live phase, autonomous status e finalization status.
Criterio di chiusura: Lo switch di presentazione e exhaustive sui valori supportati e non accetta APPROVED/REJECTED come outcome autonomi.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Da implementare insieme a FE-31 per evitare doppio refactor.
