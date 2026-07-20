export interface RedactionResult {
    redacted: string;
    findings: Array<{
        kind: string;
        index: number;
    }>;
}
export declare function redactSecrets(input: string): RedactionResult;
export declare function shouldIgnorePath(path: string): boolean;
//# sourceMappingURL=redaction.d.ts.map