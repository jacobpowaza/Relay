import { access } from "node:fs/promises";

await Promise.all([
  access(new URL("../src/main.cjs", import.meta.url)),
  access(new URL("../src/preload.cjs", import.meta.url)),
]);
