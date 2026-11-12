# BE Audit 24 — ModelSessionConfig.ts

## 1. Esito sintetico

**Valutazione complessiva: PASS con una nota sul testo ricevuto. Nessun nuovo punto Excel identificato dal file sorgente inteso.**

`ModelSessionConfig.ts` definisce un contratto runtime strict per endpoint locale del modello, identificatore, seed, sampling e timeout di inferenza. I valori sono limitati esplicitamente e i default sono congelati.

Nel testo incollato in chat il valore di `apiBaseUrl` dentro `DEFAULT_MODEL_SESSION_CONFIG` appare trasformato in markup HTML di un link. Questo non è TypeScript valido se fosse realmente presente nel file. Poiché la chat può trasformare automaticamente URL in link, l'audit lo tratta come artefatto di rendering del messaggio e non come finding del repository. Va verificato sul sorgente reale solo se il compilatore mostra un errore su quella riga.

## 2. Validazione dell'endpoint

`localApiBaseUrl` parte da `z.string().url()` e applica una `superRefine` che accetta soltanto hostname loopback espliciti: `localhost`, `127.0.0.1`, `[::1]`, `::1`.

La validazione limita inoltre il protocollo a HTTP o HTTPS. Questo impedisce che il contratto di sessione accetti direttamente endpoint remoti nominali o protocolli differenti.

La trasformazione finale elimina gli slash terminali, stabilizzando la rappresentazione del base URL.

## 3. Configurazione del modello

`modelIdentifier` è trimmed, obbligatorio e limitato a 200 caratteri.

`seed` è un intero compreso tra 0 e 2.147.483.647. Il contratto supporta quindi un seed esplicito e riproducibile.

`temperature` è limitata all'intervallo 0..2 e `topP` a (0, 1]. I parametri di sampling non possono quindi assumere valori fuori dal dominio previsto dal contratto.

## 4. Timeout di inferenza

`inferenceTimeoutMs` deve essere intero e compreso tra 1.000 e 600.000 ms. Il default è 120.000 ms.

Il timeout è quindi parte esplicita della configurazione di sessione. Questo è coerente con il requisito già affrontato di rendere il timeout di inferenza configurabile e persistibile nella provenance sperimentale.

La corretta contabilizzazione della durata nei failure path non è responsabilità di questo file e resta distinta dal contratto di configurazione.

## 5. Strict schema

`modelSessionConfigSchema` termina con `.strict()`. Proprietà extra non previste dal contratto vengono rifiutate durante il parsing.

Il tipo `ModelSessionConfig` è inferito direttamente dallo schema Zod, riducendo la possibilità di divergenza tra type declaration e runtime validation.

## 6. Default

`DEFAULT_MODEL_SESSION_CONFIG` usa `Object.freeze()` e stabilisce il profilo locale corrente:

- endpoint loopback locale;
- `modelIdentifier`: `qwen2.5-coder:7b`;
- seed 42;
- temperature 0;
- topP 1;
- timeout 120.000 ms.

Questi valori sono coerenti con una configurazione deterministica del profilo corrente. `Object.freeze()` impedisce la mutazione superficiale dell'oggetto dei default.

## 7. Nota sul markup HTML ricevuto

Nel messaggio utilizzato per l'audit, `apiBaseUrl` è visualizzato come una stringa contenente markup `<a ...>...</a>`. Se quel markup fosse letteralmente nel file `.ts`, il sorgente sarebbe corrotto/non valido rispetto all'intento della proprietà.

Tuttavia la presenza di attributi UI come `target`, `rel`, `title` e `class` è compatibile con una trasformazione del testo effettuata dalla superficie chat quando riconosce un URL. Non è quindi corretto aprire un ticket BE sulla sola base della rappresentazione incollata.

Criterio operativo: considerare valido il sorgente se nel repository la proprietà contiene semplicemente la stringa URL locale; aprire un finding soltanto se il markup compare davvero nel file sorgente.

## 8. Rischi verificati

Dal contratto inteso non emergono:

- endpoint nominalmente remoti ammessi;
- protocolli diversi da HTTP/HTTPS;
- seed non interi o negativi;
- temperature/topP fuori range;
- timeout illimitati;
- proprietà extra accettate;
- default mutabili superficialmente.

## 9. Tracker Excel

### Punti esistenti avvalorati

Il file avvalora il lavoro già svolto sulla configurabilità/provenance dei parametri modello e dell'inference timeout.

### Nuovi punti da aggiungere

**Nessuno.**

La rappresentazione HTML dell'URL nel testo della chat non viene classificata come bug del repository senza evidenza che sia presente nel sorgente reale.

## 10. Verdetto finale

`ModelSessionConfig.ts` è **PASS** nel contratto sorgente inteso. Il modello di validazione è strict, bounded e coerente con la riproducibilità sperimentale. Non emerge un nuovo punto da aggiungere all'Excel.
