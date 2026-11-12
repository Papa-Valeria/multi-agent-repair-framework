# Backend Freeze Audit 11 - `UnifiedDiff.ts`

## 1. Scopo

Audit di `UnifiedDiff.ts` nel freeze-check backend, con focus su parsing e validazione del Unified Diff, grounding, normalizzazione deterministica dei diff rifiutati e fallback FUZZY consumato da `GitManager.ts`.

## 2. Sintesi esecutiva

**Esito: PASS CON UN GAP P1 PRE-FREEZE.**

Il file e solido sulla struttura generale: separa parsing, validation, grounding, normalization e in-memory apply; rifiuta ambiguita nel fuzzy matching; protegge i nuovi file da righe non-additive; ricontrolla una normalizzazione prima di restituirla.

E emerso pero un gap strutturale importante: `parseFileDiffs()` legge solo `oldStart` e `newStart` dagli header `@@`, ma non conserva ne verifica `oldCount/newCount`. Di conseguenza `validatePatchStructure()` puo dichiarare valida una patch i cui conteggi dichiarati nell'hunk header non coincidono con le righe effettivamente parse. Il fallback FUZZY e la normalizzazione possono quindi lavorare su una rappresentazione piu permissiva del Unified Diff originale.

Propongo **BE-P1-26**.

## 3. Parsing

`parseFileDiffs()` normalizza CRLF, riconosce una coppia `---`/`+++` seguita immediatamente da `@@`, estrae il target file, identifica `/dev/null` come new file e raccoglie le righe hunk con marker spazio, `-`, `+`.

La rappresentazione `ParsedHunk`, pero, conserva solo:

- `oldStart`;
- `newStart`;
- `lines`.

La regex accetta gli eventuali count (`-start,count` / `+start,count`) ma li scarta.

## 4. Structural validation

`validatePatchStructure()` verifica correttamente:

- presenza file diff;
- presenza hunk;
- almeno una modifica reale;
- nuovi file composti esclusivamente da additions.

Manca pero una verifica di coerenza fra i conteggi dichiarati negli header e le righe effettive dell'hunk, perche tali conteggi non sono disponibili nel modello parse.

## 5. Grounding

`measurePatchGrounding()` esclude correttamente i nuovi file, confronta old-side/context contro le source originali e misura sia linee non grounded sia hunk senza alcun blocco old-side riscontrabile.

La funzione rimane diagnostica e non sostituisce l'applicabilita Git/FUZZY. Non emerge un nuovo bug autonomo in questa parte.

## 6. Normalize rejected diff

`normalizeRejectedDiff()` e conservativa:

- richiede struttura valida;
- richiede source autorevole per file esistenti;
- non altera hunk gia grounded;
- tenta una sola riparazione locale di contesto;
- rifiuta riparazioni ambigue;
- renderizza nuovamente il diff;
- rivalida la struttura;
- verifica che gli hunk normalizzati siano realmente applicabili alle source in memoria.

Questa pipeline e coerente con l'obiettivo di non trasformare arbitrariamente il significato della patch.

## 7. FUZZY apply

`applyHunksToContent()` rifiuta:

- hunk old-side non localizzabili;
- gruppi non localizzabili;
- candidati multipli senza vincitore univoco;
- edit sovrapposti;
- insertion senza contesto significativo.

`pickUnambiguousCandidate()` e `insertionPoint()` sono deliberatamente fail-closed sulle ambiguita.

Questo avvalora il lavoro pregresso sul fallback FUZZY deterministico.

## 8. Gap emerso - hunk header counts non validati

### Evidenza

La regex corrente:

```ts
/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
```

cattura soltanto gli start. I count vengono accettati ma ignorati.

`ParsedHunk` non contiene `oldCount` o `newCount`; `validatePatchStructure()` non puo quindi confrontare:

```text
oldCount dichiarato == numero di righe kind != '+'
newCount dichiarato == numero di righe kind != '-'
```

### Rischio

Una patch malformed puo essere considerata strutturalmente valida dal parser interno pur dichiarando coordinate/count incoerenti. Git potrebbe rifiutarla, ma il fallback interno continua a interpretarla secondo le righe parse. Questo crea una divergenza evitabile fra il contratto Unified Diff dichiarato e quello utilizzato dal fallback FUZZY/normalizer.

