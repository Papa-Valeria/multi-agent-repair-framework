# BE Audit 30 — app.ts

## 1. Esito sintetico

**Valutazione complessiva: FAIL per il freeze fino alla chiusura di due nuovi hardening P1.**

`app.ts` orchestra correttamente gran parte dell'architettura già consolidata: parsing Zod delle configurazioni, path confinement sui file del task, manifest authorization degli oracle file, profili versionati, fixture identity, separazione baseline/multi-agent, persistenza V2, terminal-state policy e finalizzazione transazionale.

L'audit identifica tuttavia due problemi distinti nel boundary HTTP/orchestrator:

1. il lock globale `experimentExecutionActive` non viene acquisito atomicamente prima delle prime operazioni asincrone, quindi due richieste `/execute` concorrenti possono superare entrambe il controllo e avviare run sovrapposti;
2. il server espone operazioni filesystem/Git ad alto impatto su `0.0.0.0`, con CORS riflessivo e root repository scelto dal client, senza un boundary di autorizzazione o una root consentita configurata dal server.

Si propongono **BE-P1-35** e **BE-P1-36**.

## 2. Aspetti corretti e già hardenizzati

### 2.1 Configurazioni runtime

Le configurazioni modello, Build/Syntax, Functional Test e limiti sperimentali vengono validate tramite gli schema Zod dedicati. I valori parseati vengono copiati in strutture frozen prima dell'uso e della persistenza.

### 2.2 Baseline vs Multi-Agent

Il codice rende esplicita la modalità e forza per la baseline `maxIterations = 1` e `maxTechnicalAttempts = 1`. Il profilo persistito usa i limiti effettivi, non quelli richiesti ma non applicati.

### 2.3 Path confinement e oracle manifest

Target/test path sono risolti tramite `resolveRepositoryPath`. Il Functional Test Oracle:

- risolve il cwd entro repository;
- converte gli oracle file in repository-relative path;
- richiede appartenenza al manifest `testFiles` autorizzato;
- impedisce che il path risultante esca dal cwd di esecuzione.

Questa logica è coerente con gli hardening già svolti su confinement e manifest authorization.

### 2.4 Fixture identity e provenance

Prima del run vengono letti target/test sources, normalizzati gli EOL e calcolato `fixtureId` con category, issue spec e contenuti. L'`ExperimentProfile` persiste oracle/prompt/Semgrep profile, config, limiti e fixture metadata.

Resta valido il finding già registrato come BE-P1-32: l'`issueSpec` entra nell'hash ma non è direttamente presente in `ExperimentFixtureIdentity`. Non viene duplicato.

### 2.5 Persistence failure

Un errore di `saveRun()` viene convertito in `ExecutionFailure` di fase `PERSISTENCE`, risolto tramite `TerminalStatePolicy`, salvato nello stato in memoria e pubblicato via SSE. Il client riceve esplicitamente `persisted: false`.

### 2.6 Finalizzazione

Approve/reject applicano numerosi gate corretti:

- repository associato alla sessione;
- initial HEAD;
- working tree clean;
- applicabilità rivalutata;
- apply mode certificato;
- Human Override ammesso solo per status previsti;
- Human Override riverificato da Build, Semgrep e Functional Test;
- commit seguito da aggiornamento dello stato;
- rollback in caso di errore pre-commit;
- distinzione esplicita del caso commit riuscito ma persistenza finale fallita.

## 3. BE-P1-35 — Rendere atomica l'esclusione dei run sperimentali

### Evidenza

Il codice controlla:

`if (experimentExecutionActive) { ...409... }`

ma imposta:

`experimentExecutionActive = true`

solo dopo numerose operazioni asincrone, tra cui normalizzazione dei target/test path e risoluzione della configurazione Functional Test.

### Problema/Rischio

Due richieste concorrenti possono leggere entrambe `false`, attraversare gli `await` di preparazione e impostare entrambe il flag a `true`. I relativi run possono quindi sovrapporsi nonostante il messaggio API dichiari esecuzione sequenziale per preservare la telemetria CPU.

Il booleano è sufficiente soltanto se check e acquisizione avvengono nello stesso tratto sincrono, prima del primo `await`, oppure se viene usato un mutex/queue atomico.

### Fix minima

Acquisire il lock in modo atomico immediatamente dopo la validazione sincrona minima e prima di qualunque `await` relativo alla preparazione del run. Racchiudere tutte le operazioni successive nel relativo `try/finally`, oppure usare una primitive mutex/queue con acquisizione esclusiva.

Gli errori di validazione che si vogliono mantenere fuori dal lock possono essere elaborati prima, purché non includano operazioni asincrone e il passaggio check→set rimanga indivisibile.

