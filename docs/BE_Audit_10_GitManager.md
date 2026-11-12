# Backend Freeze Audit 10 - `GitManager.ts`

## 1. Scopo

Audit di `GitManager.ts` nel freeze-check backend, con focus su:

- validazione strutturale e scope delle patch;
- protezione dei file test/oracle;
- modalità di applicazione `GIT` e `FUZZY`;
- confinement dei path e protezione `.git`;
- rollback e pulizia del workspace;
- gestione degli artifact ignorati;
- integrità dell'Applicability Oracle;
- relazione con `RepositoryPathPolicy.ts`, `UnifiedDiff.ts` e `RefinementFSM.ts`;
- Freeze Gate G3 - Workspace Isolation Gate.

---

## 2. Sintesi esecutiva

**Esito: PASS CON UN GAP P1 PRE-FREEZE.**

`GitManager.ts` presenta un impianto complessivamente robusto: valida struttura e scope prima di probe/apply, protegge i test, distingue REPAIR da CREATE, usa `execFile` senza shell, implementa preflight e doppia risoluzione path prima delle scritture FUZZY, e verifica il rollback confrontando sia HEAD sia working tree.

È però emerso un bypass circoscritto della policy realpath in `normalizeRejectedPatch()`: per leggere i source file usati nella normalizzazione, il metodo usa `path.resolve()` dopo il solo controllo lessicale `assertPathInsideRepository()`, senza passare da `resolveRepositoryPath()`. Un symlink interno al repository che punti fuori può quindi essere letto durante la normalizzazione della patch. Il ramo non scrive direttamente fuori repository, ma può incorporare contenuto esterno nel processo di normalizzazione e nella patch risultante.

Propongo **BE-P1-25**.

---

## 3. Patch hash

`computePatchHash()` normalizza CRLF a LF, applica `trim()` e calcola SHA-256.

Il comportamento è deterministico per la stessa rappresentazione semantica usata dalla FSM per flapping/stagnation detection.

Non emerge un problema nel file analizzato.

---

## 4. Validazione strutturale e scope

Ogni patch passa da:

```ts
validatePatchStructure(unifiedDiff)
```

prima delle verifiche di scope.

Le violazioni strutturali vengono aggregate con codice, file e hunk prima di generare l'errore.

Successivamente vengono analizzati sia:

- i source path delle righe `---`;
- i target path ottenuti da `parseFileDiffs()`.

Questo è importante per intercettare anche rename o tentativi di usare un file protetto come source.

---

## 5. Protezione test/oracle

I path di `scope.testFiles` vengono normalizzati e raccolti in un `Set`.

La patch viene rifiutata se:

- un source path coincide con un test file;
- il target path coincide con un test file.

Quindi il framework protegge sia modifica diretta sia uso/rename del test come sorgente della patch.

---

## 6. Policy REPAIR / CREATE

### REPAIR

Sia source sia target devono appartenere al manifest `targetFiles`.

Questo impedisce al Coder di ampliare autonomamente la superficie di modifica.

### CREATE

La restrizione ai soli target dichiarati non viene applicata, mentre la protezione test e il containment repository restano attivi.

La scelta è coerente con il requisito CREATE di poter aggiungere file sorgente necessari.

---

## 7. Path validation lessicale

`normalizeRelativePath()`:

- converte i separatori;
- rimuove i prefissi Git `a/` e `b/`;
- rimuove `./` iniziali;
- applica `path.posix.normalize()`;
- normalizza il case su Windows.

`assertPathInsideRepository()` rifiuta:

- path vuoti;
- NUL;
- path assoluti POSIX/Windows;
- repository root stessa;
- escape `..` dopo `path.resolve()`;
- segmenti `.git`.

Il controllo lessicale è adeguato per validare la forma della patch, ma non sostituisce il realpath containment quando viene effettuato I/O filesystem.

---

## 8. Applicability Oracle

`evaluateApplicability()`:

1. calcola il patch hash;
2. valida struttura e scope;
3. esegue `git apply --check`;
4. se Git non applica, prova il fallback FUZZY in memoria;
5. distingue PASS, FAIL ed EXECUTION_ERROR.

### Semantica osservata

