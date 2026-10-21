/** 拼 className：falsy 项自动跳过。 */
export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}
