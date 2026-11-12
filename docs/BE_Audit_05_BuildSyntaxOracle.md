# Backend Freeze Audit 05 - `BuildSyntaxOracle.ts`

## 1. Scopo

Audit di `BuildSyntaxOracle.ts` nel freeze-check backend, con focus su:

- correttezza semantica degli outcome `PASS`, `FAIL`, `NOT_AVAILABLE`, `EXECUTION_ERROR`;
- configurazione task-driven del Build/Syntax Oracle;
- containment del `cwd` nel repository;
- gestione timeout/process failure;
- coerenza con `VerificationInvariants.ts`, `OracleDecision.ts` e `RefinementFSM.ts` già analizzati;
- Freeze Gate G2 - Oracle Integrity Gate;
- Freeze Gate G3 - Workspace Isolation Gate.

---

## 2. Sintesi esecutiva

**Esito: PASS - nessun nuovo gap bloccante emerso nel file.**

`BuildSyntaxOracle` è configurabile tramite `BuildOracleConfig`, non contiene un comando di build hardcoded, distingue correttamente assenza di configurazione da errore di esecuzione e da build/syntax failure, conserva evidenza operativa completa e applica una doppia protezione sul `cwd`: containment lessicale e containment sul real path.

La semantica prodotta è compatibile con `assertBuildSyntaxResultInvariants()` già analizzato.

Non emergono nuovi punti da aggiungere all'Excel sulla base di questo file.

---

## 3. Configurazione task-driven

L'oracle riceve:

```ts
config?: BuildOracleConfig
required: boolean
```

Il comando, gli argomenti, il timeout e la env allow-list sono quindi esterni al producer:

```ts
const {
  command,
  args,
  timeoutMs,
  envAllowList
} = config;
```

Il file non assume `npm`, `tsc`, `python`, `pytest` o un altro tool specifico. Questo è coerente con il lavoro già svolto per rendere il Build/Syntax Oracle task-driven.

---

## 4. Semantica degli outcome

### 4.1 Config assente

Quando `config === undefined`, il producer restituisce:

```text
BUILD_SYNTAX / NOT_AVAILABLE
```

con `required` preservato e senza simulare un PASS.

Questa è una semantica fail-closed corretta: se il profilo richiede l'oracle, `OracleDecision` impedirà la convergenza.

### 4.2 CWD non valido

Una failure di `resolveExecutionCwd()` restituisce:

```text
BUILD_SYNTAX / EXECUTION_ERROR
```

con `executionError` esplicito e `exitCode: null`.

Non viene confusa con una build fallita.

### 4.3 Timeout

`result.timedOut` produce:

```text
BUILD_SYNTAX / EXECUTION_ERROR
```

Il timeout non viene classificato come `FAIL`, quindi non viene interpretato come evidenza negativa valida sul candidato.

### 4.4 Process execution error

`result.executionError` produce `EXECUTION_ERROR`, preservando l'evidenza restituita dal `ProcessRunner`.

### 4.5 Exit code assente

`exitCode === null` viene classificato come `EXECUTION_ERROR`.

### 4.6 Exit code non-zero

Un processo completato senza timeout/execution error ma con exit code diverso da zero produce:

```text
BUILD_SYNTAX / FAIL
```

Questa è la distinzione corretta tra failure del candidato e failure dell'infrastruttura.

### 4.7 Exit code zero

Produce `PASS`.

La combinazione è coerente con le invarianti verificate in `VerificationInvariants.ts`:

- PASS -> exit 0;
- FAIL -> exit non-zero;
- EXECUTION_ERROR -> evidenza di problema esecutivo;
- NOT_AVAILABLE -> assenza di config.

---

## 5. Evidenza e riproducibilità

Per un'esecuzione reale viene persistita nel risultato Oracle l'evidenza:

- `command`;
- `args`;
- `cwd` effettivo;
- `timeoutMs`;
- `envAllowList`;
- `exitCode`;
- `timedOut`;
- stdout/stderr;
- flag di truncation;
- eventuale `executionError`.

Questo rende il verdetto osservabile e coerente con il profilo sperimentale che conserva separatamente la configurazione Build/Syntax.

---

## 6. Workspace containment del CWD

`resolveExecutionCwd()` implementa più livelli di protezione.

### 6.1 Percorsi assoluti rifiutati

Sono rifiutati sia:

```ts
path.isAbsolute(configuredCwd)
```

sia:

```ts
path.win32.isAbsolute(configuredCwd)
```

quindi il controllo considera anche input Windows quando il processo Node gira su un'altra piattaforma.

### 6.2 Containment lessicale

Il path risolto viene confrontato con `repositoryRoot` tramite `path.relative()`. Sono rifiutati:

