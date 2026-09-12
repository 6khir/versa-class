# VERSA CLASS — Configured AI Links & Pipeline Routing Reference

---

## 1. Complete Inventory of Configured AI Links

### Google Gemini Custom Gems
| Name in Engine | Exact Target URL | Gem ID | Mode / Params |
| :--- | :--- | :--- | :--- |
| **Content Planning Gem** | `https://gemini.google.com/gem/a825fb54b4cf` | `a825fb54b4cf` | Standard Text Mode |
| **Editable Pages Gem** *(New)* | `https://gemini.google.com/gem/1qNgkNbAK7oO23hV9b8CyO5iN7_l6EMdc?usp=sharing` | `1qNgkNbAK7oO23hV9b8CyO5iN7_l6EMdc` | Direct Share Link |
| **Mockups Gem** | `https://gemini.google.com/gem/6d30d7350cbc?mode=image_creator` | `6d30d7350cbc` | `mode=image_creator` (Pre-armed for Imagen) |
| **SEO / Listing Gem** *(Updated)* | `https://gemini.google.com/gem/1jnpd8-MCWS8VhcatZ8yQoX3uXlbr9orG?usp=sharing` | `1jnpd8-MCWS8VhcatZ8yQoX3uXlbr9orG` | Direct Share Link |
| **Veo 3 Preview Video Gem** *(Updated)* | `https://gemini.google.com/gem/1P0s70mcBrh1YRrSEf2lZdKtv5lf2phw4?usp=sharing` | `1P0s70mcBrh1YRrSEf2lZdKtv5lf2phw4` | Direct Share Link |

*Retired / Deprecated Gem IDs (Blacklisted from active navigation):*
* `be5ff5bc0446`, `d8064e71d731`, `863ed43ea7fa`, `27dd6b9dc38a`, `03e82ade1eb7` (former Preview Gem), `b44e0aed9a86` (former SEO Gem).

---

### OpenAI ChatGPT Custom GPTs
| Name in Engine | Exact Target URL | Custom GPT ID |
| :--- | :--- | :--- |
| **VERSA CLASS Gems Custom GPT** *(Static)* | `https://chatgpt.com/g/g-6a7edaa37a388191b56980c770c7a1ef-versa-tpt-book-creation` | `g-6a7edaa37a388191b56980c770c7a1ef` |
| **TPT Book Pages Creation Pro (Editable)** *(New)* | `https://chatgpt.com/g/g-6a9e3e35ba5481919932c6bb70f984fd-tpt-book-pages-creation-pro-editable` | `g-6a9e3e35ba5481919932c6bb70f984fd` |
| **TPT Winner Mockups Custom GPT** | `https://chatgpt.com/g/g-6a6f85e57f8c8191b0c05fcdad501783-tpt-winner-mockups-by-versa-class` | `g-6a6f85e57f8c8191b0c05fcdad501783` |
| **TPT Title SEO Friendly Custom GPT** | `https://chatgpt.com/g/g-678147a6a908819191c940b4dba2c6ec-tpt-title-seo-friendly` | `g-678147a6a908819191c940b4dba2c6ec` |

---

### Meta AI Endpoints
| Name in Engine | Target Endpoint | Description |
| :--- | :--- | :--- |
| **Meta AI Web (Cloud)** | `https://www.meta.ai/` | Web browser automation for image generation |
| **Meta Local Protocol** | `meta://local` | Internal local controller / profile runner |

---

## 2. Pipeline Division: Static Window vs. Editable Window

The manufacturing engine enforces strict, mutually exclusive routing. There are **zero ambiguous fallbacks or multi-choice alternatives** in runtime routing.

```
                    CONCEPT PLANNING
                           │
                  PRODUCT CLASSIFICATION
                    ┌──────┴──────┐
                    │             │
              NON-EDITABLE     EDITABLE
                    │             │
                    ▼             ▼
             STATIC ENGINE    EDITABLE ENGINE
```

---

### A. THE STATIC WINDOW (Non-Editable Pipeline)
**Workflow:** `Concept Planning ➔ Static Interior ➔ Derived Doc (PDF/Docx) ➔ Mockups ➔ Preview Video ➔ SEO ➔ Export`

1. **Concept Planning / Analyze:**
   * **Target:** Content Planning Gem (`https://gemini.google.com/gem/a825fb54b4cf`)
   * **Role:** Analyzes scraped URL or user topic to generate the product blueprint and deterministic page-by-page prompts (`Page 001` to `Page N`).

2. **Interior Static Generation (Flattened Pages):**
   * *If Engine = Gemini:* Content Pages Gem (`https://gemini.google.com/gem/a825fb54b4cf`)
   * *If Engine = ChatGPT:* VERSA CLASS Gems Custom GPT (`https://chatgpt.com/g/g-6a7edaa37a388191b56980c770c7a1ef-versa-tpt-book-creation`)
   * *If Engine = Meta AI:* Meta AI (`https://www.meta.ai/`)
   * **Role:** Generates full, flattened page illustrations with baked-in text.

3. **Document Derivation (Local Engine):**
   * **Role:** Assembles validated PNGs into a 300 DPI Print PDF and lightweight canonical document reference.

