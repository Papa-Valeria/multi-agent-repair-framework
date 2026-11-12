# Backend Freeze Audit 01 - `TerminalStatePolicy.ts`

## 1. Scopo dell'analisi

Questo documento verifica `TerminalStatePolicy.ts` rispetto al tracker backend e, in particolare, ai seguenti elementi:

- **BE-P0-01** - Centralizzare definitivamente gli stati terminali;
- **BE-P0-02** - Correggere il fallback terminale senza evidenze;
- **BE-P0-03** - Conservare `TerminalStateReason` canonica;
- **Freeze Gate G1** - Terminal State Gate.

L'analisi è limitata al file ricevuto. La chiusura definitiva di G1 richiede anche la verifica dei call site in `RefinementFSM.ts` e l'esecuzione della suite completa.

---

## 2. Sintesi esecutiva

**Esito del file: CONFORME con il contratto atteso.**

Il file presenta una policy terminale centralizzata, deterministica e con precedenze esplicite. Il fallback senza evidenze è classificato correttamente come `INFRASTRUCTURE_ERROR / INFRASTRUCTURE_FAILURE`. Le categorie di failure sono separate in infrastrutturali, output sperimentale invalido e non-convergenza. La reason canonica viene restituita insieme allo status tramite `TerminalStateResolution`.

Non sono emersi nuovi bug bloccanti nel file analizzato.

**Stato raccomandato dei punti tracker dopo questa analisi:**

- BE-P0-01: evidenza nel file coerente con **Completata**;
- BE-P0-02: evidenza nel file coerente con **Completata**;
- BE-P0-03: evidenza nel file coerente con **Completata**;
- G1: **non ancora chiudibile dal solo file**; mantenere `Da fare` fino alla verifica di `RefinementFSM.ts` e dei test full-suite.

---

## 3. Contratto terminale osservato

### 3.1 Stati autonomi terminali ammessi

Il tipo `AutonomousTerminalStatus` limita correttamente gli outcome autonomi a:

- `CONVERGED`;
- `UNRESOLVED`;
- `FAILED`;
- `INFRASTRUCTURE_ERROR`.

Questo impedisce alla policy di restituire stati di finalizzazione umana come `APPROVED` o `REJECTED`, preservando la separazione introdotta da BE-P0-15.

### 3.2 Reason canoniche

`TerminalStateReason` espone un insieme chiuso e semanticamente distinto:

- `ALL_REQUIRED_GATES_PASSED`;
- `REQUIRED_ORACLE_UNAVAILABLE`;
- `INFRASTRUCTURE_FAILURE`;
- `EXPERIMENTAL_OUTPUT_FAILURE`;
- `REFINEMENT_BUDGET_EXHAUSTED`;
- `REFINEMENT_STAGNATION`;
- `VERIFICATION_GATES_FAILED`.

La distinzione tra failure infrastrutturale, output sperimentale invalido, mancata disponibilità oracle, fallimento dei gate, stagnazione e budget esaurito è coerente con il failure model descritto nel tracker.

### 3.3 Risoluzione completa

`TerminalStateResolution` restituisce congiuntamente:

```ts
{
  status,
  reason
}
```

Questo è il contratto corretto per evitare che la FSM ricostruisca localmente una reason divergente.

---

## 4. Analisi della precedenza decisionale

La funzione `resolveTerminalState()` applica le seguenti precedenze.

### Priorità 1 - Failure infrastrutturali esplicite

Le categorie seguenti producono immediatamente:

```text
INFRASTRUCTURE_ERROR / INFRASTRUCTURE_FAILURE
```

Categorie osservate:

- `CONTEXT_BUILD_FAILURE`;
- `MODEL_GENERATION_FAILURE`;
- `PATCH_APPLICATION_FAILURE`;
- `ORACLE_EXECUTION_FAILURE`;
- `ORACLE_INVARIANT_FAILURE`;
- `REVIEWER_FAILURE`;
- `REFINEMENT_CONTEXT_FAILURE`;
- `ROLLBACK_FAILURE`;
- `PERSISTENCE_FAILURE`;
- `INFRASTRUCTURE_FAILURE`;
- `UNKNOWN_FAILURE`.