### Fix minima

- estendere `ParsedHunk` con `oldCount` e `newCount` parse dall'header;
- rispettare il default Unified Diff quando `,count` e omesso;
- aggiungere una violation strutturale dedicata, ad esempio `HUNK_COUNT_MISMATCH`;
- verificare i count contro le righe parse prima che la patch possa essere candidata a FUZZY/normalization;
- mantenere invariata la logica di locate/apply per patch valide.

### Test richiesti

- count corretti -> PASS;
- old count errato -> rejection;
- new count errato -> rejection;
- count omesso -> semantica Unified Diff corretta;
- new file con count coerenti/incoerenti;
- regression su normalizzazione e fuzzy apply esistenti.

## 9. Nuova riga da aggiungere all'Excel

**ID:** BE-P1-26  
**Priorita:** P1  
**Sprint/Area:** P1 - Hardening  
**Attivita:** Validare i conteggi dichiarati negli hunk Unified Diff  
**Problema/Rischio:** `parseFileDiffs()` accetta gli header `@@ -start,count +start,count @@` ma conserva soltanto `oldStart/newStart`; `validatePatchStructure()` non puo verificare che `oldCount/newCount` coincidano con le righe effettive dell'hunk. Una patch strutturalmente incoerente puo quindi entrare nel normalizer/FUZZY fallback usando una rappresentazione piu permissiva del diff dichiarato.  
**File coinvolti:** `UnifiedDiff.ts; GitManager.ts come consumer; test UnifiedDiff/GitManager FUZZY`  
**Fix minima:** Estendere `ParsedHunk` con `oldCount/newCount`, parsare correttamente anche i count omessi secondo Unified Diff e aggiungere una violation `HUNK_COUNT_MISMATCH` quando i conteggi dichiarati non coincidono con le righe old/new effettive. Non modificare l'algoritmo FUZZY per patch valide.  
**Criterio di chiusura:** Patch con hunk count coerenti continuano a passare; old/new count incoerenti vengono rifiutati prima di Applicability FUZZY/normalization; count omessi sono interpretati correttamente; regression test mirati e suite backend completa verdi.  
**Stato:** Da fare  
**Completata?:** ☐  
**Data prevista:** Da pianificare  
**Data completamento:** —  
**Owner:** Valeria  
**Note:** Emerso durante freeze audit di `UnifiedDiff.ts`. Rafforza il contratto strutturale della patch e riduce divergence fra Unified Diff dichiarato e fallback interno. Rilevante per G3/G10.

## 10. Punti gia svolti avvalorati

Il file avvalora il lavoro gia svolto su:

- parser Unified Diff centralizzato;
- struttura patch reject-on-invalid;
- supporto new file;
- deterministic normalization;
- ambiguous fuzzy rejection;
- patch grounding diagnostico;
- overlap prevention degli edit.

Nessun altro punto va riaperto dal solo file.

## 11. Freeze gates

### G3 - Workspace Isolation Gate

`UnifiedDiff.ts` non esegue I/O, ma definisce la struttura consumata dal meccanismo di apply. BE-P1-26 deve essere chiuso prima di considerare integralmente affidabile il fallback FUZZY.

### G10 - Experimental E2E Gate

La fedelta fra diff generato, validazione e applicazione e parte del contratto E2E. BE-P1-26 va quindi risolto prima del freeze finale insieme a BE-P1-22/23/24/25.

## 12. Esito finale

| Area | Esito |
|---|---|
| File/hunk parsing | Conforme con gap sui count |
| Basic structural validation | Conforme |
| New-file validation | Conforme |
| Grounding diagnostics | Conforme |
| Normalization | Conforme/fail-closed |
| Fuzzy locate | Conforme/fail-closed |
| Ambiguity handling | Conforme |
| Hunk count consistency | Gap P1 |
| Nuovi punti Excel | 1 (`BE-P1-26`) |

**Verdetto:** `PASS CON GAP PRE-FREEZE`.

**Prossimo file raccomandato:** `ContextBuilder.ts`, passando ora dal workspace/patch layer al information contract e alla provenance del contesto.
