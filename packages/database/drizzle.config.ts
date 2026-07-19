import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  out: "./migrations",
  schema: "./src/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://relay:relay@localhost:5432/relay",
  },
  strict: true,
});
