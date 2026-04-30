/**
 * D1 に保存する現在時刻を JST 相当の "YYYY-MM-DD HH:MM:SS" 形式で返す。
 *
 * 注意: 返り値の文字列はタイムゾーン情報を持たない。内部的には UTC に +9h して
 * toISOString() した結果を切り出しているため、文字列としては JST の壁時計と
 * 一致するが、Date としてパースし直すと UTC 扱いになる点に留意すること。
 * DB に保存する側・読み出す側の双方で「この値は JST である」前提を共有すること。
 */
export function getJstNowString(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
}

/**
 * D1 に保存された JST 形式の "YYYY-MM-DD HH:MM:SS" 文字列を Date に変換する。
 *
 * `new Date("YYYY-MM-DD HH:MM:SS")` の解釈はブラウザ実装依存になるため、
 * 必ずタイムゾーン明示の ISO8601 形式 ("YYYY-MM-DDTHH:MM:SS+09:00") に整形してから渡す。
 */
export function parseJstString(value: string): Date {
  return new Date(value.replace(" ", "T") + "+09:00");
}
