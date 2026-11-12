# BE Audit 22 — BuildOracleConfig.ts

## 1. Esito sintetico

**Valutazione complessiva: PASS. Nessun nuovo punto da aggiungere al tracker.**

`BuildOracleConfig.ts` definisce e valida a runtime la configurazione del Build/Syntax Oracle, la policy degli exit code e la configurazione del Functional Test Oracle. Il contratto è restrittivo, usa Zod `.strict()`, limita dimensioni e timeout, canonicalizza le variabili ambiente e intercetta duplicazioni/ambiguità rilevanti.

L'unico tema architetturale evidente è che il file contiene anche `functionalTestOracleConfigSchema`: questo coincide con il punto post-freeze già noto **BE-P2-02 — Separare file di config oracle**, quindi non deve essere duplicato.

---

## 2. Build Oracle configuration

`buildOracleConfigSchema` valida:
- comando non vuoto e limitato a 500 caratteri;
- massimo 100 argomenti, ciascuno entro 1000 caratteri;
- `cwd` opzionale, non vuoto se presente e limitato a 1000 caratteri;
- `timeoutMs` intero tra 1.000 e 300.000 ms;
- massimo 100 variabili nella allow-list.

L'uso di `.strict()` impedisce proprietà non dichiarate nel payload di configurazione.

Il tipo esportato `BuildOracleConfig` rende `args` ed `envAllowList` readonly, preservando il contratto immutabile lato TypeScript.

## 3. Environment allow-list

`environmentNameSchema` applica `trim()`, impone lunghezza 1..200 e converte il nome in uppercase. La successiva `superRefine` verifica l'unicità dopo la trasformazione. Di conseguenza varianti come `path`, `PATH` o valori con spazi esterni convergono prima del controllo dei duplicati.

Questo è coerente con un contratto deterministico della allow-list.

## 4. Expected Exit Policy

`expectedExitPolicySchema` separa tre classi:
- `passExitCodes`;
- `failExitCodes`;
- `executionErrorExitCodes`.

Gli exit code sono interi nel range 0..255. Pass e fail richiedono almeno un elemento; execution-error può essere vuoto. Ogni categoria ha massimo 32 valori.

La validazione aggiuntiva controlla correttamente:
1. duplicati interni a ciascuna categoria;
2. presenza dello stesso exit code in categorie differenti.

Questo evita policy semanticamente ambigue nelle quali uno stesso processo potrebbe essere classificato contemporaneamente come pass/fail/execution-error.

## 5. Functional Test Oracle configuration

`functionalTestOracleConfigSchema` valida comando, args, cwd, timeout, manifest `oracleFiles`, environment allow-list, expected exit policy e `allowImplicitDiscovery`.

Particolarmente rilevante per il freeze:
- `allowImplicitDiscovery` ha default `false`;
- con discovery implicita disabilitata è obbligatorio almeno un `oracleFile`;
- vengono intercettati path duplicati secondo la normalizzazione locale prevista dal file.

Questo mantiene esplicito il manifest nel comportamento standard anziché introdurre discovery silenziosa.

## 6. Normalizzazione di `oracleFiles`

Ai soli fini del controllo dei duplicati il codice:
- applica `trim()`;
- sostituisce `\` con `/`;
- rimuove un prefisso `./`;
- applica lowercase.

La normalizzazione non sostituisce i boundary di sicurezza e confinement già demandati a `RepositoryPathPolicy`/consumer. Dal solo contenuto di questo file non emerge motivo per duplicare i finding già affrontati sul manifest/confinement.

## 7. Finding architetturale già censito

Il file, nonostante il nome `BuildOracleConfig.ts`, contiene anche:
- `expectedExitPolicySchema`;
- `functionalTestOracleConfigSchema`.

Questa commistione è esattamente il tema già registrato come **BE-P2-02 — Separare file di config oracle**. È un miglioramento post-freeze e non un nuovo P0/P1.

**Decisione audit:** non creare un nuovo ticket.

## 8. Valutazione freeze

Non risultano dal file:
- fallback impliciti inattesi nel default;
- exit policy ambigue accettate;
- timeout non vincolati;
- configuration keys extra accettate;
- duplicati di environment name non rilevati dopo canonicalizzazione.

La configurazione è quindi sufficientemente difensiva per il contratto corrente.

## 9. Tracker Excel

### Punti esistenti avvalorati

Il file è coerente con il lavoro già svolto sulle configurazioni runtime dell'oracle e con la separazione delle policy di esecuzione.

### Punto esistente ancora pertinente

**BE-P2-02 — Separare file di config oracle**: confermato dal fatto che `BuildOracleConfig.ts` ospita anche la configurazione del Functional Test Oracle. Resta correttamente post-freeze.

### Nuovi punti da aggiungere

**Nessuno.**

## 10. Verdetto finale

`BuildOracleConfig.ts` è **PASS** per il freeze corrente. Le validazioni Zod risultano esplicite e restrittive e le principali ambiguità di configurazione vengono rifiutate. La separazione futura delle config oracle è già coperta da BE-P2-02, quindi l'audit non produce nuovi punti Excel.
