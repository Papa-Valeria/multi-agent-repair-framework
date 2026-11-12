import * as fs from "node:fs/promises";
import * as path from "node:path";

export class RepositoryPathPolicyError extends Error {
    constructor(
        message: string,
        readonly reason:
            | "EMPTY_PATH"
            | "ABSOLUTE_PATH"
            | "PATH_ESCAPE"
            | "GIT_PATH"
            | "REAL_PATH_ESCAPE"
            | "PATH_NOT_FOUND",
    ) {
        super(message);

        this.name = "RepositoryPathPolicyError";
    }
}

export interface ResolveRepositoryPathParams {
    readonly repositoryRoot: string;
    readonly relativePath: string;
    readonly allowMissing?: boolean;
    readonly allowRepositoryRoot?: boolean;
}

export interface ResolvedRepositoryPath {
    readonly relativePath: string;
    readonly absolutePath: string;
}

export interface CanonicalRepositoryPathParams {
    readonly repositoryRoot: string;
    readonly candidatePath: string;
}

export interface CanonicalRepositoryPath {
    readonly relativePath: string;
    readonly absolutePath: string;
}

export const canonicalizeRepositoryPath = (
    params: CanonicalRepositoryPathParams,
): CanonicalRepositoryPath => {
    const repositoryRoot =
        path.resolve(
            params.repositoryRoot,
        );

    const input =
        params.candidatePath;

    if (
        typeof input !== "string" ||
        input.trim().length === 0
    ) {
        throw new RepositoryPathPolicyError(
            "Il path repository-relative non può essere vuoto.",
            "EMPTY_PATH",
        );
    }

    const trimmedInput =
        input.trim();

    const isAbsoluteInput =
        path.isAbsolute(trimmedInput) ||
        path.win32.isAbsolute(trimmedInput);

    let absolutePath: string;

    if (isAbsoluteInput) {
        absolutePath =
            path.resolve(
                trimmedInput,
            );
    } else {
        const slashNormalizedInput =
            trimmedInput.replaceAll(
                "\\",
                "/",
            );

        const normalizedRelativePath =
            path.posix.normalize(
                slashNormalizedInput,
            );

        if (
            normalizedRelativePath.length === 0 ||
            normalizedRelativePath === "."
        ) {
            throw new RepositoryPathPolicyError(
                "Il path deve identificare una risorsa interna al repository.",
                "EMPTY_PATH",
            );
        }

        if (
            normalizedRelativePath === ".." ||
            normalizedRelativePath
                .startsWith("../")
        ) {
            throw new RepositoryPathPolicyError(
                `Il path esce dal repository: ${input}`,
                "PATH_ESCAPE",
            );
        }

        absolutePath =
            path.resolve(
                repositoryRoot,
                ...normalizedRelativePath
                    .split("/")
                    .filter(
                        (segment) =>
                            segment.length > 0,
                    ),
            );
    }

    assertLexicallyContained(
        repositoryRoot,
        absolutePath,
        input,
    );

    const repositoryRelative =
        path.relative(
            repositoryRoot,
            absolutePath,
        );

    const normalizedRelativePath =
        path.posix.normalize(
            repositoryRelative
                .replaceAll("\\", "/"),
        );

    if (
        normalizedRelativePath.length === 0 ||
        normalizedRelativePath === "." ||
        normalizedRelativePath === ".." ||
        normalizedRelativePath
            .startsWith("../")
    ) {
        throw new RepositoryPathPolicyError(
            `Il path non identifica un file interno al repository: ${input}`,
            "PATH_ESCAPE",
        );
    }

    const segments =
        normalizedRelativePath
            .split("/")
            .filter(
                (segment) =>
                    segment.length > 0,
            );

    if (
        segments.some(
            (segment) =>
                segment.toLowerCase() === ".git",
        )
    ) {
        throw new RepositoryPathPolicyError(
            `Il path non può accedere a .git: ${input}`,
            "GIT_PATH",
        );
    }

    const canonicalRelativePath =
        process.platform === "win32"
            ? normalizedRelativePath
                .toLowerCase()
            : normalizedRelativePath;

    return Object.freeze({
        relativePath:
            canonicalRelativePath,

        absolutePath,
    });
};