4. **Marketing Mockups (4 Discrete Jobs):**
   * *If Engine = Gemini:* Mockups Gem (`https://gemini.google.com/gem/6d30d7350cbc?mode=image_creator`)
   * *If Engine = ChatGPT:* TPT Winner Mockups Custom GPT (`https://chatgpt.com/g/g-6a6f85e57f8c8191b0c05fcdad501783-tpt-winner-mockups-by-versa-class`)
   * *If Engine = Meta AI:* Meta AI (`https://www.meta.ai/`)
   * **Role:** Generates 4 separate high-converting product showcase mockups based on the product reference document.

5. **Preview Video (Universal Engine):**
   * **Target:** Veo 3 Preview Video Gem (`https://gemini.google.com/gem/1P0s70mcBrh1YRrSEf2lZdKtv5lf2phw4?usp=sharing`)
   * **Role:** Universal video generator across all engine configurations.

6. **SEO & Listing Copy (Before Export):**
   * *If Engine = Gemini / Meta:* SEO / Listing Gem (`https://gemini.google.com/gem/1jnpd8-MCWS8VhcatZ8yQoX3uXlbr9orG?usp=sharing`)
   * *If Engine = ChatGPT:* TPT Title SEO Friendly Custom GPT (`https://chatgpt.com/g/g-678147a6a908819191c940b4dba2c6ec-tpt-title-seo-friendly`)
   * **Role:** Generates structured metadata, keyword tags, category taxonomies, and the `listing_details.txt` artifact.

7. **Export Packaging (Final Gatekeeper):**
   * **Role:** Verifies and bundles only final production deliverables (`.pdf`, `.pptx`, `.docx`, `.mp4`, `.txt`, mockups).

---

### B. THE EDITABLE WINDOW (Editable Pipeline)
**Workflow:** `Concept Planning ➔ Interior Artwork (No Text) ➔ Interior Text (Layout JSON) ➔ Final PPTX Assembly ➔ Mockups ➔ Preview Video ➔ SEO ➔ Export`

1. **Concept Planning & Page Contract:**
   * **Target:** Content Planning Gem (`https://gemini.google.com/gem/a825fb54b4cf`)
   * **Role:** Generates the structured layout contract and prompts for editable pages.

2. **Stage 1 — Interior Artwork Generation (Background Only, Zero Text):**
   * *If Engine = Gemini:* Direct to **Editable Pages Gem** (`https://gemini.google.com/gem/1qNgkNbAK7oO23hV9b8CyO5iN7_l6EMdc?usp=sharing`)
   * *If Engine = ChatGPT:* Direct to **TPT Book Pages Creation Pro (Editable)** (`https://chatgpt.com/g/g-6a9e3e35ba5481919932c6bb70f984fd-tpt-book-pages-creation-pro-editable`)
   * **Role:** Generates clean background artwork leaving designated negative space and safe margins. Validated via Apple Vision OCR (`detect-artwork-text.swift`) to ensure no text is baked into the image.

3. **Stage 2 — Interior Text Generation (Bounding Box Layout):**
   * **Target:** Content Planning Gem (`https://gemini.google.com/gem/a825fb54b4cf`)
   * **Role:** Ingests the Stage 1 `artwork.png` as an image reference and outputs the exact JSON coordinates (`x, y, w, h`, text, font, font size) for where editable text boxes must sit on that specific artwork.

4. **Stage 3 — Final Editable Assembly (Native PPTX Engine):**
   * **Target:** Local Node.js Compositor (`assembleEditableEnginePptx`)
   * **Role:** Mathematically layers the Stage 1 background artwork with Stage 2 native PowerPoint text boxes into an editable `.pptx` file.

5. **Downstream Marketing Stages (Using the Rendered PPTX Document Reference):**
   * **Mockups:** Mockups Gem (`6d30d7350cbc`) or TPT Winner Mockups Custom GPT (`g-6a6f85e57f8c8191b0c05fcdad501783`)
   * **Preview Video:** Veo 3 Preview Video Gem (`1P0s70mcBrh1YRrSEf2lZdKtv5lf2phw4`)
   * **SEO:** SEO / Listing Gem (`1jnpd8-MCWS8VhcatZ8yQoX3uXlbr9orG`) or TPT Title SEO Friendly Custom GPT (`g-678147a6a908819191c940b4dba2c6ec`)
   * **Export:** Final validated deliverables package.

---

## 3. Freeze & Lag Prevention Fixes Applied

1. **Direct Routing Without Ambiguity:**
   * In `src/editable-browser-provider.cjs`, the editable artwork generation call now routes directly to `EDITABLE_GEM_URL` instead of relying on generic `{kind: 'page'}` routing that was sending requests to the static book creation gem.
2. **Eliminated Conflict in `prompt-builder.cjs`:**
   * Removed an outdated fallback in `getGemUrlForJob()` that was inadvertently redirecting all `IMAGE_JOB_KINDS` to the Mockups Gem.
3. **Session Re-Navigation Loop Eliminated:**
   * All new Gem IDs (`1qNgkNbAK7oO23hV9b8CyO5iN7_l6EMdc`, `1jnpd8-MCWS8VhcatZ8yQoX3uXlbr9orG`, `1P0s70mcBrh1YRrSEf2lZdKtv5lf2phw4`) are now registered in `liveGeminiGemIds()` and `gemHomes`.
   * Previously, unrecognized gems were treated as "retired/foreign" by `isRetiredGeminiGemUrl()`, causing Playwright to abort the session and force an infinite reload/navigation loop on every generation step.
