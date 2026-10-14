// テスト専用のダミー値（実運用のトークンではない）。ハッシュは vitest.config.ts で計算して Worker に渡す
export const ORIGIN_OK = "http://127.0.0.1:8790";
export const ORIGIN_PROD = "https://ysnagaeiku-byte.github.io";
const dummy = (seed: string) => (seed + "_".repeat(43)).slice(0, 43);
export const WRITE_TOKENS = {
  "vehicle-1": dummy("test-write-token-vehicle-1"),
  "vehicle-2": dummy("test-write-token-vehicle-2"),
  "vehicle-3": dummy("test-write-token-vehicle-3"),
} as const;
export const DEVICE_IDS = {
  "vehicle-1": "0123456", // 先頭ゼロを数値化しないことの確認用
  "vehicle-2": "test-device-2",
  "vehicle-3": "test-device-3",
} as const;
export const VIEW_TOKEN = dummy("test-view-token");
