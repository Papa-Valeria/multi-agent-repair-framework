# FE Audit 11 - AnalyticsView.tsx

## Esito

`AnalyticsView.tsx` richiede un riallineamento sostanziale al contratto analytics BE congelato. Il file usa diversi campi legacy o rinominati, tratta metriche nullable come numeri, ricostruisce grafici con valori indisponibili trasformati implicitamente in zero e continua a mescolare successo autonomo, finalizzazione e metriche non comparabili.

## Stato attuale

Aspetti positivi:

- usa gli endpoint separati summary/history/compare/run detail;
- supporta filtri category e model name;
- annulla le fetch tramite `AbortController`;
- mantiene distinta la vista aggregata dal confronto paired;
- usa `null -> n/d` in alcuni formatter;
- carica il `StoredRun` completo soltanto al momento del replay.

## Gap rispetto al BE congelato

### Contratto analytics non aggiornato

Nel BE auditato il report aggregato usa, tra gli altri:

- `averageTokensPerVerifiedRun`;
- `averageProcessCodeChurnLines`;
- `averageFinalCodeChurnLines`;
- `rawConvergenceRatePct` e `validRunConvergenceRatePct` per mode;
- `processAddedLines`, `processDeletedLines`, `finalAddedLines`, `finalDeletedLines`;
- `processPatchGrounding` e `finalPatchGrounding`;
- rate separati per old-side lines e hunks;
- `oracleDurationComparable` e conteggi di inclusione/esclusione;
- token e usage agente nullable.

Il componente usa ancora nomi come `averageTokenToFix`, `averageCodeChurnLines`, `addedLines`, `deletedLines`, `patchGrounding`, `hallucinationRatePct`, `endToEndOverheadPct` e `activeFrameworkOverheadPct`. Sulla base dei contratti BE analizzati questi riferimenti devono essere verificati e, dove rimossi, sostituiti.

## Fix individuate

### FE-41 - Riallineare integralmente AnalyticsView ai tipi analytics V3 correnti

Rimuovere i campi legacy e usare esclusivamente proprietà presenti in `AggregatedMetricsReport`, `ModeAggregateMetrics` e `RunSummary` congelati. Questa e una fix P0 perche il file puo non compilare oppure leggere metriche inesistenti.

### FE-42 - Distinguere raw convergence e valid-run convergence

La KPI `Success Rate` usa `successRatePct`, alias del raw rate. Il BE espone ora anche il denominatore valido che esclude FAILED/INFRASTRUCTURE_ERROR. La UI deve mostrare chiaramente entrambe oppure scegliere una con label esplicita, senza chiamarle genericamente success rate.

### FE-43 - Correggere denominatori e label dell'Autonomous Recovery

Il dettaglio usa `baselineFailuresInPairs`, mentre il BE espone anche eligible, infrastructure excluded e other failure excluded. La UI deve mostrare il denominatore eleggibile reale e le esclusioni per evitare che il recovery rate sembri calcolato su tutti i fallimenti.

### FE-44 - Gestire token nullable e availability nei grafici e nella tabella

`totalTokens`, coder/reviewer prompt/completion possono essere `null`. Il file usa divisioni, somme e `toLocaleString()` diretti. Deve escludere i valori non disponibili dai grafici e mostrare `n/d`; non convertirli in zero.

### FE-45 - Rendere Oracle duration comparabile e non usare zero come fallback

`LatencyChart` usa `?? 0` per durata Oracle e mostra `0 ms` quando la media e `null`. `PairedCard` passa `oracleDurationMs` nullable a un formatter non-nullable. Il report BE espone conteggi comparabili/esclusi: la UI deve usare `formatNullableDuration` e mostrare i coverage count.

### FE-46 - Migrare churn a process/final e non usare campi legacy

La tabella usa `addedLines/deletedLines`; il BE distingue churn dell'intero processo e della patch finale. La UI deve mostrare entrambi o scegliere esplicitamente quale rappresentare. Il KPI/footer deve usare `averageProcessCodeChurnLines` e `averageFinalCodeChurnLines`.

### FE-47 - Migrare hallucination/grounding alle metriche semantiche correnti

Il file usa `patchGrounding` e `hallucinationRatePct`, mentre il BE congelato espone process/final grounding e rate separati per old-side lines e hunks. La label generica `Allucinazione` e metodologicamente ambigua.

### FE-48 - Separare outcome autonomo, finalizzazione e resolution nelle analytics

La history mostra `metadata.status` e colora attraverso `metrics.resolutionVerified`. Deve mostrare `autonomousStatus` separato da `finalizationStatus` e da `isHumanAugmented`, senza suggerire che APPROVED cambi l'outcome autonomo.

### FE-49 - Correggere il TokenChart e la legenda delle componenti agente

La legenda dichiara quattro serie ma i colori differiscono tra baseline e multi-agent e la scala usa total token nullable. Il grafico deve includere solo run con `agentUsageObserved` e token agent disponibili, oppure segnalare esplicitamente non comparabile.

