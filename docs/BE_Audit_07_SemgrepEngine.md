# Backend Freeze Audit 07 - `SemgrepEngine.ts`

## 1. Scopo

Audit di `SemgrepEngine.ts` nel freeze-check backend, con focus su:

- Semgrep Profile e provenance;
- semantica `PASS`, `FAIL`, `NOT_AVAILABLE`, `EXECUTION_ERROR`;
- policy REPAIR/CREATE e diff scoping;
- gestione di timeout, process error, exit code e JSON Semgrep;
- coerenza con `VerificationInvariants.ts`, `OracleDecision.ts` e `RefinementFSM.ts`;
- Freeze Gate G2 - Oracle Integrity Gate.

---

## 2. Sintesi esecutiva

**Esito: PASS - nessun nuovo gap bloccante emerso nel file.**

Il ruleset non è più hardcoded nell'engine: deriva esclusivamente dal `SemgrepProfile` iniettato. L'engine gestisce in modo fail-closed timeout, execution error, exit code assente/inatteso, output vuoto, JSON invalido e `parsed.errors`. I finding grezzi vengono trasformati in `SastFinding` e poi filtrati tramite `DiffScoper`, mantenendo la distinzione REPAIR/CREATE già prevista dall'architettura.

La semantica producer è coerente con `assertSemgrepResultInvariants()`: PASS solo con zero finding rilevanti e almeno un file scansionato; FAIL con finding; NOT_AVAILABLE senza file; EXECUTION_ERROR con `executionError` e findings vuoti.

Non emergono nuovi punti da aggiungere all'Excel.

---

## 3. Semgrep Profile e ruleset

Il costruttore riceve esplicitamente:

```ts
private readonly executionConfig: SemgrepExecutionConfig,
private readonly profile: SemgrepProfile
```

Le configurazioni Semgrep vengono generate esclusivamente da:

```ts
this.profile.configs.map((config) => `--config=${config}`)
```

Quindi `SemgrepEngine.ts` non contiene più i pack Python/OWASP/CWE hardcoded analizzati prima di BE-P1-20.

Questo avvalora il lavoro svolto su:

- `semgrepProfileId`;
- profilo versionato;
- separazione ruleset/configurazione operativa;
- generalizzabilità futura dell'engine.

---

## 4. File da analizzare

`resolveFilesToScan()` parte sempre dai `targetFiles` dichiarati.

Per `CREATE` aggiunge anche i file presenti nel diff:

```ts
const fileDiffs = parseFileDiffs(patchDiff)
```

utilizzando un `Set`, quindi evita duplicati.

Per `REPAIR`, invece, il set rimane quello dei target dichiarati. Questo preserva una surface controllata dal task manifest.

---

## 5. Semantica `NOT_AVAILABLE`

Se `resolveFilesToScan()` produce un insieme vuoto, l'engine restituisce:

```text
SEMGREP / NOT_AVAILABLE
```

con:

- `findings: []`;
- `scannedFiles: []`.

La combinazione coincide con `assertSemgrepResultInvariants()`.

L'assenza di file non viene interpretata come PASS.

---

## 6. Execution boundary fail-closed

`evaluate()` racchiude risoluzione file ed esecuzione in un `try/catch` generale.

Qualsiasi eccezione viene convertita in:

```text
SEMGREP / EXECUTION_ERROR
```

con:

```ts
findings: []
executionError: <messaggio>
```

Questa proprietà impedisce che errori interni del producer bypassino direttamente la decision logic.

---

## 7. Validazione dell'esecuzione Semgrep

`executeScan()` tratta come errore di esecuzione:

- timeout;
- `ProcessRunner.executionError`;
- `exitCode === null`;
- stdout vuoto;
- JSON non parseabile;
- assenza dell'array `results`;
- errori dichiarati da Semgrep in `parsed.errors`;
- exit code fuori dal contratto ammesso.

Il contratto di exit code accettato è:

```text
0
oppure
1 con almeno un result
```

Un exit code 1 senza finding non viene interpretato come normale FAIL, ma come errore di esecuzione non interpretabile, coerentemente con il principio fail-closed.

---

## 8. Mapping dei finding

Ogni result Semgrep viene convertito in `SastFinding` conservando:

- `ruleId`;
- `path`;
- linee start/end;
- severity;
- message;
- gerarchia CWE;
- categoria OWASP quando disponibile.

Le severity non riconosciute vengono ricondotte a `WARNING`; `ERROR` e `INFO` vengono preservate esplicitamente.

Non emerge una contraddizione con il consumer attuale, che usa i finding per decisione e analytics.

---

## 9. Diff scoping

Dopo la trasformazione dei finding, l'engine calcola:

```ts
DiffScoper.extractModifiedLineRanges(patchDiff)
```

e delega il filtro a:

```ts
DiffScoper.filterFindings(
  rawFindings,
  modifiedRanges,
  scannedFiles,
  category
)
```

