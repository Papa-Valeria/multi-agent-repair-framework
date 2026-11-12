# BE Audit 27 — PytestSummaryParser.ts

## 1. Esito sintetico

**Valutazione: PASS con un nuovo hardening P1 proposto.**

Il parser ha una struttura prudente: normalizza EOL/ANSI, tratta esplicitamente zero test, cerca la summary finale dal fondo, richiede una durata valida, contabilizza gli outcome pytest e restituisce `null` quando non può validare una summary significativa.

Il punto critico residuo è l'accumulo numerico: ogni conteggio catturato è verificato come `Number.isSafeInteger`, ma le somme cumulative e `totalTests` non sono nuovamente controllate come safe integer. Con input artificiale ma sintatticamente accettato, più conteggi individualmente safe possono produrre una somma non safe e quindi una metrica numericamente non affidabile.

## 2. Normalizzazione dell'output

La funzione normalizza CRLF in LF e rimuove sequenze ANSI prima del parsing. Questo evita che colorazione terminale e differenze EOL alterino il riconoscimento della summary.

Nel testo incollato in chat alcuni token regex (`[` e `.`) risultano avvolti da markup della UI. L'audit assume il sorgente TypeScript originale con regex ANSI e durata normali; se tale markup fosse davvero presente nel repository, il file andrebbe verificato direttamente perché il testo sarebbe stato alterato dalla superficie chat.

## 3. Gestione esplicita di zero test

Sono riconosciute le forme `no tests ran` e `collected 0 item/items`. In questi casi viene restituito un `ParsedTestSummary` con tutti i conteggi a zero e `zeroTestsCollected: true`.

Questa scelta è semanticamente importante: zero test non viene confuso con output non parsabile (`null`).

## 4. Individuazione della summary

Il parser:

1. suddivide l'output in linee non vuote;
2. scorre dal fondo;
3. rimuove i marker `=` esterni;
4. richiede almeno un outcome numerico pytest;
5. richiede la coda di durata `in <n>s`.

La ricerca dal fondo è appropriata alla struttura tipica dell'output pytest e riduce la probabilità di interpretare una riga intermedia come summary finale.

## 5. Outcome supportati

Vengono contabilizzati separatamente:

- passed;
- failed;
- skipped;
- xfailed;
- xpassed;
- error/errors.

Il totale è ricostruito come somma delle categorie. Questo è coerente con la struttura `ParsedTestSummary` usata dal subsystem dei test.

## 6. Fail-closed parziale

Se non viene trovata una summary valida, la funzione restituisce `null`. Anche un totale finale pari a zero, salvo i casi zero-test esplicitamente riconosciuti, produce `null`.

Questo evita di convertire output arbitrario in una summary vuota apparentemente valida.

## 7. Nuovo finding: overflow della somma dei conteggi

Il parser controlla ciascun `count` con `Number.isSafeInteger(count)`, ma dopo gli incrementi non verifica che i contatori cumulativi rimangano safe integer. Infine anche `totalTests` viene calcolato senza una verifica `Number.isSafeInteger(totalTests)`.

Una summary manipolata può contenere più occorrenze di outcome con valori individualmente safe ma la cui somma supera `Number.MAX_SAFE_INTEGER`. In tale situazione JavaScript perde la garanzia di precisione intera e il parser potrebbe restituire metriche numericamente non affidabili invece di fallire chiuso.

Per un normale output pytest il rischio operativo è basso, ma il parser è un boundary di acquisizione di evidenza e dovrebbe rifiutare deterministicamente valori che non può rappresentare esattamente.

## 8. Fix minima proposta

Dopo ogni accumulo, oppure almeno prima del return, validare che tutti i contatori cumulativi e `totalTests` siano `Number.isSafeInteger` e non negativi. In caso contrario restituire `null`.

Non serve cambiare il modello dati né introdurre BigInt: è sufficiente mantenere il contratto numerico corrente in modo fail-closed.

## 9. Test di chiusura suggeriti

Aggiungere casi che verifichino:

- conteggio individuale oltre il safe integer → `null`;
- più conteggi individualmente safe la cui somma supera `Number.MAX_SAFE_INTEGER` → `null`;
- summary pytest ordinaria → invariata;
- zero-test riconosciuto → invariato;
- ANSI + CRLF → invariato.

## 10. Tracker Excel

### Nuovo punto da aggiungere

**BE-P1-33 — Rifiutare overflow dei conteggi nel Pytest Summary Parser.**

Il finding è locale al parser, non duplica i precedenti hardening del ProcessRunner e preserva il principio di non trasformare evidenza non rappresentabile con precisione in una metrica scientifica valida.

## 11. Verdetto finale

`PytestSummaryParser.ts` è complessivamente robusto, ma per chiudere completamente il boundary numerico va aggiunto il controllo sulle somme cumulative. Il file è pertanto **PASS con remediation P1 proposta (BE-P1-33)**.
