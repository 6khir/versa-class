# VERSA — TRUE END-TO-END DESIRED PRODUCTION ARCHITECTURE
### Complete Technical Specification & Implementation Blueprint

---

## 1. ARCHITECTURAL FOUNDATION & CORE PRINCIPLE

```
┌──────────────────────────────────────────────────────────────────┐
│              AUTHORITATIVE MANUFACTURING ENGINE                  │
│  • Electron Main (`main.cjs`)  • SQLite Store (`store.db`)       │
│  • Provider Adapters (Gemini / ChatGPT / Meta AI)                │
│  • Deterministic Filesystem (`<outputDir>/...`)                  │
└────────────────────────────────┬─────────────────────────────────┘
                                 │ IPC (`queue:heartbeat`, `state`)
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                 PASSIVE PROJECTION LAYER (UI)                    │
│  • Renderer (`renderer.js`, `index.html`)                        │
│  • Unidirectional state flow: UI dispatches intent, engine owns  │
└──────────────────────────────────────────────────────────────────┘
```

1. **Engine Authority:** The UI is strictly a projection of state. The backend engine (`main.cjs`, SQLite `store`, and file system) owns the manufacturing pipeline. A UI reload or close must never alter or corrupt background execution.
2. **Durable Manufacturing Jobs:** Products and sub-tasks are tracked as durable records in SQLite.
3. **Artifact Verification Over Status Flags:** A step is **never** complete simply because a database flag says `completed`. The engine must run an explicit filesystem verification (`stat`, non-zero byte check, image/PDF integrity) before accepting any artifact. If a file is missing or corrupt on disk, the state automatically downgrades to `pending` and triggers a re-run.
4. **Idempotency & Zero Wasted Compute:** Every page, artwork, text layout, mockup, video, and export is an independent, deterministically named job. If Page 37 fails, Pages 1–36 are locked and preserved. Restarting the app resumes at Page 37.

---

## 2. SYSTEM INGESTION & PRODUCT CLASSIFICATION

Every project starts at **Concept Planning / Analyze**.

```
Input (TPT/Amazon URL, Topic, Niche, Grade, Details)
                     │
                     ▼
        [Concept Planning / URL Analyzer]
  • Extract competitor mockups & reference images
  • Extract pedagogical structure & content signals
  • Determine page count, orientation & target specs
                     │
                     ▼
          [Product Classification]
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
   NON-EDITABLE               EDITABLE
 (Static Pipeline)      (Component Pipeline)
```

### Classification Rules:
* **Non-Editable Products:** Storybooks, traditional coloring books, flattened printables, static PDF packs.
* **Editable Products:** Name tracing packs, customizable classroom forms, editable teacher templates, PowerPoint-first learning packs.
* **Hard Rule:** **The two pipelines are mutually exclusive.** The system must never execute a static interior phase and then attempt an editable phase on top of flattened pages.

---

## 3. PIPELINE A: NON-EDITABLE MANUFACTURING ENGINE

For static, print-and-go products, execution follows a strict linear sequence:

```
[1. CONCEPT] ➔ [2. INTERIOR] ➔ [3. MOCKUPS] ➔ [4. PREVIEW] ➔ [5. SEO] ➔ [6. EXPORT]
```

### Stage 1: Interior / Static Page Generation
* **Input:** Deterministic prompt batch generated during planning (`Page 001` to `Page N`), orientation, DPI specs, and provider adapter config.
* **Execution Loop:**
  ```text
  For Job (Page i):
    1. Check disk: Does <outputDir>/interior/page_i.png exist & pass verification?
       - YES: Mark job complete, emit progress, skip compute.
       - NO:  Proceed to generation.
    2. Dispatch prompt via Provider Adapter (ChatGPT/Gemini browser or API).
    3. Download/extract raw image asset.
    4. Validate PNG format, resolution, and dimensions.
    5. Save deterministically to <outputDir>/interior/page_i.png.
    6. SQLite Transaction: update job status = 'complete', record file hash.
    7. Emit IPC `queue:heartbeat` to update UI.
  ```
* **Failure Isolation:** An AI timeout or network disconnect on `Page i` initiates an isolated retry with exponential backoff (`retryDelayMs`). It does not touch completed pages.

### Stage 2: Non-Editable Document Derivation
* Once all static pages pass verification:
  1. **Print PDF:** `fileManager.ensureProductPdf()` compiles the validated PNGs into a 300 DPI print-ready PDF.
  2. **Canonical Document Representation:** The engine builds a lightweight, high-fidelity Google-Document-compatible reference package (PDF/HTML document) that downstream stages (Mockups, SEO) consume as their primary source of truth.

---

## 4. PIPELINE B: EDITABLE MANUFACTURING ENGINE

