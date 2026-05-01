/**
 * SQLite の `datetime('now', '+9 hours')` で書き込まれた JST 文字列
 * (`YYYY-MM-DD HH:MM:SS`、Z なし) を UTC のミリ秒に変換する。
 *
 * `new Date("2026-04-18 12:00:00")` の解釈はブラウザ依存だが、
 * ここで `+09:00` を明示することで端末タイムゾーンに依存せず JST として解釈する。
 *
 * fallback として createdAt が ISO 8601 (Z 付き) で来るケースもサポートする。
 */
export function parseJst(timestamp: string): number {
  // ISO 8601 (Z 付き or オフセット付き) ならそのまま Date コンストラクタへ
  if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(timestamp)) {
    return Date.parse(timestamp);
  }
  // SQLite の "YYYY-MM-DD HH:MM:SS" 形式は JST として解釈
  const isoLike = timestamp.replace(" ", "T");
  return Date.parse(`${isoLike}+09:00`);
}
