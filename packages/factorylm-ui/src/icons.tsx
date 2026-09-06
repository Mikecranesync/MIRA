interface IconProps {
  readonly className?: string;
}

export function ChevronIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>;
}

export function InspectorIcon(props: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" {...props}><path d="M3 2.75h10v10.5H3zM5.5 5.5h5M5.5 8h5M5.5 10.5h3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" /></svg>;
}
