# Freeze Audit BE — `FixtureIdentity.ts`

## 1. Esito sintetico

**Valutazione complessiva: PASS con un hardening P1 già correttamente censito.**

`FixtureIdentity.ts` implementa una fixture identity deterministica tramite SHA-256 su una rappresentazione canonica degli input sperimentali autorevoli. Il file supporta correttamente la chiusura di **BE-P1-19 — Formalizzare Fixture/Benchmark Identity**.

L’audit conferma però il problema già registrato nel tracker come **BE-P1-31 — Rifiutare collisioni di path nella Fixture Identity**: più chiavi sorgente sintatticamente diverse possono normalizzarsi nello stesso path canonico senza essere rifiutate.

Non emergono ulteriori punti distinti da aggiungere al backlog.

---

## 2. Responsabilità del file

Il file espone due funzioni:

- `canonicalizeFixtureIdentity(input)`: costruisce una rappresentazione deterministica della fixture;
- `createFixtureIdentity(input)`: serializza tale rappresentazione e ne calcola il digest SHA-256 esadecimale.

Gli input inclusi nell’identità sono:

- `category`;
- `issueSpec`;
- path e contenuti di `targetSources`;
- path e contenuti di `testSources`.

Questi elementi sono coerenti con il requisito di identificare la fixture sulla base degli input sperimentali rilevanti, evitando di dipendere da identificatori operativi come `taskId`.

---

## 3. Analisi della canonicalizzazione

### 3.1 Canonicalizzazione dei path

`normalizeFixturePath()` applica:

1. conversione dei separator Windows `\\` in `/`;
2. `trim()` del path;
3. rimozione ripetuta del prefisso `./`;
4. `path.posix.normalize()`.

Questo rende equivalenti, ad esempio:

- `src/a.ts` e `./src/a.ts`;
- `src\\a.ts` e `src/a.ts`;
- `src/./a.ts` e `src/a.ts`.

La normalizzazione è deterministica e multipiattaforma per la rappresentazione canonica. Tuttavia, proprio queste equivalenze possono produrre collisioni tra chiavi originarie distinte.

### 3.2 Canonicalizzazione dei contenuti

`normalizeFixtureContent()` converte `CRLF` in `LF`.

La scelta evita che lo stesso contenuto logico produca fixture identity diverse solo per il formato EOL della piattaforma. Il comportamento è volutamente limitato: non modifica spazi, indentazione, trailing newline o altri caratteri semanticamente potenzialmente rilevanti.

### 3.3 Indipendenza dall’ordine di inserimento

`canonicalizeSources()` trasforma i record in array e li ordina per path canonico. Di conseguenza, l’hash non dipende dall’ordine di enumerazione delle proprietà di `targetSources` e `testSources`.

### 3.4 Separazione target/test

Le sorgenti target e test restano in collezioni distinte nella rappresentazione serializzata. Lo stesso path e contenuto collocato come target oppure come test produce quindi una rappresentazione diversa, comportamento coerente perché il ruolo sperimentale del file cambia.

---

## 4. Calcolo dell’identità

`createFixtureIdentity()` applica:

1. canonicalizzazione completa dell’input;
2. `JSON.stringify()` della struttura canonica;
3. SHA-256 con input UTF-8;
4. output esadecimale.

Poiché la struttura viene creata con ordine stabile delle proprietà e le sorgenti vengono ordinate, la serializzazione risulta deterministica nel contratto corrente.

Il digest è appropriato come identificatore di contenuto della fixture. Non viene utilizzato come meccanismo di autenticazione, quindi l’assenza di HMAC non rappresenta un problema per questa responsabilità.

---

## 5. Verifica di BE-P1-19

### Requisito

Calcolare un’identità deterministica della fixture dagli input sperimentali autorevoli, includendo almeno issue, categoria, path e contenuti rilevanti.

### Evidenza nel file

| Requisito | Evidenza | Esito |
|---|---|---|
| Categoria inclusa | `category: input.category` | PASS |
| Issue inclusa | `issueSpec` normalizzato | PASS |
| Path target inclusi | `targetSources` canonicalizzati | PASS |
| Contenuti target inclusi | contenuto incluso in ogni entry | PASS |
| Path test inclusi | `testSources` canonicalizzati | PASS |
| Contenuti test inclusi | contenuto incluso in ogni entry | PASS |
| Indipendenza dall’ordine | ordinamento per path | PASS |
| Normalizzazione EOL | `CRLF → LF` | PASS |
| Identità crittografica stabile | SHA-256 UTF-8 | PASS |

### Conclusione

Il codice analizzato **avvalora correttamente BE-P1-19**. Il punto non deve essere riaperto.

La verifica completa della persistenza di `fixtureId` e del suo uso nel pairing analytics dipende dai consumer (`app.ts`, `analytics.ts`, `TelemetryStorage.ts`) e non può essere dimostrata dal solo `FixtureIdentity.ts`. Il tracker dichiara questa integrazione coperta dai regression test già eseguiti; il presente audit conferma la correttezza del producer dell’identità.

