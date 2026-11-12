import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  GitManager,
  type PatchScope
} from '../src/git/GitManager.js';

const TARGET_FILE =
  'src/example.ts';

const SCOPE: PatchScope = {
  category: 'REPAIR',
  targetFiles: [
    TARGET_FILE
  ],
  testFiles: []
};

const SOURCE_CONTENT = [
  'const value = 1;',
  'export default value;'
].join('\n') + '\n';

/**
 * Questa patch è strutturalmente valida ma non è grounded:
 *
 * - la riga rimossa "const value = 1;" esiste;
 * - la riga di contesto "export default wrongValue;" non esiste;
 * - il contesto errato segue un replacement group;
 * - il contesto errato non compare altrove nel source.
 *
 * normalizeRejectedDiff() può quindi correggere
 * deterministicamente il contesto usando il source originale.
 */
const NORMALIZABLE_REJECTED_PATCH = [
  'diff --git a/src/example.ts b/src/example.ts',
  '--- a/src/example.ts',
  '+++ b/src/example.ts',
  '@@ -1,2 +1,2 @@',
  '-const value = 1;',
  '+const value = 2;',
  ' export default wrongValue;'
].join('\n');

describe(
  'BE-P1-25 - GitManager normalizeRejectedPatch realpath confinement',
  () => {
    let sandboxRoot: string;
    let repositoryRoot: string;
    let externalRoot: string;

    beforeEach(
      async () => {
        sandboxRoot =
          await fs.mkdtemp(
            path.join(
              os.tmpdir(),
              'be-p1-25-'
            )
          );

        repositoryRoot =
          path.join(
            sandboxRoot,
            'repository'
          );

        externalRoot =
          path.join(
            sandboxRoot,
            'external'
          );

        await fs.mkdir(
          repositoryRoot,
          {
            recursive: true
          }
        );

        await fs.mkdir(
          externalRoot,
          {
            recursive: true
          }
        );
      }
    );

    afterEach(
      async () => {
        await fs.rm(
          sandboxRoot,
          {
            recursive: true,
            force: true
          }
        );
      }
    );

    it(
      'continua a normalizzare una patch rifiutata usando un file interno reale',
      async () => {
        const internalSourceDirectory =
          path.join(
            repositoryRoot,
            'src'
          );

        const internalSourceFile =
          path.join(
            internalSourceDirectory,
            'example.ts'
          );

        await fs.mkdir(
          internalSourceDirectory,
          {
            recursive: true
          }
        );

        await fs.writeFile(
          internalSourceFile,
          SOURCE_CONTENT,
          'utf8'
        );

        const gitManager =
          new GitManager(
            repositoryRoot
          );

        const normalizedPatch =
          await gitManager
            .normalizeRejectedPatch(
              NORMALIZABLE_REJECTED_PATCH,
              SCOPE
            );

        expect(
          normalizedPatch
        ).not.toBeNull();

        expect(
          normalizedPatch
        ).toContain(
          '-const value = 1;'
        );

        expect(
          normalizedPatch
        ).toContain(
          '+const value = 2;'
        );

        expect(
          normalizedPatch
        ).toContain(
          '-export default value;'
        );

        expect(
          normalizedPatch
        ).toContain(
          '+export default wrongValue;'
        );

        expect(
          normalizedPatch
        ).not.toContain(
          ' export default wrongValue;'
        );
      }
    );

    it(
      'rifiuta una directory interna che tramite junction risolve fuori dal repository',
      async () => {
        const externalSourceFile =
          path.join(
            externalRoot,
            'example.ts'
          );

        const internalSourceJunction =
          path.join(
            repositoryRoot,
            'src'
          );

        await fs.writeFile(
          externalSourceFile,
          SOURCE_CONTENT,
          'utf8'
        );

        /*
         * repository/src sembra interno lessicalmente,
         * ma risolve realmente verso externalRoot.
         *
         * Su Windows una junction non richiede normalmente
         * i privilegi necessari per un symlink file.
         */
        await fs.symlink(
          externalRoot,
          internalSourceJunction,
          'junction'
        );

        const gitManager =
          new GitManager(
            repositoryRoot
          );

        const warnSpy =
          jest
            .spyOn(
              console,
              'warn'
            )
            .mockImplementation(
              () => undefined
            );

        try {
          const normalizedPatch =
            await gitManager
              .normalizeRejectedPatch(
                NORMALIZABLE_REJECTED_PATCH,
                SCOPE
              );

          expect(
            normalizedPatch
          ).toBeNull();

          expect(
            warnSpy
          ).toHaveBeenCalledWith(
            expect.stringContaining(
              'Normalizzazione patch rifiutata'
            )
          );

          expect(
            warnSpy
          ).toHaveBeenCalledWith(
            expect.stringContaining(
              'risolve fuori dal repository'
            )
          );
        } finally {
          warnSpy.mockRestore();
        }
      }
    );

    it(
      'non consente al contenuto esterno compatibile di confluire nella normalizzazione',
      async () => {
        const externalSourceFile =
          path.join(
            externalRoot,
            'example.ts'
          );

        const internalSourceJunction =
          path.join(
            repositoryRoot,
            'src'
          );

        /*
         * Il contenuto esterno è deliberatamente compatibile
         * con NORMALIZABLE_REJECTED_PATCH.
         *
         * Senza confinement realpath, normalizeRejectedDiff()
         * potrebbe usarlo e produrre una patch normalizzata.
         */
        await fs.writeFile(
          externalSourceFile,
          SOURCE_CONTENT,
          'utf8'
        );

        await fs.symlink(
          externalRoot,
          internalSourceJunction,
          'junction'
        );

        const gitManager =
          new GitManager(
            repositoryRoot
          );

        const warnSpy =
          jest
            .spyOn(
              console,
              'warn'
            )
            .mockImplementation(
              () => undefined
            );

        let normalizedPatch:
          string | null;

        try {
          normalizedPatch =
            await gitManager
              .normalizeRejectedPatch(
                NORMALIZABLE_REJECTED_PATCH,
                SCOPE
              );
        } finally {
          warnSpy.mockRestore();
        }

        expect(
          normalizedPatch
        ).toBeNull();

        const externalContentAfter =
          await fs.readFile(
            externalSourceFile,
            'utf8'
          );

        expect(
          externalContentAfter
        ).toBe(
          SOURCE_CONTENT
        );
      }
    );
  }
);
