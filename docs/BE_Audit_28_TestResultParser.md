# BE Audit 28 — TestResultParser.ts

## 1. Esito sintetico

**Valutazione complessiva: PASS. Nessun nuovo punto da aggiungere al tracker.**

`TestResultParser.ts` definisce un contratto minimale e neutrale rispetto al framework per rappresentare una summary di test e per collegare parser concreti tramite l'interfaccia `TestResultParser`.

Il file non contiene logica di parsing, formule o fallback. Le garanzie numeriche e semantiche restano responsabilità delle implementazioni concrete, come `PytestSummaryParser.ts`.

## 2. `ParsedTestSummary`

Il contratto rappresenta esplicitamente:

- `totalTests`;
- `passedTests`;
- `failedTests`;
- `skippedTests`;
- `xfailedTests`;
- `xpassedTests`;
- `errorTests`;
- `zeroTestsCollected`.

La separazione delle categorie evita di comprimere outcome differenti in un singolo numero e permette alle metriche a valle di distinguere failure, errori, skip e outcome expected/unexpected di pytest.

## 3. Distinzione zero-test / parse failure

`zeroTestsCollected` è parte della summary valida, mentre l'interfaccia del parser restituisce `ParsedTestSummary | null`.

Il contratto permette quindi di distinguere due casi semanticamente diversi:

- parsing riuscito con zero test raccolti;
- impossibilità di ottenere una summary attendibile (`null`).

Questa distinzione è coerente con il comportamento osservato in `PytestSummaryParser.ts`.

## 4. Contratto del parser

`TestResultParser` espone un'unica operazione:

`parse(output: string): ParsedTestSummary | null`

L'interfaccia è piccola e framework-agnostic: nuovi parser possono rispettare lo stesso consumer contract senza richiedere al chiamante di conoscere la sintassi del framework di test.

## 5. Immutabilità

Tutti i campi di `ParsedTestSummary` sono `readonly`. Il risultato del parser è quindi descritto come value object non modificabile dal consumer a livello TypeScript.

## 6. Runtime validation

Il file non applica validazione runtime ai numeri. Non viene classificato come nuovo finding, perché questa interfaccia è un contratto TypeScript e non un boundary di parsing autonomo. La validità degli output deve essere garantita dai parser concreti prima della costruzione di `ParsedTestSummary`.

Il problema numerico concreto trovato nel parser pytest è già stato registrato come **BE-P1-33** durante `BE_Audit_27_PytestSummaryParser` e non va duplicato in questo file.

## 7. Invarianti aritmetiche

L'interfaccia non codifica l'invariante `totalTests = somma delle categorie`, né non-negatività/safe-integer a livello tipo. TypeScript non può esprimere naturalmente tali vincoli con semplici `number`.

Non viene aperto un punto separato: la garanzia deve essere imposta al boundary concreto che costruisce il dato. Per pytest, il finding applicabile è già BE-P1-33.

## 8. Accoppiamento a pytest

Benché il nome `TestResultParser` sia generico, `ParsedTestSummary` include `xfailedTests` e `xpassedTests`, concetti particolarmente associati a pytest. Nel progetto corrente questo non rappresenta da solo un difetto di freeze: il profilo funzionale attuale usa il parser pytest e non è stata mostrata l'esistenza di un secondo framework con semantica incompatibile.

Un'eventuale generalizzazione multi-framework sarebbe evoluzione futura, non un problema da introdurre nell'attuale backlog senza un requisito concreto.

## 9. Tracker Excel

### Punti esistenti pertinenti

- **BE-P1-33:** resta il punto corretto per l'hardening numerico emerso nel parser pytest; questo file non aggiunge una seconda causa distinta.

### Nuovi punti da aggiungere

**Nessuno.**

## 10. Verdetto finale

`TestResultParser.ts` è **PASS**. Il contratto è semplice, readonly e sufficiente a separare summary valida, zero-test e parsing non affidabile. Non emerge un nuovo problema indipendente da quelli già individuati nelle implementazioni concrete.