- scope/structure invalidi -> `FAIL / NOT_APPLICABLE`;
- Git applicabile -> `PASS / GIT`;
- FUZZY applicabile -> `PASS / FUZZY`;
- exception FUZZY -> `EXECUTION_ERROR`;
- Git execution error e FUZZY non applicabile -> `EXECUTION_ERROR`;
- nessuna modalità applicabile -> `FAIL`.

La modalità certificata viene poi richiesta ad `applyPatch()`, riducendo divergenze fra probe e apply.

---

## 9. Applicazione Git

`applyWithGit()` usa `execFile`, non una shell, con un file patch temporaneo univoco nel repository.

Il file viene rimosso in `finally` con `force: true`; un'eventuale failure di cleanup viene resa osservabile via warning.

`applyPatch()` rivalida lo scope prima dell'applicazione effettiva, quindi non si affida soltanto al probe precedente.

---

## 10. Applicazione FUZZY

### 10.1 Computazione in memoria

`computeFuzzyUpdates()`:

- esegue il parsing;
- verifica path e hunk;
- risolve ogni target mediante `resolveRepositoryPath()`;
- legge il contenuto autorizzato;
- applica gli hunk in memoria;
- restituisce una mappa di aggiornamenti solo se tutti i file sono applicabili.

### 10.2 Preflight prima delle scritture

`applyFuzzy()` risolve tutti i target prima; crea poi le directory; quindi risolve nuovamente tutti i target prima della scrittura.

La seconda risoluzione è una protezione importante contro cambiamenti introdotti durante la creazione delle directory.

### 10.3 Failure parziale

Le scritture sono sequenziali e una failure successiva può lasciare update precedenti applicati. Tuttavia `applyFuzzy()` restituisce false e la FSM, nei failure path gestiti, esegue il rollback transazionale Git. Questo comportamento è già parte del disegno verificato nei test di rollback/fuzzy partial write indicati dal tracker.

Non propongo un nuovo ticket specifico sulla base del solo file, ma la chiusura G3 richiede la full regression di tali test.

---

## 11. Rollback

`resetFixtureFilesystem()` usa:

```text
git reset --hard <targetRef>
git clean -fd
cleanupFixtureArtifacts()
```

`rollback()` verifica poi:

- `finalHead === initialHead`;
- working tree vuoto.

Se una delle due condizioni non è soddisfatta, restituisce `RollbackResult.status = FAILED` con evidence.

In caso di exception tenta comunque di recuperare HEAD e status per produrre un risultato strutturato.

Questo avvalora il lavoro svolto su rollback verificato e rollback failure osservabile.

---

## 12. Cleanup artifact ignorati

La pulizia ricorsiva:

- salta `.git`;
- considera solo una allow-list di artifact fixture;
- verifica con `git check-ignore` che l'artifact sia realmente ignorato;
- elimina un symlink con `unlink` invece di seguirlo;
- per directory/file normali usa `resolveRepositoryPath()` prima di `rm`.

Il comportamento è conservativo: un nome corrispondente ma non ignorato non viene eliminato.

---

## 13. Gap emerso - lettura realpath non confinata in `normalizeRejectedPatch()`

### Evidenza

Per i file non nuovi, `normalizeRejectedPatch()` esegue:

```ts
const normalizedPath = this.normalizeRelativePath(fileDiff.file);
this.assertPathInsideRepository(normalizedPath);
const absolutePath = path.resolve(repositoryRoot, normalizedPath);
sources[fileDiff.file] = await fs.readFile(absolutePath, 'utf-8');
```

`assertPathInsideRepository()` verifica il containment lessicale, ma non il realpath.

### Scenario di rischio

Un path come:

```text
src/external-link.ts
```

può essere lessicalmente interno ma essere un symlink verso un file esterno al repository.

`fs.readFile(absolutePath)` segue il symlink e legge il contenuto esterno.

### Impatto

- violazione del principio secondo cui gli input del task devono provenire dal repository confinato;
- possibile incorporazione di contenuto esterno nella patch normalizzata;
- divergence rispetto alla policy già applicata nel percorso FUZZY tramite `resolveRepositoryPath()`.

Non è una scrittura esterna diretta, ma è una lettura non autorizzata e può contaminare il dato sperimentale.

### Fix minima

Sostituire `path.resolve()` + `fs.readFile(absolutePath)` con:

```ts
const resolved = await resolveRepositoryPath({
  repositoryRoot: this.repoRoot,
  relativePath: normalizedPath
});

sources[fileDiff.file] = await fs.readFile(
  resolved.absolutePath,
  'utf8'
);
```

