// The ONE approved fullscreen media viewer (Commodity PRD §7, Phase 3).
//
// Commodity-before-custom: gesture mechanics (pinch zoom, pan, double-tap,
// pull-down close, pointer bookkeeping, tap-slop) are delegated to
// yet-another-react-lightbox (MIT, React 16–19, zero transitive baggage) —
// evaluated per PRD §13 against PhotoSwipe v5 (would need hand-rolled React
// glue, i.e. more custom code, the thing this phase removes). The custom
// pointer-event engine this replaces cost a three-fix arc to make ONE button
// work (#3427 → #3429 slop/click-synthesis → #3439 status-bar safe area).
//
// What stays OURS — the two hard-won device contracts from the Phase-2
// acceptance (2026-08-27), ported as required behavior, not re-derived:
//   1. Safe area: with viewport-fit=cover the overlay draws edge-to-edge, and
//      anything in the top ~152px sits inside the status bar's INPUT frame —
//      Android consumes those taps before the WebView sees them. The toolbar
//      (which holds the ✕) gets env(safe-area-inset-top) padding.
//   2. Hardware BACK: the open viewer registers in the transient-layer stack
//      so BACK closes viewer → sheet → conversation, in that order.
//
// MIRA domain (what to show, where bytes come from — authenticated blob URLs
// via requestBinary) stays in FilePreview; this component owns only "view it
// fullscreen".

import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Captions from "yet-another-react-lightbox/plugins/captions";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/captions.css";
import { useTransientLayer } from "../lib/transient-layer";

export function MediaViewer({
  url,
  filename,
  onClose,
}: {
  /** blob: URL from useFileBytes — never a remote URL (ADR-0034 boundary). */
  url: string;
  filename: string;
  onClose: () => void;
}) {
  // BACK closes the viewer before anything beneath it (#3429's contract).
  useTransientLayer(onClose);

  return (
    <Lightbox
      open
      close={onClose}
      slides={[{ src: url, alt: filename, title: filename }]}
      plugins={[Zoom, Captions]}
      carousel={{ finite: true }}
      // One image, no deck: navigation arrows are noise on a phone.
      render={{ buttonPrev: () => null, buttonNext: () => null }}
      zoom={{
        maxZoomPixelRatio: 4,
        doubleTapDelay: 300,
        doubleClickMaxStops: 2,
        pinchZoomDistanceFactor: 100,
      }}
      controller={{ closeOnBackdropClick: true, closeOnPullDown: true }}
      styles={{
        // Contract 1 (see header): keep the ✕ out of the status-bar input frame.
        toolbar: { paddingTop: "calc(env(safe-area-inset-top, 0px) + 4px)" },
        // Same contract for the Captions title bar: it is absolutely positioned
        // at the top of the slide and otherwise draws under the status-bar
        // clock (Phase-4 cosmetic nit, 2026-08-29).
        captionsTitleContainer: {
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 4px)",
        },
        container: { backgroundColor: "rgba(0, 0, 0, 0.92)" },
      }}
    />
  );
}
