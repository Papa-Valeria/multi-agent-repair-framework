# FE Audit 09 - SessionHeader.tsx

## Esito

`SessionHeader.tsx` non e ancora congelabile. Il componente conferma lo stesso mismatch di stato gia individuato in `App.tsx` e `PipelineStatusPanel.tsx`: `status` e una stringa libera che include anche `APPROVED` e `REJECTED`, mentre il backend congelato mantiene separati outcome autonomo e finalizzazione. Inoltre il fallback `service.py` inventa un target quando il manifest e vuoto.

## Stato attuale

Aspetti positivi:

- visualizza gia `targetFiles` come lista, quindi la presentazione supporta il manifest multi-file;
- lo storico iterazioni e separato dalla sessione corrente;
- il componente e presentazionale e non muta direttamente lo stato della sessione.

Gap rilevati:

1. `status: string` non preserva il contratto tipizzato del backend;
2. `APPROVED` e `REJECTED` sono trattati come status della sessione autonoma;
3. `INFRASTRUCTURE_ERROR` non ha una branch esplicita e cade nel colore default blu;
4. `currentPhase: string` continua a mescolare FSM phase, outcome e label costruite dal parent;
5. se `targetFiles` e vuoto viene mostrato `service.py`, dato sintetico non presente nella sessione.

## Obiettivo

L'header deve mostrare separatamente:

- outcome autonomo tipizzato;
- finalization status tipizzato;
- fase live tipizzata/separata;
- target manifest reale, senza fallback che inventino filename;
- storico iterazioni.

## Punti Excel

### FE-34
ID: FE-34
Priorita: P0
Sprint/Area: FE / Session Header
Attivita: Separare outcome autonomo e finalization status nel SessionHeader
Problema/Rischio: `SessionHeader` riceve un unico `status: string` e tratta APPROVED/REJECTED come stati della sessione, perdendo la separazione introdotta dal BE tra outcome autonomo e finalizzazione umana.
File coinvolti: SessionHeader.tsx; App.tsx
Fix minima: Sostituire `status` con props tipizzate separate per outcome autonomo e `finalizationStatus`; rimuovere APPROVED/REJECTED dalla colorazione dell'outcome autonomo e visualizzare la finalizzazione separatamente.
Criterio di chiusura: Dopo approve/reject l'header continua a mostrare l'outcome autonomo originario e mostra APPROVED/REJECTED come stato di finalizzazione distinto.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Da implementare nello stesso refactor di FE-02, FE-15 e FE-31.

### FE-35
ID: FE-35
Priorita: P1
Sprint/Area: FE / Session Header
Attivita: Rappresentare esplicitamente INFRASTRUCTURE_ERROR e tipizzare gli outcome autonomi
Problema/Rischio: `getBadgeColor()` usa una stringa libera e non contiene un case esplicito per INFRASTRUCTURE_ERROR, che ricade nel colore default blu; il typing non garantisce exhaustive handling di CONVERGED, UNRESOLVED, FAILED e INFRASTRUCTURE_ERROR.
File coinvolti: SessionHeader.tsx; types.ts
Fix minima: Usare il tipo condiviso dell'outcome/session status e una mappatura exhaustive che distingua INFRASTRUCTURE_ERROR da stati neutri o live.
Criterio di chiusura: Tutti gli outcome autonomi terminali supportati dal BE hanno un mapping esplicito; l'aggiunta/rimozione di uno status produce un errore TypeScript finche la presentation non viene aggiornata.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: UNRESOLVED resta warning; INFRASTRUCTURE_ERROR deve essere distinto dal default runtime.

### FE-36
ID: FE-36
Priorita: P1
Sprint/Area: FE / Session Header
Attivita: Separare la fase live dal terminal status nell'header
Problema/Rischio: `currentPhase` e una stringa libera costruita in App e puo contenere phase FSM, stato terminale o label replay; l'header mostra tutto sotto `FSM State`, rendendo ambigua la semantica dopo il completamento.
File coinvolti: SessionHeader.tsx; App.tsx; PipelineStatusPanel.tsx
Fix minima: Passare una prop dedicata alla fase live/progress oppure usare lo stesso contratto tipizzato introdotto per FE-33, mantenendola separata dagli outcome terminali.
Criterio di chiusura: `FSM State` mostra solo una fase/progress coerente durante il run; outcome autonomo e finalizzazione sono visualizzati nei rispettivi campi separati.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Condividere la stessa modellazione introdotta per PipelineStatusPanel, senza seconda gerarchia di tipi.

### FE-37
ID: FE-37
Priorita: P2
Sprint/Area: FE / Session Header
Attivita: Rimuovere il fallback sintetico `service.py` dal target manifest
Problema/Rischio: Quando `targetFiles` e vuoto il componente visualizza `service.py`, introducendo un nome file non proveniente dalla sessione e potenzialmente fuorviante per CREATE, replay o stati iniziali.
File coinvolti: SessionHeader.tsx
Fix minima: Mostrare un valore neutro come `-`/`Nessun target` quando `targetFiles` e vuoto, senza inventare un filename.
Criterio di chiusura: L'header visualizza esclusivamente target realmente presenti nelle props; nessun filename sintetico compare quando il manifest e vuoto.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Fix piccola ma utile per provenance e correttezza UI.
