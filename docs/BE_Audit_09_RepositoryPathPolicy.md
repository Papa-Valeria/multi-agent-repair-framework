# Backend Freeze Audit 09 - `RepositoryPathPolicy.ts`

## 1. Scopo

Audit di `RepositoryPathPolicy.ts` nel freeze-check backend, con focus su:

- canonicalizzazione di path repository-relative;
- prevenzione di path traversal;
- blocco di path assoluti cross-platform;
- protezione della directory `.git`;
- containment lessicale e containment reale tramite `realpath`;
- gestione sicura di path mancanti per scenari CREATE;
- relazione con il gap BE-P1-24 emerso in `DiffScoper.ts`;
- Freeze Gate G3 - Workspace Isolation Gate.

---

## 2. Sintesi esecutiva

**Esito: PASS - nessun nuovo gap autonomo nel file.**

`RepositoryPathPolicy.ts` implementa una primitive di confinement robusta e fail-closed. I path assoluti vengono rifiutati, i separatori vengono normalizzati, `..` viene neutralizzato tramite `path.posix.normalize()` e successivamente verificato, `.git` è protetto, il path risultante viene verificato sia lessicalmente sia tramite `realpath`.

Il ramo `allowMissing` non salta il controllo reale: individua l'ancestor esistente più vicino, ne risolve il real path e ne verifica il confinement. Questo è appropriato per CREATE, dove il file finale può non esistere ancora.

Il file conferma inoltre che il nuovo BE-P1-24 non richiede di inventare un'altra policy di path. Esiste già una primitive autorevole da riusare/adattare per canonicalizzare i path Semgrep. Quindi **BE-P1-24 resta valido, ma la fix minima può essere resa più precisa**.

---

## 3. Validazione input

La policy rifiuta input vuoti o whitespace-only con:

```text
EMPTY_PATH
```

Il controllo viene effettuato prima di qualsiasi risoluzione filesystem.

---

## 4. Path assoluti cross-platform

Sono verificati entrambi:

```ts
path.isAbsolute(input)
path.win32.isAbsolute(input)
```

Questo evita che un path assoluto Windows venga accettato accidentalmente quando il processo gira su piattaforma POSIX.

L'errore viene classificato come:

```text
ABSOLUTE_PATH
```

---

## 5. Canonicalizzazione repository-relative

La policy converte i backslash in `/` e applica:

```ts
path.posix.normalize(slashNormalizedInput)
```

Questa operazione riduce segmenti `.` e `..` secondo la semantica POSIX prima della verifica di escape.

Esempi concettuali:

```text
./src/a.ts -> src/a.ts
src/./a.ts -> src/a.ts
src/x/../a.ts -> src/a.ts
../outside.ts -> ../outside.ts -> rifiutato
```

Il `relativePath` restituito è quindi una forma normalizzata utilizzabile come identità repository-relative.

---

## 6. Repository root

Il path `.` è ammesso solo con:

```ts
allowRepositoryRoot: true
```

Altrimenti viene trattato come path non valido per una risorsa interna.

Quando ammesso, viene verificata l'esistenza reale della repository root.

Questa distinzione è utile per configurazioni come il cwd del Functional Test Oracle, dove la root può essere una destinazione legittima.

---

## 7. Traversal lessicale

Dopo la normalizzazione vengono rifiutati:

```text
..
../...
```

Inoltre `absolutePath` viene ricostruito sotto `repositoryRoot` e verificato da `assertLexicallyContained()` tramite `path.relative()`.

Quindi la policy non si basa su un solo controllo testuale, ma verifica anche il path assoluto risolto.

---

## 8. Protezione `.git`

I segmenti normalizzati vengono ispezionati e qualunque segmento esattamente uguale a `.git` viene rifiutato con:

```text
GIT_PATH
```

La protezione avviene prima dell'accesso alla risorsa.

Per i path esistenti, il successivo realpath containment protegge anche da un link che risolva fuori dal repository.

---

## 9. Containment reale

La repository root viene trasformata nella sua identità reale tramite:

```ts
fs.realpath(repositoryRoot)
```

Per path esistenti viene risolto anche:

```ts
fs.realpath(absolutePath)
```

`assertReallyContained()` confronta i due real path tramite `path.relative()`.

Questo protegge dal principale bypass del solo lexical containment: un symlink interno che punti fuori dal repository.

---

## 10. `allowMissing` e CREATE

Quando il file richiesto può non esistere, la policy non può eseguire `realpath` sul file finale.

La strategia adottata è:

1. costruire il path lessicalmente confinato;
2. cercare con `lstat()` l'ancestor esistente più vicino;
3. risolvere il real path di quell'ancestor;
4. verificare che l'ancestor reale sia sotto la repository root reale.

Questa strategia è corretta per autorizzare un nuovo file sotto una directory già confinata senza fingere l'esistenza del file finale.

