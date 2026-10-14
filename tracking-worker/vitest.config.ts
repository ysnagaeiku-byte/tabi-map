import { createHash } from "node:crypto";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { DEVICE_IDS, ORIGIN_OK, ORIGIN_PROD, VIEW_TOKEN, WRITE_TOKENS } from "./tests/fixtures.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  const auth = Object.fromEntries(
    Object.entries(WRITE_TOKENS).map(([v, t]) => [v, { deviceId: DEVICE_IDS[v as keyof typeof DEVICE_IDS], tokenSha256: sha(t) }]),
  );
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            DEVICE_AUTH_JSON: JSON.stringify(auth),
            VIEW_TOKEN_SHA256: sha(VIEW_TOKEN),
            ALLOWED_ORIGINS: [ORIGIN_PROD, ORIGIN_OK].join(","),
          },
        },
      }),
    ],
    test: { setupFiles: ["./tests/apply-migrations.ts"] },
  };
});
