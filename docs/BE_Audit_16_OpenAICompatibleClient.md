# Backend Freeze Audit 16 - `OpenAICompatibleClient.ts`

## 1. Scopo

Audit del boundary di inferenza con focus su timeout, error taxonomy, usage/token telemetry, response validation, endpoint validation e riproducibilita della configurazione sperimentale.

## 2. Sintesi esecutiva

**Esito: PASS CON UN GAP P1 PRE-FREEZE.**

Il client implementa correttamente timeout esplicito per `completeChat()`, `InferenceTimeoutError`, configurazione deterministica (`model`, `temperature`, `top_p`, `seed`, `stream=false`) e token usage nullable quando il provider non restituisce `usage`. Questo avvalora i precedenti hardening su timeout e telemetria.

E emerso pero un gap nella contabilizzazione della telemetria LLM: `recordLLMUsage()` viene chiamato solo dopo una risposta HTTP OK e JSON valido, prima della validazione finale di `choices[0].message.content`. Le invocazioni che terminano con timeout, HTTP error, fetch/JSON error o payload senza contenuto non registrano la durata dell'inferenza fallita. La cumulative telemetry puo quindi sottostimare il costo temporale dei run falliti e rendere meno comparabili run successful/failure.

Propongo **BE-P1-29**.

---

## 3. Configurazione di inferenza

Il payload e costruito esclusivamente dalla `InferenceConfig` iniettata:

- model;
- temperature (default 0.0);
- top_p (default 1.0);
- seed (default 42);
- stream false.

Il timeout non e inviato al provider, ma imposto dal client tramite `AbortController` e `setTimeout`, quindi resta sotto controllo del framework.

---

## 4. Endpoint validation

`validateEndpoint()` interroga `/models`, verifica `response.ok` e, quando il provider restituisce una lista non vuota di model ID, controlla che il modello configurato sia presente.

La verifica ha un timeout separato, di default 5000 ms.

Il composition root gia auditato esegue questa validazione prima del run sperimentale.

### Osservazione non bloccante

`validateEndpoint()` converte l'AbortError in un normale `Error` descrittivo, non in `InferenceTimeoutError`. Questo metodo e preflight e nel composition root viene trasformato in HTTP 503 prima dell'avvio della sessione, quindi non apre un nuovo ticket del failure model sperimentale.

---

## 5. Timeout di inferenza

`completeChat()` mantiene un flag `timeoutTriggered` oltre al controllo `AbortError`, evitando di dipendere soltanto dal nome dell'eccezione del runtime.

In caso di timeout viene sollevato:

```ts
new InferenceTimeoutError(
  inferenceTimeoutMs,
  endpoint
)
```

La classe conserva sia soglia sia endpoint e ha un tipo runtime distinto. Questo conferma il precedente hardening BE-P0-09.

---

## 6. HTTP/process error boundary

Una risposta non-2xx viene convertita in errore con status e body restituito dal provider.

Altri errori non-timeout vengono contestualizzati con l'endpoint di inferenza.

`CoderAgent` e `ReviewerAgent` hanno successivamente i propri boundary tipizzati/provenance, gia auditati.

---

## 7. Token usage

Il client interpreta:

```ts
data.usage?.prompt_tokens ?? null
data.usage?.completion_tokens ?? null
```

Quindi l'assenza di usage non viene convertita artificialmente in zero. Questo e coerente con la semantica gia verificata in `VerificationInvariants.ts` e con il precedente BE-P0-10.

`TelemetryTracker.recordLLMUsage()` riceve il ruolo (`CODER`/`REVIEWER`) e i due conteggi nullable.

---

## 8. Response content validation

Dopo il parsing JSON viene verificato:

```ts
const content = data.choices[0]?.message.content;
if (typeof content !== 'string') throw ...
```

Un payload privo di una scelta testuale valida non viene accettato come output.

Una stringa vuota, invece, viene restituita al consumer e viene poi rifiutata da `CoderAgent.extractDiff()` o dal parser Reviewer. La responsibility separation e coerente.

---

## 9. Gap emerso - durata delle inferenze fallite non registrata

### Evidenza

La durata viene calcolata e registrata solo nel success path:

```ts
const data = await response.json();
const durationMs = performance.now() - t0;
...
this.telemetryTracker.recordLLMUsage(
  role,
  promptTokens,
  completionTokens,
  durationMs
);
```

Se fallisce uno dei passaggi precedenti, o se il payload non contiene una scelta testuale valida dopo la registrazione, il comportamento e asimmetrico.

