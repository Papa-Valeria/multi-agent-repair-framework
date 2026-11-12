# Backend Freeze Audit 14 - `ReviewerAgent.ts`

## 1. Scopo

Audit di `ReviewerAgent.ts` nel freeze-check backend, con focus su:

- input diagnostico fornito al Reviewer;
- parsing e validazione dell'output JSON;
- provenance `LLM` / `DETERMINISTIC_FALLBACK`;
- protezione di test e oracle;
- autorizzazione e deduplicazione delle remediation;
- fallback deterministico;
- coerenza con `RefinementFSM.ts`, `VerificationInvariants.ts`, `ContextBuilder.ts` e `GitManager.ts`;
- Freeze Gate G4 - Information Contract / Prompt Gate;
- Freeze Gate G10 - Experimental E2E Gate.

---

## 2. Sintesi esecutiva

**Esito: PASS - nessun nuovo punto autonomo da aggiungere all'Excel.**

Il Reviewer applica un contratto strutturato e fail-closed: l'output LLM deve essere un singolo oggetto JSON valido, ogni remediation viene validata campo per campo, normalizzata, filtrata rispetto a target/test/category e deduplicata. Se inferenza, parsing, schema o policy falliscono, il componente tenta un fallback deterministico costruito esclusivamente dalle evidenze degli oracle. La provenance del risultato viene restituita esplicitamente come `LLM` oppure `DETERMINISTIC_FALLBACK`, con `fallbackReason` obbligatoria nel secondo caso.

Non sono emersi difetti pre-freeze distinti da quelli gia registrati. Alcune euristiche testuali sono conservative e possono produrre fallback aggiuntivi, ma non consentono di bypassare i gate downstream e non giustificano un nuovo P1.

---

## 3. Input diagnostico

Il Reviewer riceve dati strutturati, non il repository completo:

- category;
- target files;
- flapping flag;
- Build/Syntax diagnostic;
- finding SAST selezionati;
- failure funzionali concise.

Per Build FAIL conserva command, args, cwd, timeout, exit code, summary e output troncato. Per altri stati conserva status e summary.

Il Functional Test entra nel prompt con status e failure details solo quando `oracleStatus === 'FAIL'`. Execution errors e unavailable non vengono trasformati in normali remediation di codice; nella FSM tali casi terminano prima della review.

---

## 4. Pruning diagnostico

`pruneAndAggregate()` applica una policy deterministica:

- se esistono finding `ERROR`, usa quel tier;
- altrimenti conserva al massimo i primi cinque finding;
- riduce i test failure a nome, messaggio massimo 300 caratteri ed eventuale expected/actual.

Il numero di finding esclusi viene conservato come `violationsPrunedCount`.

Il pruning e quindi osservabile nel feedback e non viene presentato come set completo.

---

## 5. Parsing JSON fail-closed

`extractJsonPayload()` accetta soltanto:

1. un oggetto JSON puro che occupa l'intera risposta; oppure
2. un singolo code fence JSON che occupa l'intera risposta.

Preamboli, testo successivo e blocchi non-oggetto vengono rifiutati e attivano il fallback deterministico.

`parseJsonObject()` separa gli errori sintattici JSON dagli errori di schema applicati successivamente.

---

## 6. Validazione schema Reviewer

`parseReviewerResponse()` richiede:

- `rootCauseSummary` non vuoto;
- `targetRemediations` array non vuoto.

Ogni remediation richiede:

- file non vuoto;
- root cause non vuota;
- mandatory correction non vuota;
- line range con start intero positivo;
- end intero non inferiore a start;
- related rule string quando presente.

Il risultato viene trim-mato prima dell'uso. Non vengono accettati payload parziali o remediation prive di localizzazione minima.

---

## 7. Autorizzazione delle remediation

`filterAllowedRemediations()` applica le policy seguenti:

- file vuoto -> rifiuto;
- file corrispondente a test protetto -> rifiuto;
- in REPAIR, file non presente nei target -> rifiuto;
- in CREATE, possono essere proposti nuovi file sorgente;
- remediation che propone mutazioni di test/assertion/oracle -> rifiuto;
- duplicati semantici -> rimozione.

La deduplicazione usa file normalizzato, rule ID e mandatory correction normalizzata.

Questa e una defense in depth. Il Coder produce comunque una patch che verra definitivamente validata da `GitManager.validatePatchScope()` e `RepositoryPathPolicy`.

---

## 8. Protezione degli oracle

`containsProtectedOracleMutation()` cerca formulazioni che propongono di cambiare test, assertion o oracle.

La policy e intenzionalmente conservativa. Un falso positivo non autorizza una mutazione: elimina la remediation LLM e puo portare al fallback deterministico o a `REVIEWER_FAILURE` se nessuna remediation autorizzata e disponibile.

Dal punto di vista del freeze di sicurezza, il comportamento e fail-closed.

### Osservazione non bloccante

Le regex sono linguistiche e prevalentemente inglesi. Possono occasionalmente filtrare una remediation valida che menziona i test in forma negativa, oppure non riconoscere tutte le formulazioni in altre lingue. La protezione autorevole non dipende pero da queste regex: test e scope vengono nuovamente protetti da Coder/GitManager. Questo puo essere valutato come miglioramento post-freeze, non come nuovo blocker P1.

---

## 9. Provenance Reviewer

In caso di successo LLM viene restituito:

```ts
reviewerMode: 'LLM'
```

In caso di inferenza, parsing, schema o policy failure viene tentato il fallback e, se valido, viene restituito:

```ts
reviewerMode: 'DETERMINISTIC_FALLBACK'
fallbackReason: <errore originale>
```

Questa provenance e coerente con:

- le validazioni locali della FSM;
- `assertWorkbenchSessionInvariants()`;
- la persistenza nell'IterationRecord.

Il componente non maschera il fallback come output LLM.

---

## 10. Fallback deterministico

Il fallback costruisce remediation esclusivamente da evidenze strutturate:

- Build/Syntax FAIL;
- finding SAST selezionati;
- Functional Test FAIL.

Le remediation vengono poi sottoposte alla stessa `filterAllowedRemediations()` usata per l'output LLM.

Se esiste una source failure ma non una localizzazione affidabile, viene prodotto un fallback generico sul primo target. Se anche quello non e autorizzabile, il metodo fallisce esplicitamente invece di inventare una remediation valida.

Questa failure viene catturata dalla FSM e classificata come `REVIEWER_FAILURE` nei normali boundary gia analizzati.

---

## 11. CREATE e nuovi file

In categoria CREATE, il Reviewer puo proporre file non gia presenti nei target. Questo e coerente con la policy CREATE del `GitManager`, che permette nuovi source file ma continua a impedire modifiche ai test e path fuori repository.

`ReviewerAgent` non costituisce il boundary finale per i path. Eventuali path impropri suggeriti dal modello restano testo di remediation e non vengono scritti direttamente; la patch successiva deve superare Coder extraction, UnifiedDiff, PatchScope e RepositoryPathPolicy.

Non viene quindi aperto un nuovo ticket path-specific oltre a BE-P1-24 e BE-P1-25 gia registrati.

---

## 12. Coerenza con i file gia auditati

### `RefinementFSM.ts`

La FSM valida le modalita ammesse e richiede `fallbackReason` per il fallback deterministico. Il contratto del Reviewer e compatibile con tali controlli.

Il solo gap FSM gia registrato e il caso teorico `reviewResult === undefined` fuori dal catch, incluso in BE-P1-22; non nasce da `ReviewerAgent.ts`, che ritorna un risultato oppure solleva.

### `VerificationInvariants.ts`

Le regole su `reviewerMode`, `reviewerFeedback` e `fallbackReason` coincidono con i risultati prodotti dal Reviewer.

### `ContextBuilder.ts`

Il feedback autorizzato viene trasformato in cumulative remediation e usato nel refinement payload. Il gap BE-P1-27 riguarda il test contract iniziale, non la forma del feedback Reviewer.

### `GitManager.ts`

Le remediation non applicano patch direttamente. La patch prodotta dal Coder resta soggetta alla validazione autorevole di file protetti e scope.

---

## 13. Punti gia svolti avvalorati

Il file avvalora:

- provenance Reviewer esplicita;
- fallback deterministico osservabile;
- JSON schema validation;
- test/oracle protection defense-in-depth;
- remediation deduplication;
- security priority strict;
- flapping propagation;
- separazione LLM/fallback/orchestrator gia validata nella FSM.

Nessun punto completato richiede riapertura sulla base del file.

---

## 14. Righe da aggiungere all'Excel

**Nessuna nuova riga.**

Le osservazioni residue non costituiscono un nuovo blocker pre-freeze:

- l'euristica linguistica sulle mutazioni protette e fail-closed e coperta da gate downstream;
- la canonicalizzazione path autorevole e gia coperta dai punti BE-P1-24/25;
- il boundary Reviewer della FSM e gia coperto da BE-P1-22.

---

## 15. Freeze gates

### G4 - Information Contract / Prompt Gate

Il Reviewer contract e conforme: input diagnostico strutturato, Prompt Profile iniettato e output JSON validato. G4 resta aperto per BE-P1-27 nel `ContextBuilder`.

### G10 - Experimental E2E Gate

La provenance del Reviewer e riproducibile e il fallback e osservabile. Nessun nuovo blocker E2E emerge da questo file. Restano i blocker gia censiti BE-P1-22 fino a BE-P1-28.

---

## 16. Riepilogo nuovi punti audit

Nessun nuovo punto da questo file. Restano cumulativamente:

- BE-P1-22 - failure boundary FSM;
- BE-P1-23 - invarianti globali WorkbenchSessionState;
- BE-P1-24 - matching path DiffScoper;
- BE-P1-25 - realpath normalizeRejectedPatch;
- BE-P1-26 - hunk count Unified Diff;
- BE-P1-27 - test contract ContextBuilder;
- BE-P1-28 - diff extraction CoderAgent.

---

## 17. Esito finale

| Area | Esito |
|---|---|
| Prompt Profile usage | Conforme |
| Diagnostic pruning | Conforme e osservabile |
| JSON extraction | Conforme/fail-closed |
| Schema validation | Conforme |
| Target/test authorization | Conforme come defense-in-depth |
| Oracle mutation protection | Conforme/fail-closed |
| Deduplication | Conforme |
| LLM provenance | Conforme |
| Deterministic fallback provenance | Conforme |
| Fallback evidence sourcing | Conforme |
| Compatibilita FSM/invariants | Conforme |
| Nuovi punti Excel | Nessuno |

**Verdetto:** `PASS - nessuna fix autonoma richiesta in ReviewerAgent.ts`.

**Prossimo file raccomandato:** `PromptProfile.ts`, per completare la verifica del contratto prompt/versionamento prima di passare all'inference client e alla telemetria.
