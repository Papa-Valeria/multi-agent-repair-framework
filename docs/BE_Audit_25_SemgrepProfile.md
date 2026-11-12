# BE Audit 25 — SemgrepProfile.ts

## 1. Esito sintetico

**Valutazione complessiva: PASS per il freeze corrente. Nessun nuovo punto da aggiungere al tracker.**

`SemgrepProfile.ts` formalizza esplicitamente l'identità del profilo Semgrep e associa a tale identità la lista dei config/ruleset utilizzati. Questo è coerente con il requisito già affrontato di rendere versionabile e persistibile la provenance Semgrep.

Il profilo corrente include però una configurazione esplicitamente Python-specific (`p/python`). Questo non costituisce un nuovo finding: il tema della generalizzazione del ruleset Semgrep è già censito come **BE-P2-01 — Generalizzare ruleset Semgrep**.

## 2. Contratto `SemgrepProfile`

L'interfaccia contiene due elementi essenziali:

- `id`: identificatore del profilo;
- `configs`: lista readonly delle configurazioni/ruleset associate.

La separazione tra identifier e contenuto del profilo consente al resto del sistema di registrare un `semgrepProfileId` stabile nella provenance, mantenendo qui la definizione concreta delle configurazioni associate al profilo corrente.

## 3. Profilo di default

`DEFAULT_SEMGREP_PROFILE` usa l'identificatore:

`semgrep-profile-v1`

Il valore esplicita una versione del profilo e quindi rende distinguibile un'eventuale evoluzione futura.

Le configurazioni dichiarate sono:

- `auto`;
- `p/owasp-top-ten`;
- `p/security-audit`;
- `p/cwe-top-25`;
- `p/python`.

Il contenuto del profilo è pertanto esplicito nel codice e non ricostruito implicitamente durante l'esecuzione.

## 4. Immutabilità

L'oggetto di default viene protetto con `Object.freeze()` e anche l'array `configs` viene congelato separatamente.

Questa doppia protezione è rilevante perché un freeze del solo oggetto esterno non impedirebbe la mutazione dell'array annidato. Nel file corrente sia il contenitore sia la lista sono quindi protetti da mutazioni runtime superficiali.

A livello TypeScript, `configs` è inoltre dichiarato `readonly string[]`.

## 5. Verifica di BE-P1-20

Il file costituisce evidenza diretta per **BE-P1-20 — Versionare esplicitamente il Semgrep Profile**:

- esiste un'entità `SemgrepProfile` dedicata;
- il profilo possiede un `id` esplicito;
- l'id corrente contiene una versione (`v1`);
- i config associati sono dichiarati insieme al profilo;
- il profilo di default è immutabile durante il run.

**Esito:** BE-P1-20 resta correttamente chiuso. Non emerge evidenza per riaprirlo.

## 6. Tema Python-specific

La presenza di `p/python` lega intenzionalmente il profilo corrente a un ruleset Python-specific.

Questo tema è già coperto da **BE-P2-01 — Generalizzare ruleset Semgrep**, che prevede la futura esternalizzazione/generalizzazione del ruleset. L'audit non crea quindi un ticket duplicato.

Per il freeze corrente, mantenere un profilo esplicito e versionato è preferibile a modificare implicitamente il ruleset sotto lo stesso identifier.

## 7. Validazione runtime del profilo

Il file non definisce uno schema Zod per `SemgrepProfile`. Dal solo file non risulta però un boundary di input esterno: il profilo mostrato è una costante interna tipizzata e congelata.

Non viene quindi aperto automaticamente un finding sulla mancanza di runtime validation. Tale requisito diventerebbe rilevante se profili Semgrep fossero caricati dinamicamente da input/configurazione esterna, scenario non dimostrato da questo file.

## 8. Integrità identifier/contenuto

Il file non calcola automaticamente l'id dal contenuto dei config. La versione è quindi gestita intenzionalmente tramite `semgrep-profile-v1`.

Questo corrisponde al modello di profili versionati già scelto nel progetto. L'audit non introduce hashing o fingerprint automatici come requisito nuovo, perché cambierebbe il contratto architetturale senza evidenza di un bug nel freeze corrente.

La disciplina necessaria resta: se il contenuto sperimentale del profilo cambia, deve cambiare anche la sua versione/id. BE-P1-20 formalizza precisamente questa provenance.

## 9. Tracker Excel

### Punti esistenti avvalorati

- **BE-P1-20:** avvalorato e da mantenere chiuso.

### Punti post-freeze già pertinenti

- **BE-P2-01:** confermato dalla presenza di `p/python`; nessun duplicato necessario.

### Nuovi punti da aggiungere

**Nessuno.**

## 10. Verdetto finale

`SemgrepProfile.ts` è **PASS** per il freeze corrente. Il profilo Semgrep è esplicito, identificato, versionato e immutabile. La specializzazione Python è già correttamente classificata come evoluzione post-freeze in BE-P2-01. Non emergono nuovi punti Excel.
