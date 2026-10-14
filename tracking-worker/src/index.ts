// 本祭支援ツール：車両の位置の受信API（Cloudflare Workers + D1）の入口。処理は app.ts
// （Workers の入口ファイルは既定の書き出し以外を出さない。定数などを書き出すと実行環境が起動しない）
import { handle, json, logResult, type Env } from "./app";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await handle(req, env, Date.now());
    } catch {
      // 例外の内容（URL等を含みうる）はログに出さない
      logResult("any", "internal_error");
      return json(500, { error: "internal_error" });
    }
  },
} satisfies ExportedHandler<Env>;
