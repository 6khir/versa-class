# Versa Class Veo 3 Preview — what the app sends

The gem's instructions are maintained by hand in the Gemini console. This file is not
something to paste; it records the contract the app holds up on its side, so a change
here does not silently break the gem there.

## What the app uploads

**Interior page images. Five to eight of them. Nothing else.**

- No compiled `.docx` — Gemini's video model cannot read a Word document. Given one it
  has nothing to animate and sits in analysis until the step times out.
- No watermark image — it lives in the gem's knowledge base.
- No cover, no thank-you page, no mockups, no PDF.

This is the one marketing stage that does **not** upload the document. Mockups, listing
copy all read the compiled `.docx`; the video gem needs frames. Two different
engines, fed differently on purpose.

### Which pages

`selectPreviewFramePaths` in [`src/file-manager.cjs`](../src/file-manager.cjs):

1. Drop the **first** page (cover) and the **last** page (thank-you). Both are generated
   as stock images rather than product content, so a preview built from them advertises
   the packaging instead of the pack — and the cover already has four mockups of its own.
2. Sample what remains evenly, first interior page to last, so the preview shows the
   shape of the whole book rather than a run of consecutive pages.
3. Target 6, clamped to the 5–8 band. A book with fewer interior pages than that sends
   every one it has.

| Book | Frames | Pages sent |
|---|---|---|
| 200 pages | 6 | 2, 41, 81, 120, 160, 199 |
| 24 pages | 6 | 2, 6, 10, 15, 19, 23 |
| 8 pages | 6 | 2, 3, 4, 5, 6, 7 |
| 5 pages | 3 | 2, 3, 4 |
| 2 pages | 0 | fails with `PREVIEW_FRAMES_MISSING` |

A book that is only a cover and a thank-you page has no interior to preview. Failing the
step is correct there — better than a preview video of the packaging.

The stage still waits on `ensureMarketingGroundTruth` before it runs. The document is not
uploaded, but compiling it is the completeness gate every marketing stage shares: a book
whose pages are not all finished has no representative middle pages to show.

## What the app says

Exactly this, every run, first attempt and retry alike:

```
generate a preview video for this tpt product, best seller preview
```

`buildTptPreviewVideoPrompt()` takes no arguments, so nothing — title, page count,
description, attachment count — can be interpolated into it. One source, one call site,
both enforced by tests.

## Why it is this short

Three things were removed, each after it broke a run:

- **The watermark, named in the prompt.** Asking the model to place an image onto a
  video reads as compositing media; Gemini began generating and then refused on video
  policy grounds. The watermark now lives only in the gem's knowledge base.
- **The watermark, attached as a file.** The gem treats every upload as product, so the
  tile could be animated as if it were a page.
- **Everything descriptive** — product name, duration, aspect ratio, audience, "do not
  invent content". The gem reasoned about all of it instead of generating, which is what
  left the step sitting in analysis until it timed out.

## The one thing to keep watching in the gem

Its scope rule. If the gem's default is one clip per uploaded image, six frames will ask
for six clips. The listing preview is **one** video that moves through the pages.
