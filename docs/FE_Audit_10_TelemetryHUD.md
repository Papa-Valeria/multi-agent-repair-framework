# FE Audit 10 - TelemetryHUD.tsx

## Esito

`TelemetryHUD.tsx` non e congelabile. Il mismatch principale e certo: il nuovo `ComputationalTelemetry` consente `promptTokens` e `completionTokens` null quando `tokenUsageAvailable` e false, mentre il componente li somma e li stampa come numeri. Inoltre la UI applica una soglia di conformita `<= 5%` direttamente all'overhead, che va mantenuta solo se RNF-05 definisce davvero quella soglia come criterio normativo del progetto.

## Stato attuale

Aspetti positivi:
- riusa `AnalyticsMetrics.js` invece di duplicare le formule di overhead;
- gestisce `null` restituito dalle metriche overhead come `n/d`;
- distingue overhead end-to-end e active framework overhead;
- visualizza iteration/maxIterations separatamente.

## Gap rispetto al BE congelato

### FE-38 - Gestire correttamente token usage non disponibile

Il componente esegue `telemetry.promptTokens + telemetry.completionTokens` e stampa entrambi i campi. Nel contratto BE congelato, quando `tokenUsageAvailable === false`, entrambi devono essere `null`. Il FE deve quindi visualizzare `n/d` e non tentare di presentarli come token osservati.

### FE-39 - Esporre Oracle duration availability

Il BE ha introdotto esplicitamente `oracleDurationMs: number | null` e `oracleDurationAvailable`, proprio per distinguere assenza di misura da durata osservata pari a zero. Il HUD non visualizza questa dimensione e quindi non permette di ispezionare una delle metriche appena resa scientificamente comparabile dal BE.

Fix minima: aggiungere una metrica Oracle che mostri `n/d` quando unavailable e il valore in ms/sec quando available, preservando `0` come misura valida.

### FE-40 - Non dichiarare conformita RNF-05 senza una policy FE esplicita e verificata

`isCompliant` e hardcoded come `overhead <= 5.0`, e la UI mostra `(Conforme <=5%)`. Dal solo componente non e possibile verificare che il 5% sia ancora la soglia normativa corretta di RNF-05 dopo l'evoluzione delle metriche. La formula viene correttamente delegata ad `AnalyticsMetrics`, ma la soglia resta locale.

Fix minima: centralizzare la soglia in una costante/policy condivisa del progetto oppure, se RNF-05 non prevede piu questo criterio, rimuovere la label di conformita e mostrare il valore come metrica descrittiva.

## Punti Excel

### FE-38
ID: FE-38
Priorita: P0
Sprint/Area: FE / Telemetry Availability
Attivita: Gestire token usage disponibile/non disponibile nel TelemetryHUD
Problema/Rischio: Il componente somma e visualizza `promptTokens` e `completionTokens` come numeri, ma il BE usa `null` quando `tokenUsageAvailable` e false; la UI non rispetta quindi il contratto di availability e puo produrre output errato o type error.
File coinvolti: TelemetryHUD.tsx
Fix minima: Usare `telemetry.tokenUsageAvailable` come discriminante; visualizzare totale/in/out solo quando entrambi i conteggi sono disponibili, altrimenti mostrare `n/d` senza trasformare null in zero.
Criterio di chiusura: Snapshot con token disponibili mostra totale/in/out reali; snapshot con token non disponibili mostra `n/d` e nessun conteggio sintetico.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: P0 perche il BE ha esplicitamente congelato la semantica null/availability.

### FE-39
ID: FE-39
Priorita: P1
Sprint/Area: FE / Telemetry Metrics
Attivita: Visualizzare Oracle duration rispettando `oracleDurationAvailable`
Problema/Rischio: Il BE distingue durata Oracle assente da durata osservata pari a zero e usa questa informazione per la comparabilita, ma il TelemetryHUD non espone la metrica e rende invisibile una dimensione sperimentale importante.
File coinvolti: TelemetryHUD.tsx; App.tsx se serve riallocare il layout
Fix minima: Aggiungere una metrica Oracle duration che mostri `n/d` quando `oracleDurationAvailable` e false e il valore reale, incluso 0, quando true.
Criterio di chiusura: `null/false` e mostrato come non disponibile; `0/true` e mostrato come durata osservata zero; valori positivi sono mostrati senza backfill sintetici.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Allineato alle invarianti Oracle duration congelate nel BE.

### FE-40
ID: FE-40
Priorita: P1
Sprint/Area: FE / Research Metrics Policy
Attivita: Centralizzare o rimuovere la soglia hardcoded di conformita overhead RNF-05
Problema/Rischio: `TelemetryHUD` dichiara `Conforme <=5%` tramite una soglia locale `5.0`; se la soglia non coincide con la policy sperimentale autoritativa, il FE trasforma una metrica in un giudizio di conformita non garantito dal contratto dati.
File coinvolti: TelemetryHUD.tsx; AnalyticsMetrics.ts o modulo di policy/configurazione pertinente
Fix minima: Spostare la soglia in una policy/costante autoritativa condivisa e importarla nel FE, oppure rimuovere il giudizio `Conforme/Sopra soglia` se RNF-05 non definisce formalmente il 5%.
Criterio di chiusura: Nessuna soglia di conformita e duplicata localmente nel componente; label e colore derivano da una policy esplicita oppure il valore e presentato solo come metrica descrittiva.
Stato: Da verificare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Prima di implementare serve verificare `AnalyticsMetrics.ts`/requisito RNF-05; non assumere che 5% sia corretto solo perche compare nella UI attuale.
