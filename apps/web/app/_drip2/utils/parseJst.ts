import { parseJstString } from "~/lib/datetime";

/**
 * SQLite の `datetime('now', '+9 hours')` で書き込まれた JST 文字列
 * (`YYYY-MM-DD HH:MM:SS`、Z なし) を UTC のミリ秒に変換する。
 *
 * fallback として createdAt が ISO 8601 (Z 付き or オフセット付き) で来るケースもサポートする。
 * 不正値・空文字・NaN を返すケースでは 0 を返してタイマー表示が NaN になるのを防ぐ。
 *
 * JST 形式のパースは既存の `app/lib/datetime.ts#parseJstString` に委譲する。
 */
export function parseJst(timestamp: string): number {
  if (!timestamp) return 0;
  // ISO 8601 (Z or オフセット付き) ならそのまま Date.parse
  if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(timestamp)) {
    const ms = Date.parse(timestamp);
    return Number.isNaN(ms) ? 0 : ms;
  }
  // それ以外は JST 形式と解釈（既存の parseJstString と挙動を揃える）
  const ms = parseJstString(timestamp).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}