Usare il repository-relative path canonico come chiave se richiesto da `normalizeRejectedDiff()`, evitando identità divergenti.

Aggiungere regression test con symlink interno verso file esterno e confermare che la normalizzazione venga rifiutata senza leggere il contenuto esterno.

---

## 14. Nuova riga da aggiungere all'Excel

**ID:** BE-P1-25  
**Priorità:** P1  
**Sprint/Area:** P1 - Hardening  
**Attività:** Confinare tramite realpath le letture di normalizeRejectedPatch  
**Problema/Rischio:** `GitManager.normalizeRejectedPatch()` legge i source file con `path.resolve()` dopo il solo controllo lessicale `assertPathInsideRepository()`. Un symlink interno che punti fuori repository può quindi essere seguito da `fs.readFile()`, introducendo contenuto esterno nella normalizzazione della patch e contaminando gli input sperimentali.  
**File coinvolti:** `GitManager.ts; RepositoryPathPolicy.ts come primitive riusata; test GitManager patch normalization/symlink containment`  
**Fix minima:** Risolvere ogni source file non nuovo tramite `resolveRepositoryPath({ repositoryRoot, relativePath })` prima della lettura, usare il path autorizzato restituito e rifiutare symlink/realpath escape. Non modificare la logica di normalizzazione degli hunk.  
**Criterio di chiusura:** La normalizzazione continua a funzionare per file interni reali; un symlink interno verso un file esterno viene rifiutato prima della lettura; nessun contenuto esterno confluisce in `normalizeRejectedDiff()`; regression test mirato e full suite backend verdi.  
**Stato:** Da fare  
**Completata?:** ☐  
**Data prevista:** Da pianificare  
**Data completamento:** —  
**Owner:** Valeria  
**Note:** Emerso durante freeze audit di `GitManager.ts`. Impatta G3 - Workspace Isolation Gate. La primitive corretta esiste già in `RepositoryPathPolicy.ts`; fix locale senza refactor architetturale.

---

## 15. Punti già svolti avvalorati

Il file avvalora i lavori già completati relativi a:

- patch scope REPAIR/CREATE;
- protezione test/oracle;
- struttura Unified Diff;
- Applicability come oracle strutturato;
- fallback FUZZY certificato;
- preflight delle scritture;
- rollback verificato;
- cleanup artifact controllato;
- error handling senza shell command interpolation.

Non emerge la necessità di riaprire questi punti, salvo BE-P1-25 per il ramo di normalizzazione.

---

## 16. Aggiornamento BE-P1-24

L'analisi conferma ulteriormente che la canonicalizzazione path deve essere centralizzata. BE-P1-24 e BE-P1-25 sono distinti:

- **BE-P1-24:** identità/matching logico dei finding Semgrep;
- **BE-P1-25:** confinement filesystem reale durante la lettura per patch normalization.

Entrambi devono riusare `RepositoryPathPolicy` o una primitive condivisa, ma hanno criteri di chiusura differenti.

---

## 17. Freeze Gate G3 - Workspace Isolation Gate

Il file fornisce evidenza forte su scope, test protection, apply, rollback e cleanup. Tuttavia G3 resta aperto fino a:

1. chiusura BE-P1-24;
2. chiusura BE-P1-25;
3. full regression suite dei test path traversal, symlink, fuzzy partial write, rollback e workspace contamination.

---

## 18. Esito finale

| Area | Esito |
|---|---|
| Patch structure validation | Conforme |
| REPAIR scope | Conforme |
| CREATE scope | Conforme |
| Test/oracle protection | Conforme |
| Applicability decision | Conforme |
| Git apply | Conforme |
| FUZZY preflight/write | Conforme con rollback esterno |
| RepositoryPathPolicy usage in FUZZY | Conforme |
| Rollback verification | Conforme |
| Cleanup ignored artifacts | Conforme |
| normalizeRejectedPatch realpath containment | Gap P1 |
| Nuovi punti Excel | 1 (`BE-P1-25`) |

**Verdetto:** `PASS CON GAP PRE-FREEZE`.

**Prossimo file raccomandato:** `UnifiedDiff.ts`, perché `GitManager` delega a quel file struttura, parsing, normalizzazione e applicazione degli hunk.
