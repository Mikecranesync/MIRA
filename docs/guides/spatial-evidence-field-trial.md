# Garage Conveyor Spatial-Evidence Field Trial

Use this guide to collect a small, clean photo set today. It uses the existing
MIRA Hub Visual Workspace. The background mapper is not live until its PR has
merged and been deployed; today proves that the evidence set is useful and
gives the mapper a safe backfill target.

## Before you start

1. Confirm you are authorized to photograph and upload the Garage Conveyor
   area, facility maps, panels, labels, and components.
2. Use only MIRA Hub. Do not move facility images into a personal cloud,
   consumer AI tool, or shared chat.
3. Do not use this activity to decide whether equipment is safe, energized, or
   ready to operate. Follow your site procedures and work authorization.
4. Leave phone location and camera metadata enabled if site policy permits it.
   Do not use a “strip location” export; upload the original image files.
5. This first trial is still photos only. Do not upload body-camera video to
   the current Visual Workspace.

## Create one session

1. On your phone or desktop browser, sign in to the existing MIRA Hub.
2. Open **Visual Workspace** at `/visual`.
3. Select **New session**.
4. Keep every Garage Conveyor image in this one session. The current interface
   creates a generic title; that is expected for this field trial.

## Capture in this order

Move normally through the permitted area. Take clear, still photos; do not
change any equipment position to improve a shot.

1. **Facility-map reference.** Photograph the full permitted garage/facility
   map. Take a second close photo of the relevant legend or Garage Conveyor
   area if the full map text is too small to read.
2. **Route start.** Photograph the entrance, room marker, or approved area
   identifier that establishes where this session begins.
3. **Asset anchor.** Photograph the Garage Conveyor’s asset tag, nameplate, or
   other visible identifier before photographing details.
4. **Wide context.** Take an overview photo that shows the conveyor and its
   nearby fixed landmarks.
5. **Panels and components.** Work from wide to close: panel exterior, panel
   identifier, component group, then each readable nameplate or terminal area.
6. **Reference prints.** Photograph any authorized print, panel label, or
   drawing that relates to the conveyor. Keep its page or sheet identifier in
   the frame when possible.

For each subject, take overlapping wide and close shots. Avoid motion blur,
glare, and people’s faces, badges, or unrelated screens. If a label is not
readable, take a second closer, straight-on photo instead of assuming the text.

## Upload and mark evidence

1. In the Visual Session, use the upload control to add each original photo.
   The current workspace accepts PNG, JPEG, and WebP images one at a time.
2. Keep upload order aligned with capture order: facility map first, then entry
   point, asset anchor, wide context, panels, and close-ups.
3. Select an uploaded image and draw a point or box around a readable asset tag,
   map label, panel label, or component identifier.
4. Give each region a short factual label such as `Garage Conveyor asset tag`,
   `Panel A label`, or `Map: Garage Conveyor area`. Do not label a component
   with an identity you cannot read or verify.
5. Repeat for the facility-map label and the asset identifier. These are the
   strongest review anchors for the first mapper pass.

## What to expect today

Today’s success is a complete VisualSession containing original photos and
your careful region labels. The current upload route preserves original image
bytes but does not yet display phone GPS or capture time in the workspace.

After the mapper PR is merged and deployed, an authorized backfill run will
process this same session. It will either create reviewable candidate links to
known Garage Conveyor assets/components or leave evidence unassigned with an
explicit `unknown` result. It will not create new assets and will not silently
mark a link correct.

## Review after deployment

1. Open the Hub **Proposals** queue.
2. Open each `Visual location link` candidate and inspect its source image,
   marked region, target asset/component, confidence, and matching reason.
3. Choose **accept** only when the target is correct. Choose **reject** when it
   is wrong. Choose **correct** when the correct existing target is available.
4. Treat every early review decision as calibration data. The mapper remains
   candidate-only while it learns how your facility is actually organized.

## Stop conditions

Stop and report the issue instead of working around it if:

- the Hub session does not load or upload fails;
- the facility map or image contains material you are not authorized to retain;
- an image lacks a readable anchor and cannot be honestly labeled; or
- a candidate later points at the wrong asset or component.

The correct result for insufficient evidence is `unknown`, not a confident
guess.
