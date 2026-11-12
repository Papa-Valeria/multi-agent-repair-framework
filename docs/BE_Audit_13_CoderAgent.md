# Backend Freeze Audit 13 - `CoderAgent.ts`

## 1. Scopo

Audit di `CoderAgent.ts` nel freeze-check backend, con focus su:

- separazione tra model invocation failure e output extraction failure;
- uso del `PromptProfile` versionato;
- protezione preventiva dei test/oracle;
- estrazione e normalizzazione del Unified Diff;
- comportamento REPAIR/CREATE;
- compatibilita con `RefinementFSM.ts`, `GitManager.ts`, `UnifiedDiff.ts` e `ContextBuilder.ts`;
- Freeze Gate G4 - Information Contract / Prompt Gate;
- Freeze Gate G10 - Experimental E2E Gate.

---

## 2. Sintesi esecutiva

**Esito: PASS CON UN GAP P1 PRE-FREEZE.**

Il Coder ha un failure contract tipizzato e coerente con la FSM: gli errori di invocazione modello vengono distinti dagli errori di estrazione dell'output. Il system prompt proviene dal `PromptProfile` iniettato. Esiste una protezione preventiva dei test/oracle e la validazione definitiva dello scope rimane correttamente demandata a `GitManager`.

E emerso pero un gap nell'estrazione del diff: la regex seleziona il **primo code fence compatibile**, anche quando non e marcato `diff`, perche il token `diff` e opzionale. Se il modello restituisce prima un blocco esplicativo o un blocco di codice non-diff e successivamente il vero Unified Diff, `extractDiff()` puo selezionare il blocco sbagliato e ignorare il diff valido. Inoltre non gestisce in modo esplicito piu blocchi diff candidati. Questo puo produrre `DIFF_EXTRACTION_FAILURE` artificiale dipendente dal formatting della risposta e non dalla qualita della patch.

Propongo **BE-P1-28**.

---

## 3. Typed failure contract

Sono definiti due errori distinti:

- `CoderModelInvocationError`;
- `CoderOutputExtractionError`.

`generatePatch()` cattura gli errori del client e li converte in `CoderModelInvocationError`, preservando `originalError`.

L'estrazione produce invece `CoderOutputExtractionError` per output vuoto, modifica di test protetti o assenza di header Unified Diff.

Questo e coerente con `RefinementFSM.classifyTypedCoderFailure()`, che non deve piu interpretare stringhe di errore.

---

## 4. Prompt Profile

Il Coder riceve:

```ts
private readonly promptProfile: PromptProfile = DEFAULT_PROMPT_PROFILE
```

e usa:

```ts
this.promptProfile.coder.systemInstructions
```

Il file non contiene un ID prompt duplicato e non decide localmente la versione del profilo. La provenance rimane quindi coerente con il composition root gia auditato.

---

## 5. Model invocation

Il messaggio al modello e composto da:

- system instructions del profilo;
- user payload prodotto da `ContextBuilder`.

La chiamata usa il ruolo telemetrico `CODER`:

```ts
client.completeChat(messages, 'CODER')
```

Un output vuoto non viene accettato come patch e diventa extraction failure.

---

## 6. Protezione preventiva dei test/oracle

`extractDiff()` costruisce un set dei `testFiles` normalizzati e controlla:

- header `---` e `+++`;
- header `diff --git a/... b/...`.

Se uno dei path coincide con un file test protetto, il Coder output viene rifiutato prima di arrivare all'Applicability Oracle.

Questa e una **defense in depth**. La protezione autorevole resta `GitManager.validatePatchScope()`, che normalizza ulteriormente, valida struttura e applica il repository scope.

Pertanto eventuali limiti della normalizzazione locale del Coder non costituiscono da soli un workspace escape, perche il downstream gate rivalida la patch.

---

## 7. Normalizzazione path locale

`normalizePath()`:

- converte `\\` in `/`;
- applica `trim()`;
- rimuove prefissi `./`;
- rimuove un prefisso `a/` o `b/`;
- lowercase su Windows.

Non applica `path.posix.normalize()` e quindi non e una canonicalizzazione di sicurezza completa. Tuttavia questo metodo serve solo al filtro preventivo; `GitManager` esegue successivamente la validazione autorevole e rifiuta scope/path invalidi.

Non propongo quindi un ticket separato: la centralizzazione delle identita path e gia coperta da BE-P1-24/25.

---

## 8. REPAIR single-target binding

Per REPAIR con un unico target:

```ts
bindToTarget(content, targetFiles[0])
```

puo aggiungere `---`/`+++` a un output che contiene hunk ma non file header.

Questa e una normalizzazione tecnica limitata: non inventa il target, ma usa l'unico target dichiarato dal task.

La patch risultante viene comunque successivamente validata da `GitManager` e `UnifiedDiff`.

---

## 9. Header normalization

Dopo l'estrazione vengono normalizzati gli header privi dei prefissi Git convenzionali verso `a/` e `b/`.

Questa normalizzazione non sostituisce la structural validation downstream. Il Coder si limita a produrre una forma candidata piu vicina al Unified Diff atteso.

---

## 10. Gap emerso - selezione fragile del code fence

### Evidenza

L'estrazione usa:

```ts
/```(?:diff)?\s*([\s\S]*?)\s*```/i
```