### FE-50 - Centralizzare/rimuovere la soglia RNF-05 anche negli analytics

La soglia 5% e duplicata in KPI e gauge. Come FE-40, deve provenire da una policy autoritativa verificata o essere rimossa come giudizio di conformita.

### FE-51 - Correggere colSpan e schema tabella dopo la migrazione

La tabella dichiara 19 colonne visibili ma la riga vuota usa `colSpan={18}`. La migrazione delle metriche richiede un modello colonne unico per evitare ulteriori disallineamenti.

## Punti Excel

### FE-41
ID: FE-41
Priorita: P0
Sprint/Area: FE / Research Analytics Contract
Attivita: Riallineare AnalyticsView ai contratti analytics V3 congelati
Problema/Rischio: Il componente usa campi legacy/non presenti nel BE corrente, tra cui `averageTokenToFix`, `averageCodeChurnLines`, `addedLines`, `deletedLines`, `patchGrounding`, `hallucinationRatePct` e metriche overhead da verificare; il file puo non compilare o mostrare dati non piu appartenenti al contratto.
File coinvolti: AnalyticsView.tsx; types/analytics.ts; AnalyticsMetrics.ts se ancora sorgente di metriche supportate
Fix minima: Mappare ogni accesso ai campi effettivi di `AggregatedMetricsReport`, `ModeAggregateMetrics` e `RunSummary`; rimuovere ogni riferimento legacy senza sostituirlo con valori simulati.
Criterio di chiusura: Typecheck FE passa contro i tipi BE correnti e nessun accesso di AnalyticsView fa riferimento a proprieta assenti o deprecate.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: P0 e prerequisito di tutte le altre fix analytics.

### FE-42
ID: FE-42
Priorita: P0
Sprint/Area: FE / Convergence Metrics
Attivita: Distinguere raw convergence e valid-run convergence
Problema/Rischio: La KPI generica `Success Rate` usa una sola percentuale e non mostra la distinzione BE tra tutti i run e soli run validi, rischiando di confondere FAILED/INFRASTRUCTURE_ERROR con mancata convergenza sperimentale.
File coinvolti: AnalyticsView.tsx
Fix minima: Mostrare `rawConvergenceRatePct` con numeratore/denominatore raw e `validRunConvergenceRatePct` con numeratore/denominatore validi, oppure scegliere una sola metrica con label e denominatore espliciti.
Criterio di chiusura: La UI rende visibili i denominatori e non presenta una percentuale generica che mescoli run validi e invalidi.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Preservare `invalidRunCount` come informazione separata.

### FE-43
ID: FE-43
Priorita: P0
Sprint/Area: FE / Recovery Metrics
Attivita: Rendere trasparente il denominatore dell'Autonomous Recovery Rate
Problema/Rischio: Il dettaglio attuale usa `baselineFailuresInPairs`, ma il BE calcola il recovery sui baseline UNRESOLVED eleggibili ed espone separatamente infrastructure e other failure esclusi.
File coinvolti: AnalyticsView.tsx
Fix minima: Mostrare `autonomousRecoveryEligiblePairs`, `autonomousRecoveryInfrastructureExcludedPairs` e `autonomousRecoveryOtherFailureExcludedPairs`; non descrivere il denominatore come tutti i baseline failures.
Criterio di chiusura: Recovery rate, denominatore eleggibile e categorie escluse sono visibili e coerenti con il report BE.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Critico per interpretazione scientifica.

### FE-44
ID: FE-44
Priorita: P0
Sprint/Area: FE / Token Analytics Availability
Attivita: Gestire token nullable e comparabilita agent usage
Problema/Rischio: Grafici, paired card e history sommano/dividono/formattano token nullable come numeri; valori indisponibili possono diventare zero, NaN o causare errori di rendering.
File coinvolti: AnalyticsView.tsx
Fix minima: Usare availability/comparability flags e formatter nullable; includere nei grafici solo valori osservati e mostrare `n/d` negli altri casi.
Criterio di chiusura: Run senza token o agent usage osservato non producono NaN/0 sintetici e sono marcati non disponibili/non comparabili.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Allineato a FE-38 e alle invarianti token BE.

### FE-45
ID: FE-45
Priorita: P0
Sprint/Area: FE / Oracle Duration Analytics
Attivita: Rispettare availability e coverage della durata Oracle
Problema/Rischio: `LatencyChart` converte medie Oracle null in zero e `PairedCard` tratta `oracleDurationMs` nullable come numero; l'assenza di misura viene quindi mostrata come durata osservata zero.
File coinvolti: AnalyticsView.tsx
Fix minima: Usare formatter nullable, non disegnare segmenti per valori assenti e mostrare `oracleDurationComparableRunCount`/`oracleDurationExcludedLegacyRunCount` a livello globale e per mode.
Criterio di chiusura: Null e visualizzato come `n/d`, zero osservato resta `0 ms`, e la UI mostra quanti run partecipano alla media.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Nessun fallback `?? 0` per dati Oracle non disponibili.

