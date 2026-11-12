# FE Audit 07 - PipelineEventStream.tsx

## Esito

Il componente e semplice e non presenta mismatch diretti con i contratti BE: riceve gia stringhe renderizzate dal parent e non interpreta `WorkbenchStreamEvent`. Non aggiungerei nuovi punti Excel autonomi dal solo file corrente. Le modifiche necessarie ricadono nei punti FE-12 e FE-13 gia aperti su `App.tsx`, che devono decidere source of truth e lifecycle SSE.

## Stato attuale

- Nasconde il pannello quando non esistono log e il run non e attivo.
- Espande automaticamente il pannello durante l'esecuzione.
- Applica una colorazione puramente presentazionale in base ai prefissi gia costruiti dal parent.
- Non modifica session state e non ricalcola stati Oracle.
- Non crea o gestisce `EventSource` direttamente.

## Impatto delle fix gia censite

### FE-12 - Race HTTP/SSE

Nessuna correzione strutturale obbligatoria e visibile qui: la deduplicazione dello stato terminale va risolta in `App.tsx`. Questo componente deve continuare a essere un renderer passivo dei log.

### FE-13 - Lifecycle EventSource

Anche questo problema appartiene a `App.tsx`. `PipelineEventStream` non possiede connessioni SSE e quindi non deve acquisire quella responsabilita.

## Obiettivo

Mantenere `PipelineEventStream` come componente presentazionale. Dopo la razionalizzazione SSE del parent deve ricevere una sequenza di log gia normalizzata e uno stato `isRunning` coerente, senza diventare una seconda source of truth del lifecycle della pipeline.

## Punti Excel

Nessun nuovo punto Excel introdotto da questo file.

I punti esistenti da considerare come file coinvolto sono:

- FE-12 - eliminare la race tra HTTP execute e SSE completion.
- FE-13 - stabilizzare il lifecycle EventSource.

## Valutazione

`PipelineEventStream.tsx` e congelabile come componente presentazionale, subordinatamente alla correzione di FE-12/FE-13 nel parent. Non sono necessarie modifiche locali obbligatorie sulla base del codice analizzato.