---

## 6. Finding confermato: collisioni di path canonici

### Descrizione

`canonicalizeSources()` normalizza ogni chiave prima dell’ordinamento, ma non verifica che i path canonici risultanti siano univoci.

Esempio concettuale:

```ts
{
  './src/a.ts': 'contenuto A',
  'src/a.ts': 'contenuto B'
}
```

Entrambe le chiavi diventano `src/a.ts`. La rappresentazione canonica contiene quindi due entry con lo stesso path e contenuti potenzialmente diversi.

Altri casi equivalenti includono:

- separator diversi: `src\\a.ts` e `src/a.ts`;
- segmenti ridondanti: `src/dir/../a.ts` e `src/a.ts`;
- spazi esterni rimossi da `trim()`.

### Impatto

L’hash rimane tecnicamente deterministico, ma il contratto canonico della fixture diventa ambiguo: una fixture repository-like dovrebbe avere al massimo un contenuto per ciascun path canonico all’interno di ogni insieme sorgente.

### Classificazione

- **Priorità:** P1
- **Area:** Hardening
- **Impatto sul freeze:** da chiudere per rendere non ambiguo il contratto di fixture identity;
- **Rapporto con BE-P1-19:** hardening aggiuntivo, non regressione della funzionalità già chiusa.

### Stato nel tracker

Il problema è già presente come **BE-P1-31**. Non deve essere creato un nuovo ticket duplicato.

### Fix minima raccomandata

Dopo la normalizzazione e prima del calcolo dell’hash:

1. verificare l’unicità dei path canonici;
2. effettuare il controllo separatamente per `targetSources` e `testSources`;
3. rifiutare deterministicamente la collisione con un errore esplicito;
4. non deduplicare silenziosamente e non scegliere implicitamente uno dei contenuti.

È opportuno riutilizzare una primitive pura condivisa di canonicalizzazione repository-relative se questa verrà introdotta per BE-P1-24, mantenendo separati i controlli filesystem/`realpath`, che non appartengono a questa funzione puramente content-based.

---

## 7. Altri aspetti verificati

### 7.1 Nessuna contaminazione da metadati di run

Il digest non include timestamp, run ID, task ID, modalità o dati operativi. Questo preserva l’obiettivo di confrontare fixture equivalenti tra run differenti.

### 7.2 Sensibilità ai cambiamenti rilevanti

Una modifica a categoria, issue, path, contenuto target o contenuto test modifica la serializzazione e quindi il digest.

### 7.3 Immutabilità osservazionale

Il file non muta l’input: `Object.entries()`, `map()` e `sort()` operano su nuovi array. I record sorgente ricevuti non vengono modificati.

### 7.4 Confini della responsabilità

Il file canonicalizza una descrizione già materializzata della fixture. Non verifica:

- esistenza dei file nel repository;
- confinement tramite `realpath`;
- autorizzazione dei path rispetto al manifest;
- corrispondenza tra record e filesystem al momento del run.

Questi controlli appartengono ai boundary di caricamento e alla `RepositoryPathPolicy`, non al calcolo puro dell’identità. Non costituiscono nuovi finding su questo file.

---

## 8. Test di regressione richiesti per BE-P1-31

Aggiungere almeno i seguenti casi a `FixtureIdentity.test.ts`:

1. collisione `./src/a.ts` vs `src/a.ts` nei target;
2. collisione `src\\a.ts` vs `src/a.ts`;
3. collisione `src/dir/../a.ts` vs `src/a.ts`;
4. collisione equivalente nei test sources;
5. nessuna collisione tra lo stesso path presente una volta nei target e una volta nei test, poiché i namespace hanno ruoli distinti;
6. ordine diverso delle entry produce lo stesso hash;
7. CRLF/LF produce lo stesso hash;
8. modifica reale del contenuto produce hash diverso;
9. modifica della categoria o dell’issue produce hash diverso;
10. verifica che l’errore di collisione sia stabile e riconoscibile.

I regression test esistenti relativi a BE-P1-19 devono restare invariati e verdi.

---

## 9. Esito backlog Excel

### Punti esistenti avvalorati

- **BE-P1-19:** correttamente chiuso dal punto di vista del producer `FixtureIdentity.ts`.
- **BE-P1-31:** correttamente aperto e pienamente avvalorato dal codice.

### Nuovi punti da aggiungere

**Nessuno.**

L’unico finding materiale emerso dal file coincide già con BE-P1-31. Creare un ulteriore punto produrrebbe duplicazione del backlog.

---

## 10. Verdetto finale

`FixtureIdentity.ts` è architetturalmente coerente con il freeze sperimentale e implementa correttamente un’identità deterministica, stabile e indipendente dall’ordine per gli input della fixture.

Il file è **PASS con remediation P1 già tracciata**. Per considerare completato anche l’hardening locale, resta da implementare BE-P1-31 con rifiuto fail-fast delle collisioni di path canonici e relativa copertura di regressione.
