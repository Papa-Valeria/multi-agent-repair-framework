# BE Audit 23 — ExperimentLimitsConfig.ts

## 1. Esito sintetico

**Valutazione complessiva: PASS. Nessun nuovo punto da aggiungere al tracker.**

`ExperimentLimitsConfig.ts` formalizza i limiti di refinement come configurazione validabile e fornisce i default attuali (`maxIterations: 3`, `maxTechnicalAttempts: 2`). Il file è coerente con il lavoro svolto per rendere questi valori parte della configurazione sperimentale invece che costanti implicite della FSM.

## 2. Default sperimentali

`DEFAULT_EXPERIMENT_LIMITS` è tipizzato come `ExperimentLimits` e protetto con `Object.freeze()`.

I valori correnti sono:

- `maxIterations = 3`;
- `maxTechnicalAttempts = 2`.

Questo crea un punto unico ed esplicito per i default del profilo corrente e impedisce mutazioni runtime dell'oggetto dei default.

## 3. Validazione runtime

`experimentLimitsSchema` usa Zod e richiede per entrambi i parametri:

- tipo numerico;
- numero intero;
- valore minimo 1.

L'uso di `.strict()` rifiuta proprietà aggiuntive non appartenenti al contratto.

La validazione impedisce quindi valori nulli, negativi, frazionari e shape con proprietà extra.

## 4. Coerenza TypeScript / runtime

Il file importa `ExperimentLimits` da `analytics.ts` per tipizzare i default, mentre `ExperimentLimitsConfig` è derivato direttamente dallo schema con `z.infer`.

Nel contratto corrente le due shape coincidono (`maxIterations`, `maxTechnicalAttempts`). Non emerge una divergenza concreta dal codice analizzato.

Il fatto che il tipo runtime venga inferito dallo schema riduce il rischio di disallineamento tra dichiarazione Zod e tipo della configurazione parseata.

## 5. Limiti superiori

Lo schema impone un minimo ma non un massimo a `maxIterations` o `maxTechnicalAttempts`.

Questo non viene classificato come nuovo finding nel freeze corrente: il file ha lo scopo di rendere configurabili i limiti per esperimento e valori elevati non introducono da soli una violazione del contratto scientifico. Eventuali limiti operativi massimi richiederebbero una policy esplicita del prodotto/esperimento, non deducibile dal solo file.

Non viene quindi inventato un vincolo superiore arbitrario durante l'audit.

## 6. Relazione con analytics.ts

`analytics.ts` definisce `ExperimentLimits` e lo include in `ExperimentProfile.limits`. Questo file fornisce invece default e validazione runtime.

La separazione è coerente:

- `analytics.ts`: contratto persistito/provenance;
- `ExperimentLimitsConfig.ts`: configurazione e validazione dei valori.

La verifica che i valori realmente usati dalla FSM siano quelli parseati e persistiti nel profilo è una responsabilità dei consumer già coperta dai test/invarianti del punto dedicato, non può essere dimostrata ulteriormente da questo solo file.

## 7. Verifica del punto BE-P1-18

Il file costituisce evidenza diretta della formalizzazione richiesta da **BE-P1-18 — Rendere configurabili i limiti di refinement**:

- esiste un contratto `ExperimentLimits`;
- esistono default espliciti;
- esiste validazione runtime strict;
- entrambi i limiti sono configurabili come valori invece di essere rappresentati qui da costanti FSM isolate.

**Esito:** BE-P1-18 resta correttamente chiuso. Non emerge evidenza per riaprirlo.

## 8. Rischi verificati

Dal file non emergono:

- default mutabili;
- valori zero o negativi accettati;
- valori frazionari accettati;
- proprietà extra accettate;
- duplicazione di un terzo limite non rappresentato in `ExperimentLimits`;
- fallback impliciti nascosti nello schema.

## 9. Tracker Excel

### Punti esistenti avvalorati

- **BE-P1-18:** avvalorato dal file e da mantenere chiuso.

### Nuovi punti da aggiungere

**Nessuno.**

## 10. Verdetto finale

`ExperimentLimitsConfig.ts` è **PASS** per il freeze corrente. La configurazione dei limiti è piccola, esplicita, strict e coerente con il contratto `ExperimentLimits` persistito nel profilo sperimentale. Non emergono nuovi P0/P1/P2 da aggiungere al tracker sulla base di questo file.