export const resolveRepositoryPath = async (
    params: ResolveRepositoryPathParams,
): Promise<ResolvedRepositoryPath> => {
    const repositoryRoot = path.resolve(params.repositoryRoot);

    const input = params.relativePath;

    if (typeof input !== "string" || input.trim().length === 0) {
        throw new RepositoryPathPolicyError(
            "Il path repository-relative non può essere vuoto.",
            "EMPTY_PATH",
        );
    }

    if (path.isAbsolute(input) || path.win32.isAbsolute(input)) {
        throw new RepositoryPathPolicyError(
            `Sono consentiti soltanto path relativi al repository: ${input}`,
            "ABSOLUTE_PATH",
        );
    }

    const slashNormalizedInput = input.replaceAll("\\", "/");

    const normalizedRelativePath = path.posix.normalize(slashNormalizedInput);

    if (normalizedRelativePath.length === 0) {
        throw new RepositoryPathPolicyError(
            "Il path deve identificare una risorsa interna al repository.",
            "EMPTY_PATH",
        );
    }

    if (normalizedRelativePath === ".") {
        if (params.allowRepositoryRoot !== true) {
            throw new RepositoryPathPolicyError(
                "Il path deve identificare una risorsa interna al repository.",
                "EMPTY_PATH",
            );
        }
        await resolveExistingRealPath(repositoryRoot, false);

        return Object.freeze({
            relativePath: ".",

            absolutePath: repositoryRoot,
        });
    }

    if (
        normalizedRelativePath === ".." ||
        normalizedRelativePath.startsWith("../")
    ) {
        throw new RepositoryPathPolicyError(
            `Il path esce dal repository: ${input}`,
            "PATH_ESCAPE",
        );
    }

    const segments = normalizedRelativePath
        .split("/")
        .filter((segment) => segment.length > 0);

    if (segments.some((segment) => segment.toLowerCase() === ".git")) {
        throw new RepositoryPathPolicyError(
            `Il path non può accedere a .git: ${input}`,
            "GIT_PATH",
        );
    }

    const absolutePath = path.resolve(repositoryRoot, ...segments);

    assertLexicallyContained(repositoryRoot, absolutePath, input);

    const realRepositoryRoot = await resolveExistingRealPath(
        repositoryRoot,
        false,
    );

    if (params.allowMissing === true) {
        const existingAncestor = await findNearestExistingAncestor(
            absolutePath,
            repositoryRoot,
        );

        const realExistingAncestor = await fs.realpath(existingAncestor);

        assertReallyContained(realRepositoryRoot, realExistingAncestor, input);
    } else {
        let realRequestedPath: string;

        try {
            realRequestedPath = await fs.realpath(absolutePath);
        } catch (error: unknown) {
            const fileError = error as NodeJS.ErrnoException;

            if (fileError.code === "ENOENT" || fileError.code === "ENOTDIR") {
                throw new RepositoryPathPolicyError(
                    `Il path non esiste nel repository: ${normalizedRelativePath}`,
                    "PATH_NOT_FOUND",
                );
            }

            throw error;
        }

        assertReallyContained(realRepositoryRoot, realRequestedPath, input);
    }

    return Object.freeze({
        relativePath: normalizedRelativePath,

        absolutePath,
    });
};

const assertLexicallyContained = (
    repositoryRoot: string,
    candidatePath: string,
    originalInput: string,
): void => {
    const relative = path.relative(repositoryRoot, candidatePath);

    const outsideRepository =
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative);

    if (outsideRepository) {
        throw new RepositoryPathPolicyError(
            `Il path esce dal repository: ${originalInput}`,
            "PATH_ESCAPE",
        );
    }
};

const assertReallyContained = (
    realRepositoryRoot: string,
    realCandidatePath: string,
    originalInput: string,
): void => {
    const relative = path.relative(realRepositoryRoot, realCandidatePath);

    const outsideRepository =
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative);

    if (outsideRepository) {
        throw new RepositoryPathPolicyError(
            `Il path risolve fuori dal repository: ${originalInput}`,
            "REAL_PATH_ESCAPE",
        );
    }
};

const resolveExistingRealPath = async (
    candidatePath: string,
    allowMissing: boolean,
): Promise<string> => {
    try {
        return await fs.realpath(candidatePath);
    } catch (error: unknown) {
        const fileError = error as NodeJS.ErrnoException;

        if (
            allowMissing &&
            (fileError.code === "ENOENT" || fileError.code === "ENOTDIR")
        ) {
            return candidatePath;
        }

        if (fileError.code === "ENOENT" || fileError.code === "ENOTDIR") {
            throw new RepositoryPathPolicyError(
                `La repository root non esiste: ${candidatePath}`,
                "PATH_NOT_FOUND",
            );
        }

        throw error;
    }
};

const findNearestExistingAncestor = async (
    candidatePath: string,
    repositoryRoot: string,
): Promise<string> => {
    let current = candidatePath;

    while (true) {
        try {
            await fs.lstat(current);

            return current;
        } catch (error: unknown) {
            const fileError = error as NodeJS.ErrnoException;

            if (fileError.code !== "ENOENT" && fileError.code !== "ENOTDIR") {
                throw error;
            }
        }

        if (current === repositoryRoot) {
            return repositoryRoot;
        }

        const parent = path.dirname(current);

        if (parent === current) {
            throw new RepositoryPathPolicyError(
                `Impossibile determinare un ancestor confinato per: ${candidatePath}`,
                "PATH_ESCAPE",
            );
        }

        assertLexicallyContained(repositoryRoot, parent, candidatePath);

        current = parent;
    }
};