Editable products use a decoupled component architecture. Artwork and text are generated independently so text remains 100% native and editable in PowerPoint:

```
[1. CONCEPT] ➔ [2. INTERIOR ARTWORK] ➔ [3. INTERIOR TEXT] ➔ [4. FINAL EDITABLE PPTX] 
                     ➔ [5. MOCKUPS] ➔ [6. PREVIEW] ➔ [7. SEO] ➔ [8. EXPORT]
```

```
       ┌────────────────────────┐      ┌────────────────────────┐
       │  Stage 1: Artwork AI   │      │   Stage 2: Text AI     │
       │ (Generates clean PNG   │      │ (Generates layout JSON │
       │  with NO baked-in text)│      │  targeted to artwork)  │
       └───────────┬────────────┘      └───────────┬────────────┘
                   │                               │
                   │ Artwork 001.png               │ Text 001.json
                   └───────────────┬───────────────┘
                                   ▼
                   ┌───────────────────────────────┐
                   │  Stage 3: Final Editable      │
                   │  Engine (PPTX Assembly)       │
                   │  • Background = Artwork PNG   │
                   │  • Text = Native PPTX Shapes  │
                   └───────────────┬───────────────┘
                                   ▼
                   ┌───────────────────────────────┐
                   │  Stage 4: Document Reference  │
                   │  (Exports rendered PPTX to    │
                   │   canonical reference doc)    │
                   └───────────────┬───────────────┘
                                   ▼
                     Downstream Stages (Shared)
                   (Mockups ➔ Preview ➔ SEO ➔ Export)
```

### Stage 1: Interior Artwork Generation (Zero Text)
* **Contract:** The AI provider is prompted with explicit negative constraints:
  * Generate artwork background only.
  * Leave designated safe zones/empty areas for student/teacher interaction.
  * **Zero baked-in alphanumeric characters or text.**
* **Artifacts:** Saved to `<outputDir>/editable/<runId>/<pageId>/artwork.png`.
* **State Checkpoint:** Every artwork page is independently persisted and verified. Stage 2 cannot begin until 100% of artwork pages pass disk validation.

### Stage 2: Interior Text Generation
* **Contract:** Runs a specialized text-structuring Gem/model.
* **Input per Page:** The exact `artwork.png` from Stage 1 + the pedagogical prompt requirements for that specific page.
* **Output:** A strict JSON bounding-box contract:
  ```json
  {
    "elements": [
      {
        "type": "text_box",
        "text": "Trace Your Name:",
        "fontFamily": "Century Gothic",
        "fontSize": 28,
        "rect": { "x": 100, "y": 150, "w": 600, "h": 50 },
        "style": { "alignment": "center", "color": "#1F2937" }
      }
    ]
  }
  ```
* **Artifacts:** Saved to `<outputDir>/editable/<runId>/<pageId>/layout.json`.

### Stage 3: Final Editable Manufacturing Engine (`assembleEditableEnginePptx`)
* **Execution:** Only runs when `artwork.png` AND `layout.json` exist for every page.
* **Assembly:** 
  1. Initializes a raw PowerPoint document at target slide dimensions (Letter / A4 at 300 DPI equivalent).
  2. For each slide:
     * Sets `artwork.png` as the slide background or locked background picture shape.
     * Injects native editable PowerPoint text boxes matching the exact bounding boxes, font metrics, and alignment from `layout.json`.
  3. Writes the compiled file to `<outputDir>/editable/<runId>/final_editable.pptx`.
  4. Verifies PPTX file integrity and non-zero byte size on disk.

### Stage 4: Editable Document Reference Generation
* Converts the rendered PPTX slides into the canonical document/PDF reference package. This ensures the downstream Mockups and SEO engines see the **actual finished editable product**, not raw background templates.

---

## 5. SHARED DOWNSTREAM MANUFACTURING (STAGES 5–8)

From this point forward, both pipelines feed into the same downstream engines using their respective validated document references.

```
                  ┌──────────────────────┐
                  │ Product Document Ref │
                  └──────────┬───────────┘
                             │
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
     [MOCKUPS ENGINE]  [PREVIEW VIDEO]   [SEO ENGINE]
     (4 discrete jobs) (1 MP4 artifact) (Structured TXT)
            │                │                │
            └────────────────┼────────────────┘
                             ▼
                      [EXPORT ENGINE]
              (Verified, Clean Production ZIP)
```

### Stage 5: Mockups Engine (Not "Thumbnails")
* **Input:** The canonical product document reference.
* **Contract:** The AI receives the document reference and is instructed: *"Draft four winning mockup concepts specifically based on this product."*
* **Execution:** 4 discrete, independent jobs (`mockup-01` through `mockup-04`).
* **Storage:** Extracted and persisted as high-res PNGs inside `<outputDir>/mockups/`.
* **Resilience:** If Mockup 3 fails, Mockups 1, 2, and 4 remain untouched while Mockup 3 retries.