### FE-46
ID: FE-46
Priorita: P1
Sprint/Area: FE / Churn Analytics
Attivita: Separare churn di processo e churn finale
Problema/Rischio: La UI usa campi legacy/generici added/deleted e una sola media churn, mentre il BE distingue modifiche accumulate nel processo da patch finale.
File coinvolti: AnalyticsView.tsx
Fix minima: Migrare a `processAddedLines/processDeletedLines` e `finalAddedLines/finalDeletedLines`; usare `averageProcessCodeChurnLines` e `averageFinalCodeChurnLines` con label esplicite.
Criterio di chiusura: Tabelle e KPI distinguono chiaramente process churn e final churn e non usano piu campi generici legacy.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Evitare confronti tra metriche con semantiche diverse.

### FE-47
ID: FE-47
Priorita: P1
Sprint/Area: FE / Patch Grounding Analytics
Attivita: Migrare le metriche di hallucination alle misure grounding process/final
Problema/Rischio: La colonna `Allucinazione` usa campi legacy/generici e nasconde la distinzione BE tra process/final e rate per old-side lines/hunks.
File coinvolti: AnalyticsView.tsx
Fix minima: Visualizzare `processUngroundedOldSideLineRatePct`, `processUngroundedHunkRatePct`, `finalUngroundedOldSideLineRatePct` e `finalUngroundedHunkRatePct`, oppure scegliere un sottoinsieme con label metodologicamente esatta.
Criterio di chiusura: Ogni percentuale mostrata identifica scope (process/final), unita (line/hunk) e denominatore; nessuna label generica usa campi rimossi.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Preferire il termine `ungrounded`/`non ancorato` alla label generica allucinazione.

### FE-48
ID: FE-48
Priorita: P0
Sprint/Area: FE / Analytics Outcome Model
Attivita: Separare outcome autonomo, finalizzazione e Human Override nella history
Problema/Rischio: La tabella mostra `metadata.status` come esito e usa `resolutionVerified` per il colore, senza rendere distinti `autonomousStatus`, `finalizationStatus` e `isHumanAugmented`.
File coinvolti: AnalyticsView.tsx
Fix minima: Aggiungere colonne/presentazione separate per autonomous outcome, finalization status e provenance Human-Augmented; usare `autonomousRunSucceeded`/`candidateVerified` solo con label esplicite.
Criterio di chiusura: Un run UNRESOLVED approvato con Human Override resta visibile come autonomous UNRESOLVED, finalization APPROVED, human augmented true.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Coerente con FE-02/FE-14/FE-15.

### FE-49
ID: FE-49
Priorita: P1
Sprint/Area: FE / Token Chart
Attivita: Rendere il TokenChart coerente con availability e legenda
Problema/Rischio: Il grafico usa componenti agente nullable in calcoli geometrici, non verifica `agentUsageObserved` e usa colori differenti tra mode rispetto alla legenda semantica.
File coinvolti: AnalyticsView.tsx
Fix minima: Filtrare o marcare run non comparabili, calcolare la scala solo su token disponibili e usare una legenda che distingua chiaramente mode e componenti agente.
Criterio di chiusura: Nessuna barra usa valori null/NaN; la legenda descrive univocamente ogni colore e i run esclusi sono segnalati.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Non imputare zero ai reviewer token del baseline se non osservati.

### FE-50
ID: FE-50
Priorita: P1
Sprint/Area: FE / Research Metrics Policy
Attivita: Centralizzare la soglia RNF-05 negli analytics
Problema/Rischio: Il valore 5% e duplicato nel KPI e nel gauge e produce giudizi di conformita locali, con lo stesso rischio gia censito in FE-40.
File coinvolti: AnalyticsView.tsx; modulo policy RNF-05 da identificare
Fix minima: Usare un'unica costante/policy verificata oppure rimuovere il giudizio di conformita e mostrare soltanto la metrica.
Criterio di chiusura: KPI, gauge e TelemetryHUD condividono la stessa policy autoritativa o non mostrano giudizi di conformita.
Stato: Da verificare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Collegato a FE-40; implementare una sola volta.

### FE-51
ID: FE-51
Priorita: P2
Sprint/Area: FE / Analytics Table
Attivita: Allineare schema colonne e colSpan della history table
Problema/Rischio: La tabella visualizza 19 colonne ma la riga empty-state usa `colSpan={18}`; il prossimo refactor delle metriche aumenta il rischio di ulteriori disallineamenti.
File coinvolti: AnalyticsView.tsx
Fix minima: Definire il numero/schema colonne in un'unica struttura o correggere il colSpan in modo coerente con le colonne renderizzate.
Criterio di chiusura: Header, righe dati ed empty-state hanno sempre lo stesso numero di colonne dopo la migrazione analytics.
Stato: Da fare
Completata?: No
Data prevista: Da pianificare
Data completamento:
Owner: Da assegnare
Note: Chiudere contestualmente al refactor della table.
