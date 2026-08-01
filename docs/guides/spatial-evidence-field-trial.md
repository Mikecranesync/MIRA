# Garage Conveyor Spatial-Evidence Field Trial

Use this guide to collect a small, clean photo set for the Garage Conveyor
trial. The public product entry point is
`https://app.factorylm.com/hub`.

**Current product reality:** the mobile application does not currently expose
a Visual Workspace or Field Capture tab. The internal `mira-hub` service has a
`/visual` implementation, but it is not a supported public mobile workflow.
Do not try to use an undocumented `/visual` URL to run this trial.

The mapper PR adds the required supported Field Capture entry. Before that PR
is merged and deployed, today's useful work is collecting authorized original
photos on the phone in one local album; the app cannot yet create this field
session from mobile.

## Before you start

1. Confirm you are authorized to photograph and upload the Garage Conveyor
   area, facility maps, panels, labels, and components.
2. Keep the original images on the authorized phone until the public Field
   Capture entry is available. Do not move facility images into a personal
   cloud, consumer AI tool, or shared chat.
3. Do not use this activity to decide whether equipment is safe, energized, or
   ready to operate. Follow your site procedures and work authorization.
4. Leave phone location and camera metadata enabled if site policy permits it.
   Do not use a “strip location” export; upload the original image files.
5. This first trial is still photos only. Do not upload body-camera video to
   the current Visual Workspace.

## Create one capture set today

1. On the authorized phone, create a local album named `Garage Conveyor Field
   Trial` followed by today's date.
2. Keep every permitted trial photo in this one album and retain the original
   files with their camera metadata.
3. Do not upload the album through an unsupported application route. The
   supported Field Capture entry will create the corresponding MIRA session
   after the mapper PR is deployed.

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

## Upload and mark evidence after Field Capture deploys

1. On the phone, open `https://app.factorylm.com/hub` and select **Field
   Capture**.
2. Start one Garage Conveyor session and upload the original photos from the
   local album in capture order: facility map first, then entry point, asset
   anchor, wide context, panels, and close-ups.
3. Add factual labels only where the public Field Capture interface presents a
   label or region control. Use labels such as `Garage Conveyor asset tag`,
   `Panel A label`, or `Map: Garage Conveyor area`. Do not label a component
   with an identity you cannot read or verify.
4. If a label or region control is not present in the deployed interface, leave
   the image unlabelled. The mapper must return `unknown` instead of relying on
   a made-up annotation.

## What to expect today

Before deployment, success is a complete local album of authorized original
photos in the specified capture order. The public mobile app cannot yet create
or display a VisualSession for this workflow.

After the mapper PR is merged and deployed, upload the album through Field
Capture. It will either create reviewable candidate links to known Garage
Conveyor assets/components or leave evidence unassigned with an explicit
`unknown` result. It will not create new assets and will not silently mark a
link correct.

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

- the public Field Capture session does not load or upload fails;
- the facility map or image contains material you are not authorized to retain;
- an image lacks a readable anchor and cannot be honestly labeled; or
- a candidate later points at the wrong asset or component.

The correct result for insufficient evidence is `unknown`, not a confident
guess.
