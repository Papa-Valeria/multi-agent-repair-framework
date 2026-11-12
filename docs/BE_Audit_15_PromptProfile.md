# Backend Freeze Audit 15 - `PromptProfile.ts`

## 1. Scopo

Audit di `PromptProfile.ts` nel freeze-check backend, con focus su:

- versionamento esplicito del Prompt Profile;
- centralizzazione delle istruzioni Coder/Reviewer/ContextBuilder;
- parita informativa Baseline/Multi-Agent;
- REPAIR/CREATE contract;
- protezione degli oracle/test;
- retry tecnico e refinement semantico;
- coerenza con `ContextBuilder.ts`, `CoderAgent.ts`, `ReviewerAgent.ts` e `UnifiedDiff.ts` gia auditati.

---

## 2. Sintesi esecutiva

**Esito: PASS - nessun nuovo punto autonomo da aggiungere all'Excel.**

Il profilo e esplicitamente versionato (`prompt-profile-v1`) e raccoglie in un unico oggetto le istruzioni usate da ContextBuilder, Coder e Reviewer. Le direttive REPAIR/CREATE, refinement e technical retry sono coerenti con l'architettura gia auditata: test immutabili, source authority sul contenuto originale, patch completa contro clean HEAD, remediation cumulative e output strutturato.

Non emergono nuovi blocker distinti. Due aspetti problematici rilevabili nel testo sono gia coperti da ticket aperti dell'audit:

- la frase secondo cui gli hunk header line numbers sono "informational" va riallineata quando verra chiuso **BE-P1-26**, che rendera autorevoli anche i count/header strutturali;
- `newFileTargetMarker` richiama `testContracts`, ma la completezza di quel contratto e gia oggetto di **BE-P1-27**.

Quindi non creo nuovi ticket duplicati.

---

## 3. Versionamento e single source of truth

Il profilo espone:

```ts
id: 'prompt-profile-v1'
```

`ContextBuilder`, `CoderAgent`, `ReviewerAgent` ricevono un `PromptProfile` iniettato e usano le sezioni specifiche del medesimo oggetto.

Questo conferma che il refactoring del Prompt Profile ha eliminato la precedente duplicazione dell'identita del prompt nel ContextBuilder.

Qualunque modifica materiale futura alle istruzioni sperimentali dovrebbe comportare un nuovo profile ID, mantenendo il contratto di provenance gia implementato nell'ExperimentProfile.

---

## 4. REPAIR contract

Le istruzioni REPAIR sono coerenti fra ContextBuilder e Coder:

- modifiche minimali;
- soli target dichiarati;
- test immutabili;
- patch costruita contro il source originale autorevole;
- niente patch incrementale contro una candidata rifiutata.

Il Reviewer replica la stessa restrizione semanticamente: le remediation REPAIR devono restare sui target source dichiarati.

Lo scope definitivo resta comunque enforced da GitManager, quindi il prompt non e usato come controllo di sicurezza unico.

---

## 5. CREATE contract

Il profilo CREATE consente:

- modifica di target esistenti;
- creazione di target mancanti;
- file sorgente aggiuntivi quando necessari;
- patch multi-file;
- sintassi Git new-file con `/dev/null`;
- test immutabili.

Questo e coerente con la policy CREATE di GitManager e con la selezione file di Semgrep gia auditata.

---

## 6. Authoritative source state

Le istruzioni ripetono in modo coerente che:

- il repository viene riportato al clean state prima di ogni iterazione;
- i contenuti dei target nel prompt sono autorevoli;
- una patch precedente e solo evidence;
- context e removed lines devono provenire dal source originale;
- il replacement patch deve essere completo.

Questa semantica e coerente con la FSM transazionale e con `ContextBuilder.baseContext`.

---

## 7. Refinement contract

`refinementInstructions` mantiene vincolanti le cumulative mandatory corrections e richiede coverage correction-by-correction.

La policy evita che il Coder corregga soltanto il failure corrente perdendo correzioni gia validate nelle iterazioni precedenti.

Questo e coerente con `mergeCumulativeRemediations()` nella FSM.

---

## 8. Technical retry contract

Le istruzioni del technical retry distinguono esplicitamente la rigenerazione sintattica del diff da una nuova semantic refinement:

- preservare l'intento delle modifiche;
- non introdurre cambi semantici solo per riparare il formato;
- ricostruire il diff contro il source originale;
- usare il rejected candidate solo per recuperare l'intento.

La separazione e coerente con `maxTechnicalAttempts` e con `generateApplicablePatch()`.

---

## 9. Protezione test/oracle

Le istruzioni Coder e Reviewer vietano esplicitamente di modificare:

- test file;
- assertion;
- expected values;
- fixture/mock/test input/config;
- oracle infrastructure.

Il Reviewer viene inoltre istruito a convertire un test failure in una correzione del production source.

Questa protezione testuale e coerente con i gate applicativi Coder/Reviewer/GitManager; non viene usata come unica barriera.

---

## 10. Reviewer output contract

`responseInstructions` definisce uno schema JSON con:

- root cause summary;
- violationsPrunedCount;
- target remediations;
- security priority;
- flapping flag.

