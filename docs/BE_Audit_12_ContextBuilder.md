# Backend Freeze Audit 12 - `ContextBuilder.ts`

## 1. Scopo

Audit di `ContextBuilder.ts` nel freeze-check backend, con focus su:

- information contract iniziale Baseline/Multi-Agent;
- lettura confinata di target e test;
- immutabilita degli oracle di test nel prompt;
- provenance/versionamento del Prompt Profile;
- refinement context e cumulative remediations;
- technical retry context;
- fedelta del test contract estratto dal test source;
- Freeze Gate G4 - Information Contract / Prompt Gate;
- Freeze Gate G10 - Experimental E2E Gate.

---

## 2. Sintesi esecutiva

**Esito: PASS CON UN GAP P1 PRE-FREEZE.**

`ContextBuilder.ts` e ben strutturato sulla provenance e sul confinement: usa `RepositoryPathPolicy` per ogni file, conserva un `baseContext` autorevole costruito una sola volta, rende esplicito che il repository e stato rollbackato prima del refinement, usa `PromptProfile` iniettato e mantiene distinti retry tecnico e refinement semantico.

E emerso pero un punto rilevante per l'information contract: `extractSignaturesAndAssertions()` non estrae realmente signatures + assertions in modo affidabile. La funzione seleziona soltanto singole righe contenenti quattro pattern lessicali (`def test_`, `assert `, `it(`, `expect(`). Questo puo perdere setup/fixture/import, corpo di assertion multilinea e test definiti con sintassi diversa; puo inoltre includere righe casuali che contengono tali sottostringhe. Di conseguenza il `TEST CONTRACT (read-only)` fornito al modello puo essere incompleto rispetto all'oracle realmente eseguito.

Propongo **BE-P1-27**.

---

## 3. Initial Context Contract

`buildInitialPayload()` riceve un unico `InitialContextParams` contenente:

- issue specification;
- target files;
- test files;
- category;
- configurazioni oracle.

La FSM gia auditata usa la stessa `buildInitialPayload(params)` sia per Baseline sia per Multi-Agent, quindi questo file conferma la parita dell'information contract iniziale a livello di builder.

Le differenze fra Baseline e Multi-Agent vengono introdotte successivamente dal refinement, non da un diverso initial payload contract.

---

## 4. Target source authority

Ogni target viene risolto mediante:

```ts
resolveRepositoryPath(...)
```

Per `CREATE` e consentito `allowMissing`; un target mancante viene rappresentato con:

```ts
promptProfile.contextBuilder.newFileTargetMarker
```

Per `REPAIR`, una lettura fallita viene propagata e la FSM la classifica come context build failure.

Quindi non vengono inventati contenuti per target esistenti non leggibili.

---

## 5. Test contracts read-only

I test file vengono anch'essi risolti con `RepositoryPathPolicy` senza `allowMissing`, quindi devono esistere e rimanere confinati nel repository.

Nel payload vengono marcati esplicitamente come:

```text
TEST CONTRACT (read-only)
```

Questo e coerente con la protezione dei test gia verificata in `GitManager.ts`.

---

## 6. Prompt Profile

Il builder riceve:

```ts
PromptProfile = DEFAULT_PROMPT_PROFILE
```

Le direttive CREATE/REPAIR, le istruzioni diff, refinement, technical retry e il marker new-file derivano dal profilo iniettato.

Non risultano costanti `PROMPT_PROFILE_ID` duplicate dentro `ContextBuilder`, coerentemente con il refactoring gia svolto. La provenance del prompt resta quindi centralizzata nel `PromptProfile`.

---

## 7. Base context e refinement

Dopo `buildInitialPayload()` viene memorizzato:

```ts
this.baseContext = {
  issueSpec,
  targets,
  testContracts,
  category
}
```

Il refinement riutilizza esattamente questo contesto originale, non rilegge dal filesystem la patch precedente applicata.

Il prompt dichiara inoltre esplicitamente che:

