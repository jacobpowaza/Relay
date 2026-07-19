export interface RedactionResult {
  redacted: string;
  findings: Array<{ kind: string; index: number }>;
}

const secretPatterns: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "openai_api_key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { kind: "anthropic_api_key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { kind: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { kind: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { kind: "env_assignment", pattern: /^\s*(?:[A-Z0-9_]*?(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*.+$/gim },
];

export function redactSecrets(input: string): RedactionResult {
  const findings: RedactionResult["findings"] = [];
  let redacted = input;

  for (const { kind, pattern } of secretPatterns) {
    redacted = redacted.replace(pattern, (match, offset: number) => {
      findings.push({ kind, index: offset });
      const label = kind.toUpperCase();
      return match.includes("\n") ? `[REDACTED_${label}_BLOCK]` : `[REDACTED_${label}]`;
    });
  }

  return { redacted, findings };
}

export function shouldIgnorePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized.endsWith("/.env") ||
    normalized.includes("/.env.") ||
    normalized.includes("/.ssh/") ||
    normalized.endsWith(".pem") ||
    normalized.endsWith(".key") ||
    normalized.endsWith("id_rsa") ||
    normalized.endsWith("id_ed25519")
  );
}
