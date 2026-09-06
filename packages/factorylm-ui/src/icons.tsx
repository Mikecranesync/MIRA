interface IconProps {
  readonly className?: string;
}

export function ChevronIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>;
}

export function InspectorIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><path d="M3 2.75h10v10.5H3zM5.5 5.5h5M5.5 8h5M5.5 10.5h3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" /></svg>;
}

export function HamburgerIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false" {...props}><path d="M3 6h18M3 12h18M3 18h18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

export function CloseIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false" {...props}><path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
