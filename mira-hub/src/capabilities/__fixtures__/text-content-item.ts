/** The one mapper from a captured layout item to a pdf.js text-content item, shared by every
 *  harness that feeds captured pages through `unpdf`. A captured item marked `vertical` was
 *  printed rotated (the GS10 "Output Rating" / "Input Rating" group stubs); without the rotated
 *  transform the reader cannot see it as a stub, so a harness that drops it tests a different page. */
export type CapturedItem = { str: string; x: number; y: number; w: number; size: number; vertical?: boolean };
export function textContentItem(i: CapturedItem): { str: string; width: number; transform: number[] } {
  return { str: i.str, width: i.w, transform: i.vertical ? [0, i.size, -i.size, 0, i.x, i.y] : [i.size, 0, 0, i.size, i.x, i.y] };
}