Da notare che, nel composition root già analizzato, il path viene risolto nuovamente dopo la creazione delle directory e prima della scrittura. Questa seconda verifica riduce ulteriormente il rischio temporale tra validazione e write.

---

## 11. Gestione PATH_NOT_FOUND

Quando `allowMissing` è false, ENOENT ed ENOTDIR vengono convertiti in un errore di policy tipizzato:

```text
PATH_NOT_FOUND
```

Anche la repository root inesistente viene esposta con una reason strutturata.

Questo evita di affidarsi al parsing dei messaggi filesystem.

---

## 12. Relazione con BE-P1-24

L'audit precedente di `DiffScoper.ts` ha rilevato matching ambiguo tramite:

```ts
endsWith(`/${targetFile}`)
```

Questo file mostra che **la canonicalizzazione repository-relative autorevole esiste già**.

### Aggiornamento consigliato alla fix minima di BE-P1-24

Non creare una seconda normalizzazione indipendente dentro `DiffScoper`.

La soluzione dovrebbe riutilizzare la semantica di `RepositoryPathPolicy` o estrarne una primitive pura condivisa per ottenere path repository-relative canonici.

Poiché `resolveRepositoryPath()` è asincrona e richiede filesystem/realpath, una soluzione pulita può essere:

- estrarre una funzione sincrona/pura per la canonicalizzazione lessicale repository-relative (`\\` -> `/`, `path.posix.normalize`, reject absolute/escape/.git);
- lasciare a `resolveRepositoryPath()` i controlli filesystem/realpath;
- usare la primitive pura nel matching Semgrep solo dopo che il path è stato ancorato/verificato rispetto a `repoRoot` nel boundary appropriato.

Il principio resta: `DiffScoper` deve confrontare identità relative canoniche per uguaglianza, non suffix arbitrari.

### Il ticket resta distinto

`RepositoryPathPolicy.ts` non è difettoso. Il problema è che `DiffScoper.ts` non usa una canonicalizzazione equivalente e non dispone del repository root.

Quindi BE-P1-24 **resta da fare**, ma non richiede modificare la sicurezza di base già corretta di questo file salvo eventuale estrazione di helper riusabile.

---

## 13. Punti già svolti avvalorati

Il file avvalora il lavoro già effettuato relativo a:

- path containment repository;
- rifiuto path assoluti;
- path traversal;
- realpath/symlink escape;
- protezione `.git`;
- supporto CREATE con path mancanti;
- verifica fail-closed di path inesistenti.

Nessun punto già completato richiede riapertura sulla base di questo file.

---

## 14. Righe da aggiungere all'Excel

**Nessuna nuova riga.**

### Aggiornamento alla riga già proposta BE-P1-24

Mantenere tutti i campi della riga BE-P1-24 già proposta, ma rendere più precisa **Fix minima** come segue:

**Fix minima:** `Riutilizzare la semantica di RepositoryPathPolicy, preferibilmente estraendo una primitive pura condivisa di canonicalizzazione repository-relative, e ancorare i finding Semgrep al repoRoot prima del confronto. DiffScoper deve confrontare path repository-relative canonici per uguaglianza ed eliminare il suffix match non ancorato. Mantenere in resolveRepositoryPath i controlli filesystem/realpath già esistenti.`

**Note:** aggiungere `RepositoryPathPolicy.ts auditato PASS: la primitive di confinement esistente è la base da riusare; il difetto è nel matching non ancorato di DiffScoper, non nella policy repository.`

Non è necessario creare un ulteriore ticket.

---

## 15. Freeze Gate G3 - Workspace Isolation Gate

Questo file fornisce evidenza forte a favore di G3:

- lexical containment;
- realpath containment;
- `.git` protection;
- path assoluti cross-platform;
- safe handling dei missing path.

G3 non è ancora formalmente chiudibile perché restano da auditare almeno:

- `GitManager.ts`;
- i meccanismi di patch scope/apply;
- i test di rollback/contamination.

Il BE-P1-24 va inoltre risolto per uniformare l'identità dei path usata dallo scoping Semgrep.

---

## 16. Esito finale

| Area | Esito |
|---|---|
| Empty path validation | Conforme |
| Cross-platform absolute paths | Conforme |
| Relative normalization | Conforme |
| Traversal rejection | Conforme |
| `.git` protection | Conforme |
| Lexical containment | Conforme |
| Realpath containment | Conforme |
| Symlink escape protection | Conforme |
| Missing path / CREATE handling | Conforme |
| Typed path errors | Conforme |
| Nuovi punti Excel | Nessuno |
| BE-P1-24 refinement | Sì, fix resa più precisa |

**Verdetto:** `PASS - nessuna fix autonoma richiesta in RepositoryPathPolicy.ts`.

**Prossimo file raccomandato:** `GitManager.ts`.