Poiche `(?:diff)?` e opzionale, viene selezionato il **primo code fence**, anche se contiene per esempio TypeScript, Python, JSON o testo diagnostico.

`match?.[1]` diventa quindi il contenuto candidato e il resto della risposta viene ignorato.

### Scenario

Output concettuale del modello:

```text
Explanation:
```ts
const x = 1;
```

Patch:
```diff
--- a/src/a.ts
+++ b/src/a.ts
...
```
```

Il Coder puo estrarre il blocco TypeScript, non il blocco diff valido.

### Rischio

- falso `DIFF_EXTRACTION_FAILURE`;
- consumo non necessario di retry tecnici/semantici;
- risultati sperimentali sensibili alla formattazione accessoria del modello;
- possibile differenza artificiale nei tassi di successo pur in presenza di un diff valido nella risposta.

### Fix minima

Implementare una selezione deterministica dei candidati:

1. preferire blocchi fenced esplicitamente marcati `diff`;
2. se non esistono, considerare blocchi che contengono una struttura Unified Diff riconoscibile;
3. in assenza di fence, usare l'intera risposta solo se contiene una struttura diff valida;
4. se esistono piu candidati diff concorrenti, rifiutare come output ambiguo oppure combinarli solo attraverso un parser strutturale esplicitamente testato;
5. lasciare a `GitManager/UnifiedDiff` la validazione autorevole finale.

Non serve modificare il Prompt Profile per chiudere il bug.

---

## 11. Nuova riga da aggiungere all'Excel

**ID:** BE-P1-28  
**Priorita:** P1  
**Sprint/Area:** P1 - Hardening  
**Attivita:** Rendere deterministica l'estrazione del Unified Diff dal Coder  
**Problema/Rischio:** `CoderAgent.extractDiff()` usa una regex in cui il language tag `diff` e opzionale e seleziona il primo code fence della risposta. Se il modello restituisce un blocco esplicativo/non-diff prima di un valido blocco `diff`, il Coder puo ignorare la patch valida e produrre un falso `DIFF_EXTRACTION_FAILURE`; piu candidati diff non sono gestiti esplicitamente.  
**File coinvolti:** `CoderAgent.ts; UnifiedDiff.ts come validatore/parser downstream; test CoderAgent output extraction`  
**Fix minima:** Selezionare deterministicamente prima i fence marcati `diff`; in fallback accettare solo contenuti con struttura Unified Diff riconoscibile; gestire esplicitamente zero/uno/piu candidati senza scegliere implicitamente il primo fence generico. Mantenere la validazione definitiva in GitManager/UnifiedDiff.  
**Criterio di chiusura:** Una risposta con preambolo o code fence non-diff seguito da un unico blocco diff valido estrae sempre il diff corretto; output senza diff resta `CoderOutputExtractionError`; candidati diff multipli/ambigui sono gestiti deterministicamente; test file protection invariata; regression suite backend verde.  
**Stato:** Da fare  
**Completata?:** ☐  
**Data prevista:** Da pianificare  
**Data completamento:** —  
**Owner:** Valeria  
**Note:** Emerso durante freeze audit di `CoderAgent.ts`. Impatta robustezza/reproducibilita dell'output contract e G10; fix locale senza cambiare il modello o la FSM.

---

## 12. Punti gia svolti avvalorati

Il file avvalora:

- errori Coder tipizzati;
- separazione model invocation/output extraction;
- Prompt Profile centralizzato;
- protezione preventiva dei test;
- ruolo telemetry `CODER`;
- downstream validation come fonte autorevole della patch.

Non emergono altre riaperture necessarie.

---

## 13. Freeze gates

### G4 - Information Contract / Prompt Gate

Il Coder consuma correttamente lo stesso user payload e il profilo prompt iniettato. G4 resta aperto per BE-P1-27 sul test contract.

### G10 - Experimental E2E Gate

BE-P1-28 va chiuso per evitare che una risposta contenente una patch valida venga classificata come failure per il solo ordine dei code fences.

---

## 14. Riepilogo nuovi punti audit

Con questo file il freeze audit ha fatto emergere:

- BE-P1-22 - failure boundary FSM;
- BE-P1-23 - invarianti globali WorkbenchSessionState;
- BE-P1-24 - matching path DiffScoper;
- BE-P1-25 - realpath normalizeRejectedPatch;
- BE-P1-26 - hunk count Unified Diff;
- BE-P1-27 - test contract ContextBuilder;
- BE-P1-28 - diff extraction CoderAgent.

Questa lista e di riepilogo e non va duplicata nel foglio se le righe sono gia state inserite.

---

## 15. Esito finale

| Area | Esito |
|---|---|
| Model invocation errors | Conforme |
| Output extraction errors | Conforme e tipizzato |
| Prompt profile usage | Conforme |
| Test protection defense-in-depth | Conforme |
| REPAIR single-target binding | Conforme |
| Header normalization | Conforme come pre-processing |
| Path normalization locale | Non-authoritative, coperta downstream |
| Diff candidate selection | Gap P1 |
| Nuovi punti Excel | 1 (`BE-P1-28`) |

**Verdetto:** `PASS CON GAP PRE-FREEZE`.

**Prossimo file raccomandato:** `ReviewerAgent.ts`.
