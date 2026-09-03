# 📝 PROMPT TO SEND TO CURSOR

---

## Hi Cursor,

I need you to create a **CORE-LOGIC-BOUNDARIES.md** file that will guide my work for the next 15-17 hours.

### **What I (Copilot CLI) Will Be Doing:**

I will add **4 enterprise-grade layers** to VERSA CLASS WITHOUT touching core logic:

1. **Security Layer** (3 hours)
   - Keychain credential storage
   - AES-256 encryption for sensitive data
   - Input validation schemas (Joi)
   - API rate limiting
   - **NEW FILES ONLY** - wraps existing handlers

2. **Performance Layer** (3 hours)
   - Response caching with TTL
   - Request batching
   - Gzip compression
   - Image lazy loading
   - **NEW FILES + 3-5 line modifications** - intercepts existing calls

3. **Professional UI/UX** (6-8 hours)
   - Enterprise design system (typography, spacing, colors)
   - Advanced component patterns (modals, drawers, popovers)
   - Spring physics animations
   - WCAG AA accessibility compliance
   - Responsive perfection (mobile → ultra-wide)
   - Dark/light mode done right
   - Micro-interactions (hover, loading, empty, error states)
   - **CSS + NEW FILES ONLY** - no JavaScript logic changes

4. **Monitoring Layer** (1.5 hours)
   - Structured logging (Pino)
   - Performance metrics tracking
   - Error capture with context
   - **NEW FILES** - observation only, doesn't modify behavior

5. **Testing** (1.5 hours)
   - Verify all 4 layers work
   - No regressions
   - Core logic unchanged

---

### **What I Will NOT Do:**

- ❌ Refactor renderer.js
- ❌ Change event flow
- ❌ Modify state management
- ❌ Touch IPC bridge logic
- ❌ Alter job queue mechanics
- ❌ Change API orchestration
- ❌ Modify existing business logic

---

### **What I Need From You:**

**Create: CORE-LOGIC-BOUNDARIES.md**

This file should contain:

#### **1. App Purpose** (paragraph)
- What is VERSA CLASS in 2-3 sentences?
- What problem does it solve for users?

#### **2. Core Architecture Diagram or Flow**
- User clicks something → What happens?
- How does IPC bridge work?
- Where does state live?
- How do jobs/projects flow through the system?

#### **3. CRITICAL - DO NOT TOUCH Section**
```
Files that contain core logic I must NEVER modify:
- renderer.js: Which functions/sections are untouchable?
- Any other critical files?
- What happens if these break?

Event flow I must NEVER intercept:
- IPC calls: Which ones are critical?
- State updates: Which patterns are sacred?
- Job processing: Which handlers are core?
```

#### **4. SAFE TO ADD LAYERS AROUND Section**
```
These existing functions can have NEW wrappers:
- API calls → Can add cache interceptor before
- Input handlers → Can add validation before
- Response handlers → Can add encryption after
- DOM elements → Can enhance styling/animations

Pattern: DON'T MODIFY existing code, WRAP it
```

#### **5. Integration Points (Where I Can Hook In)**
```
Example:
- Before sending API request: Validate, check cache ✅
- After API response: Encrypt, cache, log ✅
- On user input: Validate, sanitize ✅
- On error: Log, notify, don't break flow ✅

Example DO NOT:
- Change the API call itself ❌
- Modify the response structure ❌
- Alter state updates ❌
```

#### **6. Verification Checklist (How to Verify I Didn't Break Anything)**
```
After I finish each phase, verify:
- [ ] Can create a project? (core workflow 1)
- [ ] Can run a job? (core workflow 2)
- [ ] Can export files? (core workflow 3)
- [ ] Does IPC communication work?
- [ ] Are all event handlers responsive?
- [ ] No console errors?
- [ ] State is consistent?
```

#### **7. Files I WILL Create (So You Know What's New)**
```
backend/security/
  - credential-manager.js
  - encryption.js
  - validators.js
  - rate-limit.js

backend/core/
  - cache.js
  - batch-queue.js
  - logger.js

renderer/
  - performance-monitor.js
  - animations.js (CSS enhancements)

Plus modifications to:
  - backend/server.js (3-5 lines each addition)
  - renderer/ui.css (50-100 lines enhancements)
  - renderer/ui.js (15-20 lines for lazy loading)
```

---

### **Why This File Matters:**

This is my **NORTH STAR** during the 15-17 hour session. It ensures:
- ✅ I add features without breaking logic
- ✅ You can review my work with confidence
- ✅ Easy rollback if anything goes wrong
- ✅ Clear scope boundaries
- ✅ Zero logic interference

---

### **Timeline:**

- **You write this file**: ~30-45 minutes
- **I review it**: ~10 minutes
- **I start work**: Immediately after
- **All changes committed to GitHub** with clear commit messages

---

### **Please provide:**

1. App purpose (paragraph)
2. Core flow diagram or detailed text
3. Critical "DO NOT TOUCH" sections
4. Safe integration points for my layers
5. Verification checklist for core workflows

Keep it concise but detailed enough that I can't accidentally touch critical logic.

Thanks! 🚀

---

**After you finish this file, send it back here and I'll review it before starting the 15-17 hour session.**

