import { DiffScoper } from '../src/verification/DiffScoper.js';
import { SastFinding } from '../src/types/domain.js';
import { describe, it, expect } from '@jest/globals';

describe('DiffScoper - Deterministic Boundary Verification', () => {
  const sampleDiff =
`--- a/src/auth.py
+++ b/src/auth.py
@@ -10,3 +10,4 @@
 existing_line()
+new_unsafe_query = "SELECT * FROM users WHERE id = " + user_input
+another_line()
`;

  it('deve estrarre correttamente gli intervalli di riga aggiunti o modificati', () => {
    const ranges = DiffScoper.extractModifiedLineRanges(sampleDiff);
    expect(ranges.has('src/auth.py')).toBe(true);
    const authRanges = ranges.get('src/auth.py')!;
    expect(authRanges.length).toBe(1);
    expect(authRanges[0]).toEqual({ start: 10, end: 13 });
  });

  it('deve trattenere solo le violazioni interne agli hunk ed escludere il debito tecnico pregresso', () => {
    const ranges = DiffScoper.extractModifiedLineRanges(sampleDiff);
    const mockFindings: SastFinding[] = [
      {
        ruleId: 'python.lang.security.injection.sql',
        path: 'src/auth.py',
        startLine: 11, // Interno alla modifica
        endLine: 11,
        severity: 'ERROR',
        message: 'SQL Injection rilevata'
      },
      {
        ruleId: 'python.lang.best-practice.unused-import',
        path: 'src/auth.py',
        startLine: 2, // Esterno (debito tecnico pregresso)
        endLine: 2,
        severity: 'WARNING',
        message: 'Import inutilizzato'
      }
    ];

    const scoped = DiffScoper.filterFindings(mockFindings, ranges);
    expect(scoped.length).toBe(1);
    expect(scoped[0]!.startLine).toBe(11);
    expect(scoped[0]!.ruleId).toBe('python.lang.security.injection.sql');
  });
});