In particolare non viene registrata la durata per:

- timeout;
- network/fetch error;
- HTTP non-2xx;
- JSON parsing error.

### Rischio

La telemetria cumulativa dei run falliti puo non includere il tempo speso in una chiamata LLM fallita. Il risultato e una sottostima di `inferenceDurationMs` proprio nei failure path, con impatto sulla comparabilita sperimentale delle durate.

### Nota sul payload senza choices

Nel caso `response.json()` riesca ma il payload non abbia text content, `recordLLMUsage()` e gia stato chiamato prima del controllo finale. Quindi quel failure path e contabilizzato. Il gap riguarda i failure precedenti alla chiamata di `recordLLMUsage()`.

### Fix minima

Introdurre un boundary di timing che registri la durata di ogni tentativo LLM una sola volta, anche su failure. Quando usage non e disponibile, registrare token `null/null` mantenendo `tokenUsageAvailable=false` secondo il contratto esistente.

La fix deve evitare doppia contabilizzazione nel success path. Una strategia minima e separare "record attempt duration" da "record token usage", oppure rendere `recordLLMUsage()` invocabile in `catch/finally` con guard di registrazione.

---

## 10. Nuova riga da aggiungere all'Excel

**ID:** BE-P1-29  
**Priorita:** P1  
**Sprint/Area:** P1 - Hardening  
**Attivita:** Registrare la durata delle inferenze LLM anche nei failure path  
**Problema/Rischio:** `OpenAICompatibleClient.completeChat()` chiama `TelemetryTracker.recordLLMUsage()` soltanto dopo risposta HTTP OK e parsing JSON riuscito. Timeout, network/fetch error, HTTP non-2xx e JSON parsing failure non registrano la durata del tentativo LLM, sottostimando `inferenceDurationMs` nei run falliti e riducendo la comparabilita sperimentale delle durate.  
**File coinvolti:** `OpenAICompatibleClient.ts; TelemetryTracker.ts; test inference timeout/error telemetry`  
**Fix minima:** Garantire che ogni tentativo `completeChat()` registri esattamente una volta la propria durata di inferenza anche quando fallisce; sui failure senza usage registrare token indisponibili come `null/null` secondo il contratto esistente, evitando doppio conteggio nel success path.  
**Criterio di chiusura:** Success, timeout, HTTP error, network error e JSON/payload failure contribuiscono una sola volta a `inferenceDurationMs`; i token restano null quando non disponibili; nessun doppio conteggio; regression test mirati e full suite backend verdi.  
**Stato:** Da fare  
**Completata?:** ☐  
**Data prevista:** Da pianificare  
**Data completamento:** —  
**Owner:** Valeria  
**Note:** Emerso durante freeze audit di `OpenAICompatibleClient.ts`. Impatta G5 - Telemetry Gate e la comparabilita dei failure run; preservare la semantica BE-P0-10 dei token mancanti.

---

## 11. Punti gia svolti avvalorati

Il file avvalora:

- BE-P0-09: timeout LLM tipizzato tramite `InferenceTimeoutError`;
- BE-P0-10: token usage mancante rappresentato come null/unavailable;
- configurazione modello esplicita e riproducibile;
- role attribution CODER/REVIEWER;
- endpoint preflight prima dell'esperimento.

Nessuno di questi punti deve essere riaperto; BE-P1-29 riguarda esclusivamente la completezza temporale della telemetria sui failure path.

---

## 12. Freeze gates

### G5 - Telemetry Gate

Resta aperto. Questo file introduce BE-P1-29; il prossimo audit di `TelemetryTracker.ts` deve verificare come duration e usage vengono accumulati e se la fix puo essere implementata senza alterare il modello scientifico gia congelato.

### G10 - Experimental E2E Gate

Il failure model di inferenza e tipizzato, ma la sua durata non e sempre osservabile. BE-P1-29 va chiuso prima del freeze finale.

---

## 13. Esito finale

| Area | Esito |
|---|---|
| Inference config | Conforme |
| Endpoint preflight | Conforme |
| Timeout type | Conforme |
| HTTP/network wrapping | Conforme |
| Missing token usage semantics | Conforme |
| Role attribution | Conforme |
| Content validation | Conforme |
| Successful inference telemetry | Conforme |
| Failed inference duration telemetry | Gap P1 |
| Nuovi punti Excel | 1 (`BE-P1-29`) |

**Verdetto:** `PASS CON GAP PRE-FREEZE`.

**Prossimo file raccomandato:** `TelemetryTracker.ts`.
