# Backend Freeze Audit 08 - `DiffScoper.ts`

## 1. Scopo

Audit di `DiffScoper.ts` nel freeze-check backend, con focus su:

- estrazione delle linee modificate da Unified Diff;
- policy di rilevanza dei finding Semgrep;
- distinzione REPAIR / CREATE;
- gestione dei nuovi file;
- normalizzazione dei path;
- coerenza con `SemgrepEngine.ts` e con il modello sperimentale.

---

## 2. Sintesi esecutiva

**Esito: PASS CON UN GAP P1 PRE-FREEZE.**

La logica di estrazione e merge degli intervalli è deterministica e la policy REPAIR/CREATE è chiaramente separata. Per REPAIR, le vulnerabilità security su target file rimangono rilevanti anche fuori dalle linee modificate; per gli altri finding viene applicato diff scoping con 3 linee di contesto. Per CREATE, i nuovi file vengono coperti sull'intero contenuto prodotto dal diff.

È però emerso un rischio concreto nel matching dei path: l'uso di `endsWith('/' + targetFile)` e dello stesso criterio in `findRangesForPath()` può accettare un finding il cui path assoluto/appeso appartenga a un'altra directory ma termini con lo stesso path relativo. `DiffScoper` non verifica repository containment né canonicalizza semanticamente `..`/segmenti equivalenti. Questo può associare finding al target/range sbagliato se Semgrep restituisce path non già normalizzati e repository-relative.

Propongo **BE-P1-24** per rendere il matching dei path non ambiguo e ancorato al repository.

---

## 3. Estrazione delle range modificate

`extractModifiedLineRanges()` delega il parsing a `parseFileDiffs()` e normalizza il path di ciascun file.

Per ogni hunk calcola le range tramite `extractRangesFromHunk()` e successivamente le compatta con `mergeRanges()`.

### File esistenti

Per file non nuovi:

- le linee di contesto incrementano la posizione nel nuovo file;
- le aggiunte aprono/estendono una change range e incrementano `newLine`;
- le rimozioni aprono/estendono la range ma non incrementano `newLine`;
- ogni gruppo di modifiche viene esteso di `CONTEXT_LINES = 3`.

La semantica è coerente con il fatto che i finding Semgrep si riferiscono al file risultante dopo l'applicazione della patch.

### Nuovi file

Per un nuovo file viene contato tutto ciò che non è una rimozione:

```ts
hunk.lines.filter((line) => line.kind !== '-').length
```

La range copre quindi l'intera porzione prodotta dal nuovo-file hunk. Questo è coerente con la policy CREATE.

---

## 4. Merge delle range

`mergeRanges()`:

- ordina per start/end;
- fonde range sovrapposte;
- fonde anche range adiacenti.

Il comportamento è deterministico e riduce correttamente intervalli ridondanti.

Non emerge un problema nel merge.

---

## 5. Policy REPAIR

In `filterFindings()` viene prima identificato se il finding ricade su un target file.

Per `REPAIR`, se il finding appartiene a un target e possiede evidenza security:

- severity `ERROR`, oppure
- almeno una CWE, oppure
- una categoria OWASP,

il finding viene mantenuto indipendentemente dalla range modificata.

Questo implementa una policy conservativa: una vulnerabilità di sicurezza presente sul file target non viene nascosta soltanto perché la linea non ricade nell'hunk corrente.

Per gli altri finding viene applicata la sovrapposizione con le range modificate.

---

## 6. Policy CREATE

Non esiste l'eccezione security globale della modalità REPAIR. I finding devono sovrapporsi a una range prodotta dal diff.

Poiché `SemgrepEngine.resolveFilesToScan()` aggiunge in CREATE anche i file estratti dal diff e `extractRangesFromHunk()` copre il contenuto dei nuovi file, l'insieme dei componenti è coerente.

---

## 7. Matching della range

La sovrapposizione viene verificata con condizione inclusiva:

```ts
finding.endLine >= range.start &&
finding.startLine <= range.end
```

Questa è la condizione corretta per verificare che due intervalli chiusi abbiano almeno una linea in comune.

---

## 8. Normalizzazione path

`normalizePath()`:

- converte `\\` in `/`;
- applica `trim()`;
- elimina prefissi ripetuti `./`;
- rende lowercase su Windows.

Questa normalizzazione è utile ma non costituisce una canonicalizzazione completa del percorso.

Non vengono infatti risolti:

- segmenti `..`;
- segmenti `.` interni;
- path assoluti rispetto al repository;
- symlink / realpath;
- root repository.

Questa limitazione diventa rilevante perché il matching supporta suffix match.

---

## 9. Gap emerso - matching path ambiguo tramite suffix

### Evidenza

In `filterFindings()`:

```ts
normalizedFindingPath === targetFile ||
normalizedFindingPath.endsWith(`/${targetFile}`)
```

In `findRangesForPath()` viene applicata la stessa strategia:

```ts
normalizedFindingPath === normalizedFilePath ||
normalizedFindingPath.endsWith(`/${normalizedFilePath}`)
```

### Rischio