La presenza di `PERSISTENCE_FAILURE` è coerente con BE-P0-13. La presenza di `UNKNOWN_FAILURE` impedisce che errori non classificati vengano interpretati come mancata convergenza sperimentale.

### Priorità 2 - Contraddizioni o errori degli oracle

```ts
decision?.hasInvariantViolation || decision?.hasExecutionError
```

produce:

```text
INFRASTRUCTURE_ERROR / INFRASTRUCTURE_FAILURE
```

Questa scelta è coerente con il principio che un oracle non eseguito correttamente o un verdetto internamente contraddittorio non costituiscono evidenza negativa valida sul candidato.

### Priorità 3 - Oracle required non disponibile

```ts
context.requiredOracleUnavailable || decision?.hasRequiredUnavailable
```

produce:

```text
UNRESOLVED / REQUIRED_ORACLE_UNAVAILABLE
```

La policy distingue correttamente indisponibilità da failure infrastrutturale esplicita e da gate fallito.

### Priorità 4 - Stagnazione

`REFINEMENT_STAGNATION` produce sempre:

```text
UNRESOLVED / REFINEMENT_STAGNATION
```

La reason specifica non viene degradata a `REFINEMENT_BUDGET_EXHAUSTED` o `VERIFICATION_GATES_FAILED`.

### Priorità 5 - Patch non applicabile

`PATCH_NOT_APPLICABLE` produce `UNRESOLVED` con reason dipendente dal budget:

- budget esaurito -> `REFINEMENT_BUDGET_EXHAUSTED`;
- budget non esaurito -> `VERIFICATION_GATES_FAILED`.

La distinzione è coerente: la stessa failure può rappresentare un arresto al limite oppure un verdetto terminale anticipato.

### Priorità 6 - Output sperimentale invalido

Le categorie:

- `DIFF_EXTRACTION_FAILURE`;
- `PATCH_SCOPE_FAILURE`;

producono:

```text
FAILED / EXPERIMENTAL_OUTPUT_FAILURE
```

Questo preserva la distinzione tra un output generato ma invalido e un problema infrastrutturale.

### Priorità 7 - Convergenza

`decision?.converged` produce:

```text
CONVERGED / ALL_REQUIRED_GATES_PASSED
```

La convergenza viene valutata dopo errori, indisponibilità e failure esplicite. Questa precedenza impedisce che un decision object contraddittorio sovrascriva condizioni più gravi.

### Priorità 8 - Non-convergenza / budget

Sono gestiti:

- `shouldRefine` con budget esaurito;
- decisione presente ma non convergente;
- budget esaurito senza decisione.

Tutti producono `UNRESOLVED` con reason coerente.

### Fallback finale

Un contesto senza decision, failure, indisponibilità o budget produce:

```text
INFRASTRUCTURE_ERROR / INFRASTRUCTURE_FAILURE
```

Questo soddisfa direttamente BE-P0-02: l'assenza di evidenza non viene interpretata come `EXPERIMENTAL_OUTPUT_FAILURE`.

---

## 5. Verifica puntuale rispetto al tracker

### BE-P0-01 - Centralizzare definitivamente gli stati terminali

**Evidenza nel file:**

- esiste una funzione autorevole `resolveTerminalState()`;
- le categorie sono centralizzate in set espliciti;
- la policy restituisce solo outcome autonomi terminali validi;
- le precedenze sono definite in un unico punto.

**Valutazione:** implementazione coerente con il punto segnato come completato.

**Limite dell'evidenza:** dal solo file non è possibile provare che ogni terminal path della FSM utilizzi effettivamente questa funzione. Questo controllo deve essere effettuato in `RefinementFSM.ts`.

### BE-P0-02 - Fallback terminale senza evidenze

**Evidenza nel file:** il return finale è:

```ts
return {
  status: 'INFRASTRUCTURE_ERROR',
  reason: 'INFRASTRUCTURE_FAILURE'
};
```

**Valutazione:** soddisfatto.

### BE-P0-03 - Conservare la reason canonica

**Evidenza nel file:** `TerminalStateResolution` contiene `status` e `reason`; `describeTerminalState()` utilizza `resolution.reason`.

**Valutazione:** soddisfatto nel producer della policy.

**Limite dell'evidenza:** bisogna verificare che `RefinementFSM.ts` non ignori la `reason` o ricostruisca localmente lo status.