- la patch precedente e stata rollbackata;
- il repository e tornato al clean HEAD originario;
- i target originali sono l'unica source authority;
- la patch precedente e soltanto evidence del tentativo.

Questo e coerente con il modello transazionale della FSM.

---

## 8. Cumulative remediation contract

`buildRefinementPayload()` rifiuta una chiamata senza remediation cumulative:

```ts
if (cumulativeRemediations.length === 0) throw ...
```

Il payload conserva per ogni remediation:

- file;
- line range;
- prima/ultima osservazione;
- observation count;
- root cause;
- correction obbligatoria;
- related rule eventuale.

Questa struttura supporta la reproducibilita del refinement e riduce la perdita di feedback fra iterazioni.

---

## 9. Technical retry separato dal refinement

`buildTechnicalRetryPayload()` riceve il semantic payload invariato e aggiunge soltanto:

- attempt number;
- Applicability diagnosis;
- rejected patch;
- technical retry instructions.

Quindi un retry tecnico non viene confuso con una nuova semantic iteration. Questo e coerente con `maxTechnicalAttempts` e `maxIterations` gia auditati nella FSM.

---

## 10. Prompt fencing

`fence()` calcola dinamicamente una sequenza di backtick piu lunga della massima sequenza gia presente nel contenuto.

Questo evita che source/test/diff contenenti normali code fences chiudano accidentalmente il blocco delimitato.

La normalizzazione CRLF -> LF rende inoltre stabile la rappresentazione testuale.

---

## 11. Gap emerso - test contract lessicale e potenzialmente incompleto

### Evidenza

La funzione corrente e:

```ts
return testSource
  .split('\n')
  .filter((l) =>
    l.includes('def test_') ||
    l.includes('assert ') ||
    l.includes('it(') ||
    l.includes('expect(')
  )
  .join('\n');
```

### Rischio

Questa non e una vera estrazione di signatures + assertions. In particolare puo perdere informazione necessaria all'understanding del contratto test, per esempio:

- fixture/setup e valori parametrizzati;
- import o helper che definiscono il significato dei valori attesi;
- assertion multilinea;
- `test(...)` Jest invece di `it(...)` se non contiene anche `expect` sulla stessa riga;
- pytest parametrizzato/decorator;
- unittest-style assertions;
- blocchi `expect(...).to...` distribuiti su piu righe;
- altre sintassi supportate dal Functional Test Oracle.

Il rischio non e che i test reali smettano di essere eseguiti: `TestHarness` usa i file completi. Il rischio e **asimmetria informativa**: il modello riceve un contratto parziale, mentre il verifier valuta contro il contratto completo.

### Impatto sperimentale

- riduzione artificiale dell'informazione disponibile al Coder;
- possibilita di failure dovuti a requisiti presenti nei test ma invisibili nel prompt;
- information contract difficile da difendere come deterministico/corretto rispetto agli oracle reali;
- possibile bias tra task con test scritti in stili differenti.

### Fix minima

Per il freeze attuale, evitare un parser AST multi-linguaggio invasivo. La fix piu difendibile e una delle seguenti, da scegliere mantenendo un contratto unico:

1. includere integralmente il contenuto dei test autorizzati come read-only oracle contract; oppure
2. introdurre un extractor esplicitamente configurato/versionato per il linguaggio del benchmark e coperto da test di completezza.

Dato l'attuale profilo Python/pytest e l'obiettivo di riproducibilita, l'opzione 1 e la piu piccola e meno ambigua: i test sono gia autorizzati dal manifest e protetti da `GitManager`; fornire il file completo elimina l'euristica lessicale senza cambiare la source authority.

Se il volume del contesto e un vincolo sperimentale, allora l'estrazione deve diventare un profilo versionato e testato, non una ricerca per sottostringhe implicita.

---

## 12. Nuova riga da aggiungere all'Excel

