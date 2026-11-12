export interface SemgrepProfile {
    readonly id: string;
    readonly configs:
    readonly string[];
}

export const DEFAULT_SEMGREP_PROFILE:
    SemgrepProfile =
    Object.freeze({
        id:
            'semgrep-profile-v1',

        configs:
            Object.freeze([
                'auto',
                'p/owasp-top-ten',
                'p/security-audit',
                'p/cwe-top-25',
                'p/python'
            ])
    });
