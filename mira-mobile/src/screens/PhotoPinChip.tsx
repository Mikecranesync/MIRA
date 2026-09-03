// The VISIBLE half of pointing at a photograph.
//
// A tap in the Sources sheet pins one attached photograph to the next
// question; this bar is what stops that from being a hidden action. It sits
// directly above the composer on BOTH conversation surfaces, so the technician
// can see — and undo — what the next question is pointed at before sending it.
//
// COPY DISCIPLINE. It says the question is ABOUT this photograph. It does not
// say the photograph will be re-read, because that depends on a server flag
// (NOTEBOOK_PHOTO_REREAD_ENABLED) the client cannot see: with the flag off the
// pointer is simply ignored and the turn answers from the stored extraction as
// it always did. "About this photo" is true either way; "MIRA will read it"
// would be a promise the client is in no position to make.
import { SourceThumb } from "./FilePreview";
import type { PhotoPin } from "../api/resources";

export function PhotoPinChip({ pin, onClear }: { pin: PhotoPin; onClear: () => void }) {
  return (
    <div className="photo-pin" data-testid="photo-pin">
      {pin.fileId ? <SourceThumb fileId={pin.fileId} /> : <span aria-hidden>🖼</span>}
      <span className="photo-pin-label">
        Next question is about {pin.filename ?? "this photo"}
      </span>
      <button
        type="button"
        className="photo-pin-clear"
        aria-label="Don't ask about this photo"
        title="Don't ask about this photo"
        onClick={onClear}
      >
        ×
      </button>
    </div>
  );
}