### Stage 6: Preview Video Engine
* **Input:** The product document reference and key visual assets.
* **Execution:** Dispatches to the Gemini video generation workflow (or ffmpeg Ken Burns video compositor).
* **Artifact:** Deterministically written to `<outputDir>/preview/preview_video.mp4`.
* **Validation:** Verified via filesystem probes (`stat`, video duration check).

### Stage 7: SEO Engine (Runs BEFORE Export)
* **Rule:** SEO must always execute before final packaging so the output package contains the SEO copy.
* **Input:** The canonical product document reference.
* **Output Contract:**
  1. Structured database fields: `Title`, `Description`, `Tags`, `Grades`, `Subjects`, `Formats`, `Price`, `Standards`.
  2. Human-readable, ready-to-copy text file saved to `<outputDir>/seo/listing_details.txt`.

### Stage 8: Export Engine (The Final Gatekeeper)
* **Execution:** Runs only when all prior stages satisfy their completion contracts.
* **Strict Packaging Whitelist:**
  * Print-ready PDF (`.pdf`)
  * Native Editable PowerPoint (`.pptx`, when applicable)
  * Canonical Document representation (`.docx` / reference)
  * 4 Finished Mockups (`mockup_01.png` – `mockup_04.png`)
  * Preview Video (`preview_video.mp4`)
  * SEO Listing Copy (`listing_details.txt`)
* **Strict Blacklist (Never Package):**
  * Intermediate working PNGs/JPEGs
  * Scraping/competitor references
  * Raw LLM prompts and conversation dumps
  * Electron/browser session and cache files
  * Internal SQLite journal files
* **Verification:** The export engine builds `<outputDir>/<Project_Name>_Deliverables.zip`, verifies the zip archive integrity, and commits the SQLite transaction (`SAVEPOINT editable_publish`).

---

## 6. SELF-HEALING, RECOVERY & PERSISTENCE SPECIFICATION

### The Verification Contract
Completion is defined mathematically as:
$$\text{Complete} = \text{SQLite State (`completed`)} \land \text{FS File Exists} \land (\text{File Size} > 0) \land \text{Hash Valid}$$

If any condition fails, the state transitions:
$$\text{Invalid Artifact} \implies \text{Status} \leftarrow \text{PENDING} \implies \text{Trigger Job Re-run}$$

### Crash & Restart Reconciliation Routine
When VERSA launches or recovers from a crash:
1. **Boot Scan:** Inspects SQLite `projects` and `jobs` tables.
2. **Filesystem Audit:** Iterates through every job declared as `complete` and verifies its artifact on disk.
3. **State Healing:**
   * Valid jobs on disk are locked as `complete`.
   * Partially generated, zero-byte, or missing artifacts are marked `pending`.
4. **Resumption:** The master queue automatically resumes execution from the **first incomplete job** without resetting the pipeline.

### Domain State Isolation
State updates to one domain (e.g., SEO) must never overwrite another domain (e.g., Mockups). All database mutations must use parameterized updates:
```sql
UPDATE projects 
SET seo_json = @seoJson, updated_at = CURRENT_TIMESTAMP 
WHERE id = @projectId;
```
Full-record JSON clobbering (`store.setProject(staleObject)`) is strictly forbidden.

---

## 7. PROVIDER ADAPTER SPECIFICATION

To keep the manufacturing engine decoupled from AI platforms, all models implement a common interface:

```typescript
interface AIProviderAdapter {
  name: 'gemini' | 'chatgpt' | 'meta';
  
  // Concept & Planning
  analyzeProduct(input: IngestionInput): Promise<ProductBlueprint>;
  
  // Image & Artwork Generation
  generateImage(prompt: string, options: ImageOptions): Promise<Buffer>;
  
  // Structured Text Layouts
  generateTextLayout(artworkBuffer: Buffer, brief: string): Promise<TextLayoutJSON>;
  
  // Marketing & Copy
  generateMockupPrompts(docRef: Buffer): Promise<[string, string, string, string]>;
  generateSeoCopy(docRef: Buffer): Promise<SeoContract>;
  
  // Lifecycle & Recovery
  checkHealth(): Promise<boolean>;
  recover(jobId: string): Promise<void>;
}
```

The core engines (`InteriorEngine`, `ArtworkEngine`, `PptxEngine`, `MockupEngine`) interact exclusively through this interface. Switching from ChatGPT to Gemini requires changing a config pointer—the manufacturing pipeline remains untouched.