Se il target autorizzato è, per esempio:

```text
src/service.ts
```

un path del finding come:

```text
/tmp/other-repository/src/service.ts
```

soddisfa comunque il suffix match.

Il file non dispone del `repoRoot`, quindi non può verificare se quel prefisso sia realmente il repository corrente.

Nel normale funzionamento Semgrep può restituire path già coerenti con il cwd, ma `DiffScoper` non dovrebbe dipendere implicitamente da questa rappresentazione per una decisione di sicurezza/scoping.

### Impatto

- possibile associazione di un finding al target file sbagliato;
- possibile associazione del finding a range di modifica appartenenti a un altro path omonimo;
- il rischio interessa direttamente la fedeltà del Semgrep gate.

### Fix minima

Centralizzare il matching su path repository-relative canonicali. Due opzioni compatibili con l'architettura attuale:

1. far arrivare a `DiffScoper` finding path già convertiti in repository-relative tramite una primitive condivisa;
2. passare il repository root alla funzione di scoping e canonicalizzare entrambi i lati prima del confronto.

Dopo la canonicalizzazione, il matching dovrebbe essere per uguaglianza del repository-relative path, evitando suffix match non ancorati.

Il fix deve essere coperto da test con:

- path repository-relative corretto;
- path assoluto sotto repository;
- path assoluto esterno con stesso suffix;
- `./` e separatori Windows;
- segmenti `..`;
- nomi di file uguali in directory differenti.

---

## 10. Nuova riga da aggiungere all'Excel

**ID:** BE-P1-24  
**Priorità:** P1  
**Sprint/Area:** P1 - Hardening  
**Attività:** Rendere non ambiguo il matching dei path nel DiffScoper  
**Problema/Rischio:** `DiffScoper.filterFindings()` e `findRangesForPath()` accettano anche un suffix match (`endsWith('/<target>')`) senza conoscere il repository root e senza canonicalizzare segmenti `..`/`.` o real path. Un finding con path esterno o appartenente a un'altra directory ma con lo stesso suffix può quindi essere associato al target/range sbagliato, alterando la rilevanza dei finding Semgrep.  
**File coinvolti:** `DiffScoper.ts; SemgrepEngine.ts; RepositoryPathPolicy.ts o helper path condiviso; test DiffScoper/Semgrep scoping`  
**Fix minima:** Canonicalizzare i path dei finding e dei target rispetto al repository tramite una primitive condivisa e confrontare repository-relative path canonici per uguaglianza; eliminare il suffix match non ancorato oppure limitarlo a una trasformazione esplicitamente verificata sotto repoRoot.  
**Criterio di chiusura:** Un finding repository-relative o assoluto sotto il repository viene associato al target corretto; un path esterno con lo stesso suffix, path con traversal o un file omonimo in directory differente non viene associato; REPAIR/CREATE e le range modificate continuano a produrre gli stessi risultati sui casi validi; regression suite backend verde.  
**Stato:** Da fare  
**Completata?:** ☐  
**Data prevista:** Da pianificare  
**Data completamento:** —  
**Owner:** Valeria  
**Note:** Emerso durante freeze audit di `DiffScoper.ts`. Impatta l'affidabilità dello scoping Semgrep e quindi la chiusura definitiva di G2/G3. Fix locale consigliata prima del freeze finale P0/P1.

---

## 11. Punti già svolti avvalorati

Il file supporta il lavoro già effettuato su:

- filtering dei finding sulle aree modificate;
- policy conservativa REPAIR per finding security;
- supporto CREATE e nuovi file;
- separazione tra producer Semgrep e logica di scoping;
- normalizzazione base cross-platform dei path.

Non emerge necessità di riaprire i punti già completati, salvo il nuovo hardening di path matching formalizzato come BE-P1-24.

---

## 12. Freeze gates

### G2 - Oracle Integrity Gate

Il motore Semgrep è conforme, ma il nuovo BE-P1-24 incide sulla corretta attribuzione/rilevanza dei finding. Di conseguenza G2 resta aperto fino alla correzione e ai regression test.

### G3 - Workspace Isolation Gate

Il problema di path matching non è un file-write escape, ma utilizza rappresentazioni path non ancorate al repository. Conviene chiuderlo insieme alle primitive di path/workspace isolation prima di considerare G3 definitivamente verde.

---

## 13. Esito finale

| Area | Esito |
|---|---|
| Hunk range extraction | Conforme |
| New-file range | Conforme |
| Context expansion | Conforme |
| Range merge | Conforme |
| REPAIR security policy | Conforme |
| CREATE diff policy | Conforme |
| Interval overlap | Conforme |
| Basic path normalization | Conforme ma incompleta |
| Path identity/matching | Gap P1 |
| Nuovi punti Excel | 1 (`BE-P1-24`) |

**Verdetto:** `PASS CON GAP PRE-FREEZE`.

**Prossimo file raccomandato:** `RepositoryPathPolicy.ts`, perché il nuovo gap BE-P1-24 va confrontato con la primitive di containment già esistente prima di definire la fix definitiva.
