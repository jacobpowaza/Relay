import type { AgentKind, SessionBootstrap } from "./protocol.js";
export interface BuildBootstrapOptions {
    agent: AgentKind;
    cwd?: string;
    configPath?: string;
    queuePath?: string;
}
export declare function buildSessionBootstrap(options: BuildBootstrapOptions): SessionBootstrap;
//# sourceMappingURL=bootstrap.d.ts.map