### Criterio di chiusura

Un test di integrazione invia almeno due richieste `/api/tasks/:id/execute` realmente concorrenti e dimostra che una sola acquisisce l'esecuzione, mentre l'altra riceve `409` senza avviare FSM, endpoint LLM, oracle o telemetry. Il lock deve essere liberato su successo, validazione asincrona fallita, endpoint non disponibile, eccezione e persistence failure.

## 4. BE-P1-36 — Confinare e autorizzare i repository esposti dalle API

### Evidenza

Il server:

- ascolta su `0.0.0.0`;
- configura CORS con `origin: true`;
- accetta `repoPath` dal body/query;
- espone init con `hardReset`, mkdir, write e commit;
- espone execute/finalization sul repository indicato;
- espone `/api/files/read` usando anch'esso `repoPath` scelto dal client.

`resolveRepositoryPath` confina il file **dentro la root fornita dal client**, ma non dimostra che quella root sia autorizzata dal server.

### Problema/Rischio

Un client che raggiunge il servizio può proporre una root locale arbitraria accessibile al processo. Il confinement relativo protegge dall'escape rispetto a quella root, ma non impedisce di scegliere come root un percorso diverso dal workspace sperimentale autorizzato.

L'impatto potenziale comprende lettura di file, hard reset Git, scrittura/commit e avvio di tool in repository locali non destinati al workbench. L'esposizione su tutte le interfacce e il CORS riflessivo ampliano il boundary. L'audit non presume una minaccia Internet: il problema esiste già come assenza di una policy server-side sulla root.

### Fix minima

Definire lato server una o più repository root autorizzate e validare ogni `repoPath` contro tale policy prima di qualsiasi accesso. In alternativa, associare la root a un task/session handle creato server-side e non accettare nuovamente path arbitrari dal client.

Per il profilo strettamente locale, limitare di default il bind a loopback e usare una allow-list CORS esplicita. Se l'accesso remoto è un requisito, aggiungere autenticazione/autorizzazione coerente prima delle route mutative e di lettura.

### Criterio di chiusura

Test di integrazione dimostrano che:

- root esterne alla allow-list sono respinte prima di `GitManager`, `fs` o tool execution;
- `/api/files/read` non può usare una root arbitraria;
- init/execute/approve/reject operano soltanto sulla root associata/autorizzata;
- la configurazione predefinita non espone il servizio oltre il boundary previsto;
- CORS non riflette origini non autorizzate.

## 5. Altri aspetti valutati

### 5.1 Body request non validato integralmente

Le configurazioni complesse usano Zod, mentre alcuni envelope HTTP vengono trattati con type assertion. Questo può produrre errori 500 per body malformati. Non viene aperto un terzo ticket in questo audit perché il rischio principale del boundary è già catturato in BE-P1-36; la fix di quella route boundary policy dovrebbe includere schema runtime degli envelope per evitare accessi a path/array non validati.

### 5.2 Stato in memoria

Sessioni, config e listener sono process-local. Questo limita restart resilience e scalabilità orizzontale, ma il progetto corrente appare un workbench sperimentale single-process e non viene inventato un requisito distribuito post-freeze.

### 5.3 Singolo listener SSE per task

`sseListeners` conserva un solo listener per `taskId`; una seconda connessione sostituisce la precedente. Non viene classificato come blocker scientifico senza un requisito multi-subscriber.

### 5.4 Semgrep execution config hardcoded

Command, timeout e allow-list sono costruiti in `app.ts`, mentre il profilo ruleset è versionato. La generalizzazione futura è già coperta da BE-P2-01 e non viene duplicata.

## 6. Tracker Excel

### Punti esistenti avvalorati

Il file conferma l'integrazione di numerosi punti già chiusi: limiti configurabili, profile provenance, fixture identity, path confinement, manifest authorization, terminal-state policy, persistence failure, Human Override gates e transactional rollback.

### Nuovi punti da aggiungere

- **BE-P1-35 — Rendere atomica l'esclusione dei run sperimentali**
- **BE-P1-36 — Confinare e autorizzare i repository esposti dalle API**

## 7. Verdetto finale

`app.ts` integra correttamente molte difese locali, ma i due finding riguardano il boundary di orchestrazione complessivo e devono essere chiusi prima di dichiarare concluso il freeze audit del backend. L'audit file-by-file arriva a **30/30**, ma il backend non è ancora dichiarabile completamente chiuso finché BE-P1-31, BE-P1-32, BE-P1-33, BE-P1-34, BE-P1-35 e BE-P1-36 non sono verificati secondo i rispettivi criteri.
