# BE Audit 26 — ProcessRunner.ts

## 1. Esito sintetico

**Valutazione complessiva: PASS per il freeze corrente. Nessun nuovo punto da aggiungere al tracker.**

`ProcessRunner.ts` implementa l'esecuzione controllata dei subprocess con environment allow-list, timeout, output bounded, separazione dell'errore di esecuzione dall'exit code e terminazione del process tree. Il codice ricevuto è coerente con gli hardening già affrontati sul runner, incluso il test di timeout parent/child BE-P1-15.

## 2. Contratto `ProcessResult`

Il risultato distingue esplicitamente:

- `exitCode: number | null`;
- `stdout` / `stderr`;
- flag di truncation separati;
- `timedOut`;
- `durationMs`;
- `executionError` opzionale.

Questa shape evita di confondere un processo terminato con exit code applicativo con un errore di spawn/esecuzione o un timeout.

## 3. Validazione del timeout

Prima dello spawn viene verificato che `timeoutMs` sia un intero strettamente positivo. Un valore invalido viene trasformato in un `ProcessResult` esplicito con `exitCode: null` ed `executionError`, senza avviare il processo.

I limiti superiori sono responsabilità degli schema di configurazione chiamanti, mentre il runner difende il proprio boundary minimo.

## 4. Spawn controllato

Lo spawn usa:

- `shell: false`;
- `windowsHide: true`;
- stdin ignorato;
- stdout/stderr pipe;
- environment costruito esclusivamente dalla allow-list;
- `detached` sui sistemi non Windows per creare un process group terminabile come albero.

L'assenza di shell riduce l'accoppiamento a parsing/quoting della shell e mantiene comando e argomenti separati.

## 5. Environment allow-list

`buildAllowedEnvironment()` parte da un environment vuoto e inserisce esclusivamente variabili presenti nella allow-list.

I nomi vengono canonicalizzati con `trim().toUpperCase()` e deduplicati tramite `Set`. `findEnvironmentValue()` prova prima la chiave canonica e poi una ricerca case-insensitive deterministica ordinata lessicograficamente.

Il runner non eredita quindi indiscriminatamente `process.env`.

## 6. Output bounded

`MAX_OUTPUT_LENGTH` è pari a 1.000.000 caratteri per stream. `appendOutput()` impedisce crescita indefinita delle stringhe accumulate e registra la perdita tramite `stdoutTruncated` / `stderrTruncated`.

Quando possibile viene inserito il marker `[output truncated]`; se lo spazio residuo è inferiore alla lunghezza del marker viene usato il prefisso che entra nel limite.

La provenance non perde quindi l'informazione che l'output è stato troncato.

## 7. Timeout e process-tree cleanup

Al timeout:

1. `timedOut` viene impostato a `true`;
2. viene invocato `killProcessTree(child)`;
3. viene avviato un grace timer di 5 secondi;
4. se il child emette `close`, il risultato viene finalizzato normalmente mantenendo `timedOut: true`;
5. se non arriva conferma entro il grace period, viene restituito un `executionError` esplicito.

Su POSIX il runner usa un process group (`detached: true`) e invia `SIGKILL` al gruppo con PID negativo. Se ciò fallisce, tenta `child.kill('SIGKILL')`.

Su Windows prova `taskkill /pid <pid> /T /F` e ricade su `child.kill('SIGKILL')` se il launcher fallisce o `taskkill` restituisce un codice non zero.

Questa implementazione è coerente con l'hardening già verificato da BE-P1-15.

## 8. Single settlement e timer cleanup

`finish()` è protetto dal flag `settled`, cancella entrambi i timer e risolve la Promise una sola volta.

Questo è importante perché eventi `error`, `close`, timeout e grace timeout possono competere temporalmente. Il guard impedisce risultati multipli.

## 9. Durata

La durata usa `performance.now()` dall'inizio dell'esecuzione fino al `finish()`. Viene quindi utilizzato un clock monotonic-like appropriato per misurare elapsed time invece di timestamp wall-clock.

Il risultato conserva la durata anche per timeout ed errori di esecuzione gestiti dal runner.

## 10. Gestione degli errori

Sono coperti distintamente:

- eccezione sincrona di `spawn`;
- evento `error` del child;
- errore durante il tentativo di terminazione dopo timeout;
- mancata conferma di chiusura nel grace period.

`errorMessage()` gestisce anche valori `unknown` non-`Error`.

## 11. Relazione con BE-P1-15

Il codice mostra gli elementi richiesti dal punto **BE-P1-15 — ProcessRunner timeout + child processes**: process group POSIX, terminazione tree-aware, percorso Windows dedicato, grace window e risultato timeout esplicito.

Dato il regression test precedentemente riportato come PASS per parent/child senza file tardivi, non emerge dal sorgente corrente evidenza per riaprire BE-P1-15.

## 12. Aspetti valutati ma non promossi a nuovi finding

### Fallback da tree kill a child kill

Il fallback `child.kill('SIGKILL')` non garantisce da solo la terminazione dei discendenti qualora la primitive tree-aware fallisca. Tuttavia il file segnala il problema nei percorsi osservabili e il requisito effettivo di assenza di contaminazione è già stato affrontato con il test di integrazione dedicato. Non viene quindi aperto un duplicato senza una regressione concreta del test.

### Unit of output bound

Il limite è applicato sulla lunghezza della stringa JavaScript dopo decode UTF-8, non sui byte raw. È coerente con il contratto `string` restituito dal runner e non costituisce, dal solo file, un rischio sperimentale che richieda un nuovo backlog item.

### Environment minimale

Il runner non reinserisce automaticamente `PATH` o altre variabili. È una scelta coerente con una allow-list esplicita. La configurazione chiamante deve dichiarare ciò che serve; non viene classificata come omissione del runner.

## 13. Tracker Excel

### Punti esistenti avvalorati

- **BE-P1-15:** il sorgente avvalora il design di process-tree timeout cleanup e non mostra regressioni rispetto alla chiusura già testata.

### Nuovi punti da aggiungere

**Nessuno.**

## 14. Verdetto finale

`ProcessRunner.ts` è **PASS** per il freeze corrente. Il boundary di esecuzione è esplicito, bounded e fail-aware; timeout e cleanup del process tree sono implementati in modo coerente con l'hardening già svolto. Non emerge un nuovo punto indipendente da aggiungere all'Excel.
