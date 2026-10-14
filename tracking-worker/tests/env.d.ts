declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    DEVICE_AUTH_JSON: string;
    VIEW_TOKEN_SHA256: string;
    ALLOWED_ORIGINS: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