- `..`;
- prefissi `../` equivalenti nella piattaforma corrente;
- relative path che risultano assoluti.

### 6.3 Protezione `.git`

La funzione rifiuta un `cwd` che punti a `.git`, sia prima sia dopo il realpath.

### 6.4 Containment reale

Dopo la risoluzione lessicale vengono calcolati:

```ts
fs.realpathSync(repositoryRoot)
fs.realpathSync(executionCwd)
```

ed eseguito un secondo containment check. Questo protegge dal caso in cui un path apparentemente interno risolva realmente fuori dal repository tramite link filesystem.

### 6.5 Directory reale obbligatoria

`fs.statSync(realExecutionCwd).isDirectory()` impedisce di usare un file come directory di esecuzione.

### Valutazione G3

Questo file fornisce evidenza forte a favore del Workspace Isolation Gate per la parte Build/Syntax. G3 resta da chiudere dopo l'audit di `RepositoryPathPolicy.ts` e `GitManager.ts`.

---

## 7. Boundary delle exception

L'esecuzione del processo è racchiusa in un `try/catch` che converte exception inattese in `EXECUTION_ERROR` strutturato.

Questa proprietà è importante anche rispetto al gap **BE-P1-22** appena emerso nella FSM: il producer Build/Syntax non presenta lo stesso problema, perché le exception interne vengono già trasformate in `OracleResult` osservabili.

---

## 8. Coerenza con i componenti già auditati

### `VerificationInvariants.ts`

Il producer genera combinazioni coerenti con `assertBuildSyntaxResultInvariants()`.

Non sono emerse combinazioni producer/invariant incompatibili.

### `OracleDecision.ts`

- `FAIL` può contribuire a `shouldRefine`;
- `EXECUTION_ERROR` blocca refinement/convergence;
- `NOT_AVAILABLE`, se required, blocca convergence.

La semantica del producer è quindi compatibile con la decision logic.

### `RefinementFSM.ts`

La FSM chiama subito dopo il producer:

```ts
assertBuildSyntaxResultInvariants(buildSyntax)
```

quindi il risultato viene ricontrollato da un boundary indipendente prima di entrare nella decisione complessiva.

---

## 9. Osservazioni non bloccanti

### 9.1 Uso di API filesystem sincrone

`realpathSync()` e `statSync()` vengono usati dentro un metodo async. È una scelta implementativa sincrona, ma il costo è limitato alla validazione del cwd e non emerge dal file un problema di correttezza sperimentale o sicurezza che giustifichi un ticket pre-freeze.

### 9.2 Diagnostic summary troncato a 500 caratteri

Il summary del FAIL usa:

```ts
diagnostic.slice(0, 500)
```

L'evidenza conserva invece stdout/stderr completi secondo il comportamento del `ProcessRunner` e relativi flag di truncation. Pertanto il taglio del summary non comporta perdita dell'evidenza strutturale disponibile nel risultato.

---

## 10. Punti già svolti avvalorati

Il file conferma i lavori già svolti relativi a:

- Build/Syntax Oracle task-driven;
- distinzione `NOT_AVAILABLE` / `FAIL` / `EXECUTION_ERROR`;
- timeout esposto come execution failure;
- evidence della configurazione effettiva;
- containment del cwd nel repository;
- invariant check producer-independent eseguito dal consumer.

Nessun punto già marcato come completato richiede riapertura sulla base di questo file.

---

## 11. Righe da aggiungere all'Excel

**Nessuna nuova riga.**

Non sono emersi difetti autonomi da aggiungere al backlog.

---

## 12. Freeze gates

### G2 - Oracle Integrity Gate

`BuildSyntaxOracle.ts` è conforme al contratto analizzato in `VerificationInvariants.ts` e `OracleDecision.ts`.

Dopo questo audit, per G2 restano da verificare principalmente:

- `TestHarness.ts`;
- `SemgrepEngine.ts`.

### G3 - Workspace Isolation Gate

Il containment del cwd Build/Syntax è robusto e fail-closed. G3 resta aperto fino all'audit delle primitive comuni di path/Git.

---

## 13. Esito finale

| Area | Esito |
|---|---|
| Configurazione task-driven | Conforme |
| PASS semantics | Conforme |
| FAIL semantics | Conforme |
| NOT_AVAILABLE semantics | Conforme |
| EXECUTION_ERROR semantics | Conforme |
| Timeout handling | Conforme |
| Process exception boundary | Conforme |
| CWD lexical containment | Conforme |
| CWD realpath containment | Conforme |
| `.git` protection | Conforme |
| Evidence operativa | Conforme |
| Nuovi punti Excel | Nessuno |

**Verdetto:** `PASS - nessuna fix richiesta in BuildSyntaxOracle.ts`.

**Prossimo file raccomandato:** `TestHarness.ts`.
