import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";

export const defaultRendererPort = 4317;
export const defaultApiPort = 4318;
export const rendererHost = "127.0.0.1";
export const rendererUrl = rendererUrlForPort(defaultRendererPort);
export const apiUrl = apiUrlForPort(defaultApiPort);
const rendererTitle = "<title>Relay - Development that remembers</title>";

/**
 * @param {string | Buffer | null} filename
 * @returns {boolean}
 */
export function shouldRestartDesktop(filename) {
  if (filename === null) return false;
  return filename.toString().endsWith(".cjs");
}

/**
 * @param {number} port
 * @returns {string}
 */
export function rendererUrlForPort(port) {
  return `http://${rendererHost}:${port}`;
}

/**
 * @param {number} port
 * @returns {string}
 */
export function apiUrlForPort(port) {
  return `http://${rendererHost}:${port}`;
}

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, rendererHost);
  });
}

/**
 * @param {{
 *   serviceName: string;
 *   preferredPort?: number;
 *   attempts?: number;
 *   available?: (port: number) => Promise<boolean>;
 * }} options
 * @returns {Promise<number>}
 */
export async function findAvailablePort(options) {
  const serviceName = options.serviceName;
  const preferredPort = options.preferredPort ?? defaultRendererPort;
  const attempts = options.attempts ?? 20;
  const available = options.available ?? canListen;

  for (let offset = 0; offset < attempts; offset += 1) {
    const port = preferredPort + offset;
    if (await available(port)) return port;
  }

  throw new Error(
    `Relay could not find an available ${serviceName} port from ${preferredPort} to ${preferredPort + attempts - 1}.`,
  );
}

/**
 * @param {{
 *   preferredPort?: number;
 *   attempts?: number;
 *   available?: (port: number) => Promise<boolean>;
 * }} [options]
 * @returns {Promise<number>}
 */
export async function findAvailableRendererPort(options = {}) {
  return findAvailablePort({ serviceName: "renderer", ...options });
}

/**
 * @param {{
 *   preferredPort?: number;
 *   attempts?: number;
 *   available?: (port: number) => Promise<boolean>;
 * }} [options]
 * @returns {Promise<number>}
 */
export async function findAvailableApiPort(options = {}) {
  return findAvailablePort({
    serviceName: "API",
    preferredPort: defaultApiPort,
    ...options,
  });
}

/**
 * @param {{
 *   url?: string;
 *   attempts?: number;
 *   intervalMilliseconds?: number;
 *   pause?: (milliseconds: number) => Promise<void>;
 *   request?: typeof fetch;
 * }} [options]
 */
export async function waitForRenderer(options = {}) {
  const attempts = options.attempts ?? 60;
  const intervalMilliseconds = options.intervalMilliseconds ?? 250;
  const pause = options.pause ?? delay;
  const request = options.request ?? fetch;
  const url = options.url ?? rendererUrl;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await request(url);
      if (response.ok && (await response.text()).includes(rendererTitle)) return;
    } catch {
      // The renderer is still starting.
    }
    if (attempt + 1 < attempts) await pause(intervalMilliseconds);
  }

  throw new Error(`Relay renderer did not start at ${url} within 15 seconds.`);
}

/**
 * @param {{
 *   url?: string;
 *   attempts?: number;
 *   intervalMilliseconds?: number;
 *   pause?: (milliseconds: number) => Promise<void>;
 *   request?: typeof fetch;
 * }} [options]
 */
export async function waitForApi(options = {}) {
  const attempts = options.attempts ?? 60;
  const intervalMilliseconds = options.intervalMilliseconds ?? 250;
  const pause = options.pause ?? delay;
  const request = options.request ?? fetch;
  const url = options.url ?? apiUrl;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await request(`${url}/health`);
      const body = await response.json();
      if (response.ok && body.service === "relay-api") return;
    } catch {
      // The API is still starting or the port belongs to another service.
    }
    if (attempt + 1 < attempts) await pause(intervalMilliseconds);
  }

  throw new Error(`Relay API did not start at ${url} within 15 seconds.`);
}
