interface IconProps {
  readonly className?: string;
}

export function ChevronIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>;
}

export function InspectorIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><path d="M3 2.75h10v10.5H3zM5.5 5.5h5M5.5 8h5M5.5 10.5h3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" /></svg>;
}

export function GalleryIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><circle cx="4" cy="5" r="1.25" fill="none" stroke="currentColor" strokeWidth="1.25" /><path d="M1 14.75h14v-10H1zm0-10v-2.5h14v10" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" /></svg>;
}

export function CameraIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><circle cx="8" cy="9.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.25" /><path d="M1.75 4.5h3L6.5 2h3l1.75 2.5h3v9.5h-12z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" /></svg>;
}

export function DocumentIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><path d="M3 2h7l3 3v9H3z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" /><path d="M10 2v3h3M5 8h6M5 10.5h6M5 13h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" /></svg>;
}

export function QRIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><rect x="1.5" y="1.5" width="4" height="4" fill="none" stroke="currentColor" strokeWidth="1.25" /><rect x="10.5" y="1.5" width="4" height="4" fill="none" stroke="currentColor" strokeWidth="1.25" /><rect x="1.5" y="10.5" width="4" height="4" fill="none" stroke="currentColor" strokeWidth="1.25" /><path d="M8.5 5.5h6M8.5 8h6M8.5 10.5h6M10.5 13h4M8.5 13h1.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" /></svg>;
}

export function HamburgerIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false" {...props}><path d="M3 6h18M3 12h18M3 18h18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

export function CloseIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false" {...props}><path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.25, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function FolderIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><path d="M1.5 3.5h4.5l1.5 1.5h7v8h-13z" {...STROKE} /></svg>;
}

export function MachineIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><rect x="2" y="4" width="12" height="8" rx="1" {...STROKE} /><path d="M5 12v2M11 12v2M2 8h12" {...STROKE} /></svg>;
}

export function ChatIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><path d="M2 3h12v8H6l-3 3v-3H2z" {...STROKE} /></svg>;
}

export function RunIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><circle cx="8" cy="8" r="6" {...STROKE} /><path d="m6.5 5.5 4 2.5-4 2.5z" fill="currentColor" stroke="none" /></svg>;
}

export function FindingIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><path d="M8 2.5 14 13H2z" {...STROKE} /><path d="M8 6.5v3M8 11.5v.5" {...STROKE} /></svg>;
}

export function SearchIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><circle cx="7" cy="7" r="4.5" {...STROKE} /><path d="m10.5 10.5 3.5 3.5" {...STROKE} /></svg>;
}

export function ComposeIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><path d="M3 13h10M3 10.5 10.5 3l2.5 2.5L5.5 13H3z" {...STROKE} /></svg>;
}

export function ClockIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><circle cx="8" cy="8" r="6" {...STROKE} /><path d="M8 4.5V8l2.5 1.5" {...STROKE} /></svg>;
}