**ID:** BE-P1-27  
**Priorita:** P1  
**Sprint/Area:** P1 - Hardening  
**Attivita:** Rendere completo e riproducibile il Test Contract fornito al Coder  
**Problema/Rischio:** `ContextBuilder.extractSignaturesAndAssertions()` costruisce il `TEST CONTRACT` filtrando singole righe che contengono soltanto `def test_`, `assert `, `it(` o `expect(`. L'euristica puo perdere fixture/setup, parametrizzazione, import/helper, assertion multilinea e sintassi test alternative, creando asimmetria tra il contratto visibile al modello e gli oracle completi realmente eseguiti dal TestHarness.  
**File coinvolti:** `ContextBuilder.ts; PromptProfile.ts se il contratto test viene versionato; test ContextBuilder/information contract`  
**Fix minima:** Eliminare l'euristica lessicale implicita. Preferibilmente includere integralmente i test file autorizzati come `TEST CONTRACT (read-only)` nel profilo corrente; se il volume impone estrazione, introdurre un extractor esplicitamente configurato/versionato e coperto da test per la sintassi del benchmark.  
**Criterio di chiusura:** Il Coder riceve un test contract deterministico che non perde fixture, parametrizzazioni o assertion rilevanti nei test autorizzati; Baseline e Multi-Agent ricevono lo stesso initial contract; i test restano read-only/protetti; regression test su test multilinea/parametrizzati e suite backend completa verdi.  
**Stato:** Da fare  
**Completata?:** ☐  
**Data prevista:** Da pianificare  
**Data completamento:** —  
**Owner:** Valeria  
**Note:** Emerso durante freeze audit di `ContextBuilder.ts`. Impatta Information Contract e G10. Evitare un parser multi-linguaggio pre-freeze se non necessario; preferire il contratto completo read-only per il benchmark corrente.

---

## 13. Punti gia svolti avvalorati

Il file avvalora:

- parita dell'initial context Baseline/Multi-Agent;
- context build fail-closed tramite `RepositoryPathPolicy`;
- target source authority;
- test immutabili/read-only nel prompt;
- Prompt Profile centralizzato;
- cumulative remediation;
- separazione technical retry / semantic refinement;
- rollback-aware refinement context.

Nessun altro punto gia completato richiede riapertura dal solo file.

---

## 14. Righe Excel cumulative emerse finora

Il nuovo punto di questo file e **BE-P1-27**. Restano inoltre aperti i nuovi punti precedentemente emersi durante il freeze audit:

- BE-P1-22 - failure boundary FSM;
- BE-P1-23 - invarianti globali WorkbenchSessionState;
- BE-P1-24 - matching path DiffScoper;
- BE-P1-25 - realpath containment normalizeRejectedPatch;
- BE-P1-26 - hunk count Unified Diff.

Questa sezione e solo di riepilogo; non crea duplicati nel foglio Excel.

---

## 15. Freeze gates

### G4 - Information Contract / Prompt Gate

Il builder e coerente su provenance, source authority e refinement, ma BE-P1-27 impedisce di dichiarare definitivamente completo il test information contract.

### G10 - Experimental E2E Gate

Il verifier usa i test completi mentre il Coder riceve un estratto euristico. Per una comparazione sperimentale difendibile conviene eliminare questa asimmetria prima del freeze finale.

---

## 16. Esito finale

| Area | Esito |
|---|---|
| Repository path confinement | Conforme |
| Target source authority | Conforme |
| Read-only test labeling | Conforme |
| Prompt profile provenance | Conforme |
| Initial context parity | Conforme |
| Refinement base context | Conforme |
| Cumulative remediation | Conforme |
| Technical retry separation | Conforme |
| Prompt fencing | Conforme |
| Test contract extraction | Gap P1 |
| Nuovi punti Excel | 1 (`BE-P1-27`) |

**Verdetto:** `PASS CON GAP PRE-FREEZE`.

**Prossimo file raccomandato:** `CoderAgent.ts`, per verificare il consumer diretto di questo information contract e il contratto di output Unified Diff.