Quindi la policy di rilevanza dei finding non è duplicata dentro `SemgrepEngine` ma centralizzata in `DiffScoper`.

Questo è positivo dal punto di vista architetturale. La correttezza completa della policy REPAIR/CREATE richiede però l'audit separato di `DiffScoper.ts`.

---

## 10. PASS e FAIL

Dopo il filtering:

- almeno un finding rilevante -> `FAIL`;
- zero finding rilevanti -> `PASS`.

In entrambi i casi `scannedFiles` non è vuoto perché il caso vuoto è già stato terminato come `NOT_AVAILABLE`.

Questo coincide esattamente con le invarianti producer-independent già analizzate.

---

## 11. Coerenza con i componenti già auditati

### `VerificationInvariants.ts`

Le combinazioni prodotte sono compatibili con `assertSemgrepResultInvariants()`:

- PASS: findings vuoti, scannedFiles non vuoti, no executionError;
- FAIL: findings non vuoti, scannedFiles non vuoti, no executionError;
- NOT_AVAILABLE: findings e scannedFiles vuoti;
- EXECUTION_ERROR: findings vuoti, executionError non vuoto.

### `OracleDecision.ts`

- FAIL è evidence negativa valida e può portare a refinement;
- EXECUTION_ERROR impedisce refinement/convergenza;
- NOT_AVAILABLE impedisce convergenza se required.

### `RefinementFSM.ts`

La FSM richiama immediatamente:

```ts
assertSemgrepResultInvariants(semgrep)
```

prima di usare l'evidenza nel verdict complessivo.

---

## 12. Coerenza con BE-P1-20 e BE-P2-01

L'audit conferma che BE-P1-20 ha effettivamente rimosso il ruleset dal motore e non si limita a persistere un ID decorativo.

Il ruleset eseguito deriva dal profilo stesso che viene versionato dalla provenance a livello di composition root.

Di conseguenza il requisito originario di BE-P2-01, generalizzare il ruleset Semgrep, risulta già sostanzialmente soddisfatto dall'architettura corrente del motore.

Non è necessario riaprire BE-P2-01 sulla base di questo file.

---

## 13. Osservazioni da auditare altrove

### 13.1 Policy di scoping

La correttezza della selezione REPAIR/CREATE dipende da `DiffScoper.ts`. Questo non è un nuovo bug rilevato in `SemgrepEngine.ts`; è una dipendenza da verificare nel freeze audit.

### 13.2 File CREATE derivati dal diff

L'aggiunta dei file individuati tramite `parseFileDiffs()` è intenzionale per CREATE. La sicurezza del parsing/path scope dipende anche dalle primitive Git/path già previste nell'audit successivo.

---

## 14. Punti già svolti avvalorati

Il file avvalora:

- Semgrep invariants al boundary;
- gestione fail-closed execution error;
- Semgrep Profile versionato;
- ruleset non hardcoded nell'engine;
- provenance Semgrep collegata al ruleset effettivo;
- separazione configuration/ruleset;
- scoping dei finding delegato a componente dedicato.

Nessun punto già completato richiede riapertura sulla base del file.

---

## 15. Righe da aggiungere all'Excel

**Nessuna nuova riga.**

Non sono emersi nuovi difetti autonomi da registrare.

---

## 16. Freeze Gate G2 - Oracle Integrity Gate

Dopo l'audit di:

- `OracleDecision.ts`;
- `VerificationInvariants.ts`;
- `BuildSyntaxOracle.ts`;
- `TestHarness.ts`;
- `SemgrepEngine.ts`;
- consumer `RefinementFSM.ts`;

il **nucleo Oracle Integrity risulta conforme a livello statico**.

G2 può essere considerato **code-review PASS**, ma la chiusura formale nel tracker dovrebbe avvenire dopo:

1. risoluzione di BE-P1-23, perché rafforza il boundary globale dello stato;
2. full regression suite backend verde.

Per la sola logica degli oracle, non emerge ulteriore lavoro.

---

## 17. Esito finale

| Area | Esito |
|---|---|
| Ruleset da SemgrepProfile | Conforme |
| Configurazione operativa separata | Conforme |
| File selection | Conforme nel motore |
| NOT_AVAILABLE | Conforme |
| Timeout/process failure | Conforme |
| JSON/error validation | Conforme |
| Exit-code validation | Conforme fail-closed |
| Finding mapping | Conforme |
| Diff scoping delegation | Conforme, componente da auditare |
| PASS/FAIL semantics | Conforme |
| Producer-independent invariant compatibility | Conforme |
| Nuovi punti Excel | Nessuno |

**Verdetto:** `PASS - nessuna fix richiesta in SemgrepEngine.ts`.

**Prossimo file raccomandato:** `DiffScoper.ts`, per chiudere la parte di rilevanza/scoping Semgrep prima di passare a Git/workspace isolation.
