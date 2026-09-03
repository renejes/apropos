/**
 * Seite (1-basiert) zu einem Zeichenoffset in einem Dokument mit page_starts.
 * page_starts[i] = Offset des ersten Zeichens von Seite i+1.
 */
export function pageForOffset(starts: number[] | null | undefined, offset: number): number | null {
  if (!starts || starts.length === 0) return null
  let page = 0
  for (let i = 0; i < starts.length; i++) {
    if (starts[i]! <= offset) page = i
    else break
  }
  return page + 1
}