Il parser Reviewer, gia auditato, valida soltanto il sottoinsieme autorevole necessario e ricostruisce localmente i campi orchestrativi `violationsPrunedCount`, `securityPriorityStrict` e `flappingDetected`. Quindi il modello non e la fonte finale di tali valori.

Non emerge un problema di provenance.

---

## 11. Relazione con BE-P1-26 - Unified Diff hunk counts

Nel `diffInstructions` compare:

```text
Hunk header line numbers are informational; the exact prefixed lines determine whether the patch applies.
```

Nel sistema corrente questa frase rispecchia la tolleranza del parser/fallback interno, che non valida i count dichiarati. Tuttavia l'audit di `UnifiedDiff.ts` ha aperto **BE-P1-26** proprio per rendere coerenti e verificati gli header/count.

### Aggiornamento da includere in BE-P1-26

Quando BE-P1-26 verra implementato, aggiornare anche `PromptProfile.ts` per evitare che il Coder venga istruito a trattare gli hunk header come meramente informativi.

La nuova formulazione dovra richiedere header coerenti con le righe effettive del diff.

Questo non genera un nuovo ticket: e una dipendenza documentale/contrattuale di BE-P1-26.

---

## 12. Relazione con BE-P1-27 - Test Contract

`newFileTargetMarker` dice di sintetizzare il file per soddisfare `testContracts` e `issueSpec`.

Il concetto e corretto, ma l'audit di `ContextBuilder.ts` ha rilevato che l'attuale `testContracts` e ottenuto tramite estrazione lessicale incompleta.

Quindi il Prompt Profile non e difettoso autonomamente; la source data del contract va corretta tramite **BE-P1-27**.

---

## 13. Relazione con BE-P1-28 - Coder diff extraction

Il profilo richiede correttamente:

```text
ONLY one diff block and nothing else
```

BE-P1-28 resta comunque valido perche il runtime deve essere robusto anche quando il modello non rispetta perfettamente il formatting ma produce comunque un unico diff valido identificabile.

Il prompt e un vincolo comportamentale; l'extractor deve restare deterministico e fail-closed.

---

## 14. Immutabilita runtime

`DEFAULT_PROMPT_PROFILE` e tipizzato come `PromptProfile` ma, nel file fornito, non e avvolto in `Object.freeze()`.

Questa e un'osservazione di hardening, non un nuovo blocker: le proprieta sono `readonly` a compile time e il profilo viene usato come costante. Non risultano mutation path nei consumer auditati.

Se in futuro si vuole rafforzare l'immutabilita runtime dei profili, conviene farlo in modo uniforme su tutti i nested profile objects. Non apro un nuovo P1 per questo solo aspetto.

---

## 15. Punti gia svolti avvalorati

Il file avvalora:

- Prompt Profile esplicitamente versionato;
- singola source of truth per Coder/Reviewer/ContextBuilder;
- provenance prompt centralizzata;
- REPAIR/CREATE contract;
- cumulative refinement contract;
- technical retry contract;
- test/oracle immutability instructions;
- output contracts strutturati.

Nessun punto precedentemente chiuso richiede riapertura dal solo file.

---

## 16. Righe da aggiungere all'Excel

**Nessuna nuova riga.**

### Aggiornamento alla riga BE-P1-26

Aggiungere ai campi esistenti:

**File coinvolti:** includere anche `PromptProfile.ts`.

**Fix minima:** oltre alla validazione `oldCount/newCount` in `UnifiedDiff.ts`, aggiornare le istruzioni del Prompt Profile affinche il Coder generi hunk header/count coerenti con le righe del diff e non li consideri meramente informativi.

**Note:** `PromptProfile.ts` auditato: il testo attuale riflette la tolleranza pre-BE-P1-26 e deve essere riallineato contestualmente alla fix, senza ticket separato.

### BE-P1-27

Nessuna modifica ai campi gia proposti. Il Prompt Profile usa correttamente il concetto di `testContracts`; il problema resta l'estrazione incompleta nel ContextBuilder.

---

## 17. Freeze gates

### G4 - Information Contract / Prompt Gate

Il profilo prompt e coerente e versionato. G4 resta aperto esclusivamente per il gap BE-P1-27 sul contenuto effettivo del Test Contract e per la regression finale.

### G10 - Experimental E2E Gate

Nessun nuovo blocker nasce dal profilo. BE-P1-26 e BE-P1-28 richiedono pero riallineamento runtime/prompt del contratto Unified Diff.

---

## 18. Esito finale

| Area | Esito |
|---|---|
| Profile ID | Conforme |
| Centralizzazione prompt | Conforme |
| REPAIR contract | Conforme |
| CREATE contract | Conforme |
| Authoritative source contract | Conforme |
| Refinement instructions | Conforme |
| Technical retry instructions | Conforme |
| Test/oracle protection | Conforme |
| Reviewer JSON contract | Conforme |
| Hunk header wording | Da riallineare dentro BE-P1-26 |
| Test contract concept | Conforme, source gap coperto da BE-P1-27 |
| Runtime freeze | Osservazione non bloccante |
| Nuovi punti Excel | Nessuno |

**Verdetto:** `PASS - nessun nuovo ticket; aggiornare BE-P1-26 come indicato.`

**Prossimo file raccomandato:** `OpenAICompatibleClient.ts`, per passare dall'information contract al boundary di inferenza, timeout, usage e telemetria.