---

## 6. Valutazione di `describeTerminalState()`

La funzione distingue due modalità:

1. senza failure esplicita, usa una descrizione canonica associata alla reason;
2. con failure esplicita, conserva reason, categoria e messaggio originario:

```text
<reason>: <failure.category>: <failure.message>
```

Questa scelta garantisce tracciabilità senza perdere la classificazione canonica.

### Osservazione non bloccante

Quando è presente una failure, la descrizione umana canonica non viene inclusa. Non è un bug rispetto ai criteri attuali, perché `resolution.reason` resta preservata e la failure strutturata contiene categoria e messaggio. Non propongo una modifica pre-freeze.

---

## 7. Rischi residui da verificare nei file successivi

### R1 - Bypass della policy nella FSM

Cercare in `RefinementFSM.ts` assegnazioni locali come:

```ts
status: 'FAILED'
status: 'UNRESOLVED'
status: 'INFRASTRUCTURE_ERROR'
status: 'CONVERGED'
```

Ogni stato terminale deve essere giustificato da `resolveTerminalState()` o da una risoluzione già prodotta dalla policy.

### R2 - Reason ricostruita localmente

Cercare costruzioni locali di `terminationReason` che non passino da:

```ts
describeTerminalState(...)
```

Sono ammissibili messaggi specifici di finalizzazione umana, ma non reason autonome divergenti.

### R3 - Context contraddittori

Verificare nei test la precedenza per combinazioni simultanee, almeno:

- converged + infrastructure failure;
- converged + required unavailable;
- invariant violation + shouldRefine;
- experimental output failure + budget exhausted;
- patch not applicable + budget exhausted;
- empty context.

### R4 - Completezza delle categorie

Ogni valore futuro aggiunto a `ExecutionErrorCategory` dovrà essere classificato esplicitamente. L'attuale fallback protegge dagli errori non riconosciuti solo se la FSM li mappa a `UNKNOWN_FAILURE`.

Non propongo adesso una modifica al tipo, ma questo va controllato quando analizzeremo `domain.ts` e `RefinementFSM.ts`.

---

## 8. Nuovi punti da aggiungere al tracker

**Nessun nuovo punto BE da aggiungere sulla base del solo file analizzato.**

Le osservazioni rilevate sono verifiche residue già comprese nel Freeze Gate G1 e nei punti BE-P0-01/03, non nuovi difetti autonomi.

---

## 9. Aggiornamenti consigliati al foglio Excel

### Backlog BE

Nessuna modifica di stato raccomandata per BE-P0-01, BE-P0-02 e BE-P0-03: le evidenze del file sono coerenti con lo stato `Completata` già registrato.

Non aggiungere nuove righe al backlog per questo file.

### Freeze Gates

Per **G1 - Terminal State Gate**:

- **Stato:** mantenere `Da fare` durante l'audit file-by-file;
- **Evidenza/Test provvisoria:**

```text
TerminalStatePolicy.ts verificato: policy centralizzata, fallback vuoto classificato come INFRASTRUCTURE_ERROR, reason canoniche preservate e precedenze coerenti. Chiusura subordinata all'audit di RefinementFSM.ts e alla full regression suite.
```

- **Note:**

```text
Nessun difetto bloccante rilevato nella policy. Restano da escludere terminal path locali o bypass della policy nella FSM.
```

---

## 10. Esito finale

| Area | Esito |
|---|---|
| Tipizzazione degli stati terminali | Conforme |
| Reason canoniche | Conforme |
| Classificazione failure infrastrutturali | Conforme |
| Classificazione output sperimentale invalido | Conforme |
| Classificazione non-convergenza | Conforme |
| Fallback senza evidenze | Conforme |
| Coerenza con BE-P0-01/02/03 | Conforme |
| Chiusura autonoma Freeze Gate G1 | Non ancora dimostrata |
| Nuovi issue BE | Nessuno |

**Verdetto del file:** `PASS - nessuna fix richiesta in TerminalStatePolicy.ts`.

**Prossimo file raccomandato:** `RefinementFSM.ts`, perché è necessario verificare che tutti i terminal path consumino effettivamente questa policy senza assegnazioni divergenti.
