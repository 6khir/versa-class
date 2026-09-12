const { DatabaseSync } = require('node:sqlite');
const { TaskStore } = require('./task-store.cjs');
const { dirname } = require('node:path');
const { mkdirSync } = require('node:fs');

const JOB_COLUMNS = {
  status: 'status',
  attempts: 'attempts',
  lastError: 'last_error',
  lastErrorCode: 'last_error_code',
  conversationUrl: 'conversation_url',
  outputPath: 'output_path',
  width: 'width',
  height: 'height',
  baselineJson: 'baseline_json',
  editInstruction: 'edit_instruction',
  editSourcePath: 'edit_source_path',
  storyText: 'story_text',
  imagePrompt: 'image_prompt',
  textOverlays: 'text_overlays_json'
};

const PROJECT_COLUMNS = {
  name: 'name',
  status: 'status',
  outputDir: 'output_dir',
  orientation: 'orientation',
  conversationUrl: 'conversation_url',
  highlightsJson: 'highlights_json',
  targetAge: 'target_age',
  description: 'description',
  format: 'format',
  productFormat: 'product_format',
  productEngine: 'product_engine',
  editableRunId: 'editable_run_id',
  editableOutputJson: 'editable_output_json',
  stepEditableGenerationStatus: 'step_editable_generation_status',
  activityCount: 'activity_count',
  style: 'style',
  theme: 'theme',
  niche: 'niche',
  projectType: 'project_type',
  storybookPhase: 'storybook_phase',
  storyBlueprint: 'story_blueprint',
  storyExactText: 'story_exact_text_json',
  frontCoverPrompt: 'front_cover_prompt',
  backCoverPrompt: 'back_cover_prompt',
  characterSheets: 'character_sheets_json',
  storyInput: 'story_input_json',
  tptListing: 'tpt_listing_json',
  competitorMockups: 'competitor_mockups_json',
  highlights: 'highlights_json',
  productPdfPath: 'product_pdf_path',
  compressedPdfPath: 'compressed_pdf_path',
  printPdfJson: 'print_pdf_json',
  // Pipeline step statuses
  stepOverviewStatus: 'step_overview_status',
  stepCharactersStatus: 'step_characters_status',
  stepInteriorStatus: 'step_interior_status',
  stepListingStatus: 'step_listing_status',
  stepThumbnailsStatus: 'step_thumbnails_status',
  stepPreviewStatus: 'step_preview_status',
  stepExportStatus: 'step_export_status',
  stepEditableStatus: 'step_editable_status',
  stepMazeStatus: 'step_maze_status',
  isReadyToPublish: 'is_ready_to_publish'
};

const CHARACTER_COLUMNS = {
  name: 'name',
  prompt: 'prompt',
  status: 'status',
  outputPath: 'output_path',
  imageHash: 'image_hash',
  conversationUrl: 'conversation_url',
  error: 'error'
};

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function rowToProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    theme: row.theme,
    niche: row.niche,
    format: row.format,
    productFormat: row.product_format ?? 'static',
    orientation: row.orientation === 'landscape' ? 'landscape' : 'portrait',
    style: row.style,
    activityCount: row.activity_count,
    status: row.status,
    outputDir: row.output_dir,
    conversationUrl: row.conversation_url ?? null,
    highlights: parseJson(row.highlights_json, []),
    targetAge: row.target_age ?? null,
    description: row.description ?? null,
    projectType: row.project_type ?? 'standard',
    storybookPhase: row.storybook_phase ?? null,
    storyBlueprint: row.story_blueprint ?? null,
    storyExactText: parseJson(row.story_exact_text_json, []),
    frontCoverPrompt: row.front_cover_prompt ?? null,
    backCoverPrompt: row.back_cover_prompt ?? null,
    characterSheets: parseJson(row.character_sheets_json, []),
    storyInput: parseJson(row.story_input_json, null),
    tptListing: parseJson(row.tpt_listing_json, null),
    competitorMockups: parseJson(row.competitor_mockups_json, null),
    productPdfPath: row.product_pdf_path ?? null,
    compressedPdfPath: row.compressed_pdf_path ?? null,
    printPdfJson: parseJson(row.print_pdf_json, null),
    productEngine: row.product_engine ?? null,
    editableRunId: row.editable_run_id ?? null,
    editableOutputJson: parseJson(row.editable_output_json, null),
    stepEditableGenerationStatus: row.step_editable_generation_status ?? 'pending',
    // Pipeline step statuses
    stepOverviewStatus: row.step_overview_status ?? 'pending',
    stepCharactersStatus: row.step_characters_status ?? 'pending',
    stepInteriorStatus: row.step_interior_status ?? 'pending',
    stepInteriorArtworkStatus: row.step_interior_status ?? 'pending',
    stepListingStatus: row.step_listing_status ?? 'pending',
    stepThumbnailsStatus: row.step_thumbnails_status ?? 'pending',
    stepPreviewStatus: row.step_preview_status ?? 'pending',
    stepExportStatus: row.step_export_status ?? 'pending',
    stepEditableStatus: row.step_editable_status ?? 'pending',
    stepInteriorTextStatus: row.step_editable_status ?? 'pending',
    stepEditablePptStatus: row.step_editable_generation_status ?? 'pending',
    stepMazeStatus: row.step_maze_status ?? 'pending',
    isReadyToPublish: Boolean(row.is_ready_to_publish),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    pageNumber: row.page_number,
    pageLabel: row.page_label,
    kind: row.kind,
    title: row.title,
    prompt: row.prompt,
    fileName: row.file_name,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    lastErrorCode: row.last_error_code,
    conversationUrl: row.conversation_url,
    outputPath: row.output_path,
    width: row.width,
    height: row.height,
    baseline: parseJson(row.baseline_json, []),
    editInstruction: row.edit_instruction ?? null,
    editSourcePath: row.edit_source_path ?? null,
    storyText: row.story_text ?? '',
    imagePrompt: row.image_prompt ?? row.prompt,
    textOverlays: parseJson(row.text_overlays_json, []),
    zoom: Number(row.zoom ?? 1.0),
    offsetX: Number(row.offset_x ?? 0.0),
    offsetY: Number(row.offset_y ?? 0.0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToCharacter(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    projectId: row.project_id,
    index: Number(row.character_index),
    name: row.name,
    prompt: row.prompt,
    status: row.status,
    outputPath: row.output_path ?? null,
    imageHash: row.image_hash ?? null,
    conversationUrl: row.conversation_url ?? null,
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function characterRowsForProject(database, projectId) {
  return database.prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY character_index ASC')
    .all(projectId)
    .map(rowToCharacter);
}

function syncCharacterRows(database, projectId, characterSheets) {
  const records = Array.isArray(characterSheets) ? characterSheets : [];
  const timestamp = nowIso();
  const retainedIndexes = new Set();
  const upsert = database.prepare(`
    INSERT INTO characters (
      project_id, character_index, name, prompt, status, output_path, image_hash,
      conversation_url, error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, character_index) DO UPDATE SET
      name = excluded.name,
      prompt = excluded.prompt,
      status = excluded.status,
      output_path = excluded.output_path,
      image_hash = excluded.image_hash,
      conversation_url = excluded.conversation_url,
      error = excluded.error,
      updated_at = excluded.updated_at
  `);
  for (let fallbackIndex = 0; fallbackIndex < records.length; fallbackIndex += 1) {
    const record = records[fallbackIndex];
    if (!record || typeof record !== 'object') continue;
    const index = Number.isInteger(Number(record.index)) ? Number(record.index) : fallbackIndex;
    retainedIndexes.add(index);
    upsert.run(
      projectId,
      index,
      String(record.name || `Character ${index + 1}`),
      String(record.prompt || ''),
      String(record.status || 'not_generated'),
      record.outputPath ?? null,
      record.imageHash ?? null,
      record.conversationUrl ?? null,
      record.error ?? null,
      record.createdAt ?? timestamp,
      timestamp
    );
  }
  for (const row of database.prepare('SELECT character_index FROM characters WHERE project_id = ?').all(projectId)) {
    if (!retainedIndexes.has(Number(row.character_index))) {
      database.prepare('DELETE FROM characters WHERE project_id = ? AND character_index = ?')
        .run(projectId, row.character_index);
    }
  }
  return characterRowsForProject(database, projectId);
}

function rowToEvent(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    jobId: row.job_id,
    level: row.level,
    message: row.message,
    details: parseJson(row.details_json, null),
    createdAt: row.created_at
  };
}

class ProjectStore {
  constructor(databasePath) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
    // The durable queue shares this connection deliberately: a task row and the
    // project row it advances commit to the same file, so they cannot disagree
    // after a crash.
    this.tasks = new TaskStore(this.db);
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        theme TEXT NOT NULL,
        niche TEXT NOT NULL,
        format TEXT NOT NULL,
        orientation TEXT NOT NULL DEFAULT 'portrait',
        style TEXT NOT NULL,
        activity_count INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        output_dir TEXT NOT NULL,
        conversation_url TEXT,
        highlights_json TEXT,
        target_age TEXT,
        description TEXT,
        project_type TEXT NOT NULL DEFAULT 'standard',
        storybook_phase TEXT,
        story_blueprint TEXT,
        story_exact_text_json TEXT,
        front_cover_prompt TEXT,
        back_cover_prompt TEXT,
        character_sheets_json TEXT,
        story_input_json TEXT,
        tpt_listing_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL,
        page_label TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        file_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_error_code TEXT,
        conversation_url TEXT,
        output_path TEXT,
        width INTEGER,
        height INTEGER,
        baseline_json TEXT,
        edit_instruction TEXT,
        edit_source_path TEXT,
        story_text TEXT,
        image_prompt TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, page_number)
      );

      CREATE TABLE IF NOT EXISTS characters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        character_index INTEGER NOT NULL,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'not_generated',
        output_path TEXT,
        image_hash TEXT,
        conversation_url TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, character_index)
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS automation_settings (
        step_name TEXT PRIMARY KEY,
        mode TEXT NOT NULL DEFAULT 'always'
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT,
        job_id TEXT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_project_page ON jobs(project_id, page_number);
      CREATE INDEX IF NOT EXISTS idx_jobs_project_status ON jobs(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_characters_project_index ON characters(project_id, character_index);
      CREATE INDEX IF NOT EXISTS idx_characters_project_status ON characters(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_events_project_created ON events(project_id, id DESC);

    `);
    const jobColumns = new Set(this.db.prepare('PRAGMA table_info(jobs)').all().map((column) => column.name));
    if (!jobColumns.has('edit_instruction')) this.db.exec('ALTER TABLE jobs ADD COLUMN edit_instruction TEXT;');
    if (!jobColumns.has('edit_source_path')) this.db.exec('ALTER TABLE jobs ADD COLUMN edit_source_path TEXT;');
    if (!jobColumns.has('story_text')) this.db.exec('ALTER TABLE jobs ADD COLUMN story_text TEXT;');
    if (!jobColumns.has('image_prompt')) this.db.exec('ALTER TABLE jobs ADD COLUMN image_prompt TEXT;');
    if (!jobColumns.has('text_overlays_json')) this.db.exec('ALTER TABLE jobs ADD COLUMN text_overlays_json TEXT;');
    if (!jobColumns.has('zoom')) this.db.exec('ALTER TABLE jobs ADD COLUMN zoom REAL DEFAULT 1.0;');
    if (!jobColumns.has('offset_x')) this.db.exec('ALTER TABLE jobs ADD COLUMN offset_x REAL DEFAULT 0.0;');
    if (!jobColumns.has('offset_y')) this.db.exec('ALTER TABLE jobs ADD COLUMN offset_y REAL DEFAULT 0.0;');
    const projectColumns = new Set(this.db.prepare('PRAGMA table_info(projects)').all().map((column) => column.name));
    if (!projectColumns.has('orientation')) {
      this.db.exec("ALTER TABLE projects ADD COLUMN orientation TEXT NOT NULL DEFAULT 'portrait';");
    }
    if (!projectColumns.has('conversation_url')) {
      this.db.exec("ALTER TABLE projects ADD COLUMN conversation_url TEXT;");
    }
    if (!projectColumns.has('highlights_json')) {
      this.db.exec("ALTER TABLE projects ADD COLUMN highlights_json TEXT;");
    }
    if (!projectColumns.has('target_age')) {
      this.db.exec("ALTER TABLE projects ADD COLUMN target_age TEXT;");
    }
    if (!projectColumns.has('description')) {
      this.db.exec("ALTER TABLE projects ADD COLUMN description TEXT;");
    }
    if (!projectColumns.has('project_type')) {
      this.db.exec("ALTER TABLE projects ADD COLUMN project_type TEXT NOT NULL DEFAULT 'standard';");
    }
    if (!projectColumns.has('storybook_phase')) this.db.exec('ALTER TABLE projects ADD COLUMN storybook_phase TEXT;');
    if (!projectColumns.has('story_blueprint')) this.db.exec('ALTER TABLE projects ADD COLUMN story_blueprint TEXT;');
    if (!projectColumns.has('story_exact_text_json')) this.db.exec('ALTER TABLE projects ADD COLUMN story_exact_text_json TEXT;');
    if (!projectColumns.has('front_cover_prompt')) this.db.exec('ALTER TABLE projects ADD COLUMN front_cover_prompt TEXT;');
    if (!projectColumns.has('back_cover_prompt')) this.db.exec('ALTER TABLE projects ADD COLUMN back_cover_prompt TEXT;');
    if (!projectColumns.has('character_sheets_json')) this.db.exec('ALTER TABLE projects ADD COLUMN character_sheets_json TEXT;');
    if (!projectColumns.has('story_input_json')) this.db.exec('ALTER TABLE projects ADD COLUMN story_input_json TEXT;');
    if (!projectColumns.has('tpt_listing_json')) this.db.exec('ALTER TABLE projects ADD COLUMN tpt_listing_json TEXT;');
    if (!projectColumns.has('competitor_mockups_json')) this.db.exec('ALTER TABLE projects ADD COLUMN competitor_mockups_json TEXT;');
    if (!projectColumns.has('product_format')) this.db.exec("ALTER TABLE projects ADD COLUMN product_format TEXT NOT NULL DEFAULT 'static';");
    if (!projectColumns.has('product_pdf_path')) this.db.exec('ALTER TABLE projects ADD COLUMN product_pdf_path TEXT;');
    if (!projectColumns.has('compressed_pdf_path')) this.db.exec('ALTER TABLE projects ADD COLUMN compressed_pdf_path TEXT;');
    if (!projectColumns.has('print_pdf_json')) this.db.exec('ALTER TABLE projects ADD COLUMN print_pdf_json TEXT;');
    // Pipeline step status columns
    if (!projectColumns.has('step_overview_status')) this.db.exec("ALTER TABLE projects ADD COLUMN step_overview_status TEXT NOT NULL DEFAULT 'pending';");
    if (!projectColumns.has('step_characters_status')) this.db.exec("ALTER TABLE projects ADD COLUMN step_characters_status TEXT NOT NULL DEFAULT 'pending';");
    if (!projectColumns.has('step_interior_status')) this.db.exec("ALTER TABLE projects ADD COLUMN step_interior_status TEXT NOT NULL DEFAULT 'pending';");
    if (!projectColumns.has('step_listing_status')) this.db.exec("ALTER TABLE projects ADD COLUMN step_listing_status TEXT NOT NULL DEFAULT 'pending';");
    if (!projectColumns.has('step_thumbnails_status')) this.db.exec("ALTER TABLE projects ADD COLUMN step_thumbnails_status TEXT NOT NULL DEFAULT 'pending';");
    if (!projectColumns.has('step_preview_status')) this.db.exec("ALTER TABLE projects ADD COLUMN step_preview_status TEXT NOT NULL DEFAULT 'pending';");
    if (!projectColumns.has('step_export_status')) this.db.exec("ALTER TABLE projects ADD COLUMN step_export_status TEXT NOT NULL DEFAULT 'pending';");
    if (!projectColumns.has('step_editable_status')) this.db.exec("ALTER TABLE projects ADD COLUMN step_editable_status TEXT NOT NULL DEFAULT 'pending';");
    if (!projectColumns.has('step_maze_status')) this.db.exec("ALTER TABLE projects ADD COLUMN step_maze_status TEXT NOT NULL DEFAULT 'pending';");
    for (const [column, type] of Object.entries({ product_engine: 'TEXT', editable_run_id: 'TEXT', editable_output_json: 'TEXT', step_editable_generation_status: "TEXT NOT NULL DEFAULT 'pending'" })) {
      if (!projectColumns.has(column)) this.db.exec(`ALTER TABLE projects ADD COLUMN ${column} ${type}`);
    }
    if (!projectColumns.has('is_ready_to_publish')) this.db.exec('ALTER TABLE projects ADD COLUMN is_ready_to_publish INTEGER NOT NULL DEFAULT 0;');
    // Seed default automation settings if not yet present
    const automationSteps = ['editable_generation', 'overview', 'characters', 'interior', 'listing', 'thumbnails', 'preview', 'export', 'maze'];
    const seedSetting = this.db.prepare(`
      INSERT INTO automation_settings (step_name, mode) VALUES (?, 'always')
      ON CONFLICT(step_name) DO NOTHING
    `);
    for (const step of automationSteps) seedSetting.run(step);
    const characterColumns = new Set(this.db.prepare('PRAGMA table_info(characters)').all().map((column) => column.name));
    if (!characterColumns.has('image_hash')) this.db.exec('ALTER TABLE characters ADD COLUMN image_hash TEXT;');
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_project_image_hash
      ON characters(project_id, image_hash) WHERE image_hash IS NOT NULL AND image_hash != '';
    `);

    const legacyProjects = this.db.prepare(`
      SELECT id, character_sheets_json
      FROM projects
      WHERE character_sheets_json IS NOT NULL AND character_sheets_json != ''
    `).all();
    for (const project of legacyProjects) {
      const existingCount = Number(this.db.prepare('SELECT COUNT(*) AS count FROM characters WHERE project_id = ?').get(project.id)?.count ?? 0);
      if (existingCount > 0) continue;
      const legacyCharacters = parseJson(project.character_sheets_json, []);
      const canonicalCharacters = syncCharacterRows(this.db, project.id, legacyCharacters);
      this.db.prepare('UPDATE projects SET character_sheets_json = ? WHERE id = ?')
        .run(JSON.stringify(canonicalCharacters), project.id);
    }
  }

  createProject(project, jobs = []) {
    const createdAt = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO projects (
          id, name, theme, niche, format, orientation, style, activity_count,
          status, output_dir, conversation_url, highlights_json, target_age, description,
          project_type, storybook_phase, story_blueprint, story_exact_text_json,
          front_cover_prompt, back_cover_prompt, character_sheets_json, story_input_json, tpt_listing_json,
          product_format,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        project.id,
        project.name,
        project.theme,
        project.niche,
        project.format,
        project.orientation === 'landscape' ? 'landscape' : 'portrait',
        project.style,
        project.activityCount,
        project.status ?? 'draft',
        project.outputDir,
        project.conversationUrl ?? null,
        project.highlights ? JSON.stringify(project.highlights) : null,
        project.targetAge ?? null,
        project.description ?? null,
        project.projectType ?? 'standard',
        project.storybookPhase ?? null,
        project.storyBlueprint ?? null,
        project.storyExactText ? JSON.stringify(project.storyExactText) : null,
        project.frontCoverPrompt ?? null,
        project.backCoverPrompt ?? null,
        project.characterSheets ? JSON.stringify(project.characterSheets) : null,
        project.storyInput ? JSON.stringify(project.storyInput) : null,
        project.tptListing ? JSON.stringify(project.tptListing) : null,
        project.productFormat ?? 'static',
        createdAt,
        createdAt
      );

      if (Array.isArray(project.characterSheets)) {
        const canonicalCharacters = syncCharacterRows(this.db, project.id, project.characterSheets);
        this.db.prepare('UPDATE projects SET character_sheets_json = ? WHERE id = ?')
          .run(JSON.stringify(canonicalCharacters), project.id);
      }

      if (jobs && jobs.length > 0) {
        const insertJob = this.db.prepare(`
          INSERT INTO jobs (
            id, project_id, page_number, page_label, kind, title, prompt,
            story_text, image_prompt, text_overlays_json, file_name, status, attempts, conversation_url, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const job of jobs) {
          insertJob.run(
            job.id,
            project.id,
            job.pageNumber,
            job.pageLabel,
            job.kind,
            job.title,
            job.prompt,
            job.storyText ?? null,
            job.imagePrompt ?? null,
            job.textOverlays ? JSON.stringify(job.textOverlays) : null,
            job.fileName,
            job.status ?? 'pending',
            job.attempts ?? 0,
            job.conversationUrl ?? null,
            createdAt,
            createdAt
          );
        }
      }
      this.setSetting('selectedProjectId', project.id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getProject(project.id);
  }

  populateProjectJobs(projectId, jobs, format, orientation, activityCount) {
    const createdAt = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM jobs WHERE project_id = ?').run(projectId);

      if (jobs && jobs.length > 0) {
        const insertJob = this.db.prepare(`
          INSERT INTO jobs (
            id, project_id, page_number, page_label, kind, title, prompt,
            story_text, image_prompt, text_overlays_json, file_name, status, attempts, conversation_url, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const job of jobs) {
          insertJob.run(
            job.id,
            projectId,
            job.pageNumber,
            job.pageLabel,
            job.kind,
            job.title,
            job.prompt,
            job.storyText ?? null,
            job.imagePrompt ?? null,
            job.textOverlays ? JSON.stringify(job.textOverlays) : null,
            job.fileName,
            job.status ?? 'pending',
            job.attempts ?? 0,
            job.conversationUrl ?? null,
            createdAt,
            createdAt
          );
        }
      }
      this.db.prepare(`
        UPDATE projects
        SET format = ?, orientation = ?, activity_count = ?, status = 'draft', style = 'Content Gem generated page prompts', updated_at = ?
        WHERE id = ?
      `).run(format, orientation, activityCount, createdAt, projectId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getProject(projectId);
  }

  deleteProject(projectId) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(`mazeProject:${projectId}`);
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(`mazeLab:${projectId}`);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }



  listProjects() {
    return this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all().map((row) => {
      const project = rowToProject(row);
      project.characterSheets = this.listCharacters(project.id);
      project.stats = this.getProjectStats(project.id);
      return project;
    });
  }

  getProject(projectId) {
    const project = rowToProject(this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId));
    if (!project) return null;
    project.characterSheets = this.listCharacters(projectId);
    project.jobs = this.listJobs(projectId);
    project.stats = this.getProjectStats(projectId);
    return project;
  }

  listCharacters(projectId) {
    return characterRowsForProject(this.db, projectId);
  }

  listCompleteCharacters(projectId) {
    return this.db.prepare(`
      SELECT * FROM characters
      WHERE project_id = ? AND status = 'complete' AND output_path IS NOT NULL AND output_path != ''
      ORDER BY character_index ASC
    `).all(projectId).map(rowToCharacter);
  }

  getCharacter(characterId) {
    return rowToCharacter(this.db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId));
  }

  getCharacterByIndex(projectId, characterIndex) {
    return rowToCharacter(this.db.prepare(`
      SELECT * FROM characters WHERE project_id = ? AND character_index = ?
    `).get(projectId, characterIndex));
  }

  findCharacterByImageHash(projectId, imageHash, excludeCharacterId = null) {
    if (!imageHash) return null;
    const row = excludeCharacterId == null
      ? this.db.prepare('SELECT * FROM characters WHERE project_id = ? AND image_hash = ? LIMIT 1').get(projectId, imageHash)
      : this.db.prepare('SELECT * FROM characters WHERE project_id = ? AND image_hash = ? AND id != ? LIMIT 1')
        .get(projectId, imageHash, excludeCharacterId);
    return rowToCharacter(row);
  }

  updateCharacter(characterId, patch) {
    const current = this.getCharacter(characterId);
    if (!current) return null;
    const entries = Object.entries(patch).filter(([key]) => CHARACTER_COLUMNS[key]);
    if (!entries.length) return current;
    const timestamp = nowIso();
    const assignments = entries.map(([key]) => `${CHARACTER_COLUMNS[key]} = ?`);
    const values = entries.map(([, value]) => value);
    assignments.push('updated_at = ?');
    values.push(timestamp, characterId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`UPDATE characters SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
      const canonicalCharacters = characterRowsForProject(this.db, current.projectId);
      this.db.prepare(`
        UPDATE projects SET character_sheets_json = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(canonicalCharacters), timestamp, current.projectId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getCharacter(characterId);
  }

  listJobs(projectId) {
    return this.db.prepare('SELECT * FROM jobs WHERE project_id = ? ORDER BY page_number ASC').all(projectId).map(rowToJob);
  }

  getJob(jobId) {
    return rowToJob(this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId));
  }

  getNextIncompleteJob(projectId) {
    const row = this.db.prepare(`
      SELECT * FROM jobs
      WHERE project_id = ? AND status != 'complete'
      ORDER BY page_number ASC
      LIMIT 1
    `).get(projectId);
    return rowToJob(row);
  }

  getNextIncompleteBatch(projectId, batchSize = 5) {
    const size = Math.max(1, Math.min(10, Number(batchSize) || 5));
    const first = this.getNextIncompleteJob(projectId);
    if (!first) return [];
    const batchEnd = Math.ceil(first.pageNumber / size) * size;
    return this.db.prepare(`
      SELECT * FROM jobs
      WHERE project_id = ? AND status != 'complete' AND page_number <= ?
      ORDER BY page_number ASC
    `).all(projectId, batchEnd).map(rowToJob);
  }

  getProjectStats(projectId) {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM jobs WHERE project_id = ? GROUP BY status
    `).all(projectId);
    const byStatus = Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
    const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0);
    const complete = byStatus.complete ?? 0;
    return {
      total,
      complete,
      remaining: total - complete,
      percent: total ? Math.round((complete / total) * 100) : 0,
      byStatus
    };
  }

  updateJob(jobId, patch) {
    const entries = Object.entries(patch).filter(([key]) => JOB_COLUMNS[key]);
    if (!entries.length) return this.getJob(jobId);
    const assignments = entries.map(([key]) => `${JOB_COLUMNS[key]} = ?`);
    const values = entries.map(([key, value]) => {
      if (key === 'baselineJson' && value != null) return JSON.stringify(value);
      if (key === 'textOverlays' && value != null) return JSON.stringify(value);
      return value;
    });
    assignments.push('updated_at = ?');
    values.push(nowIso(), jobId);
    this.db.prepare(`UPDATE jobs SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    const job = this.getJob(jobId);
    if (job) this.touchProject(job.projectId);
    return job;
  }

  updateProjectTransactionally(projectId, mutator) {
    this.db.exec('SAVEPOINT update_project_txn');
    try {
      const current = this.getProject(projectId);
      if (!current) {
        this.db.exec('RELEASE SAVEPOINT update_project_txn');
        return null;
      }
      const patch = mutator(current);
      if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
        this.db.exec('RELEASE SAVEPOINT update_project_txn');
        return current;
      }
      const result = this.updateProject(projectId, patch);
      this.db.exec('RELEASE SAVEPOINT update_project_txn');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK TO SAVEPOINT update_project_txn');
      this.db.exec('RELEASE SAVEPOINT update_project_txn');
      throw error;
    }
  }

  lockProductEngine(projectId) {
    const { detectProductEngine } = require('./product-engine-boundary.cjs');
    const project = this.getProject(projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { code: 'PROJECT_NOT_FOUND' });
    const type = detectProductEngine(project);
    this.db.prepare('UPDATE projects SET product_engine = ?, editable_run_id = COALESCE(editable_run_id, ?) WHERE id = ? AND product_engine IS NULL')
      .run(type, require('node:crypto').randomUUID(), projectId);
    const locked = this.getProject(projectId);
    detectProductEngine(locked);
    return locked;
  }

  updateProject(projectId, patch) {
    if (Object.hasOwn(patch, 'productFormat')) {
      const existing = this.getProject(projectId);
      if (existing?.productEngine) require('./product-engine-boundary.cjs').detectProductEngine({ ...existing, productFormat: patch.productFormat });
    }
    const entries = Object.entries(patch).filter(([key]) => PROJECT_COLUMNS[key]);
    if (!entries.length) return this.getProject(projectId);
    const assignments = entries.map(([key]) => `${PROJECT_COLUMNS[key]} = ?`);
    const jsonKeys = new Set(['editableOutputJson', 'storyExactText', 'characterSheets', 'storyInput', 'highlights', 'tptListing', 'competitorMockups', 'printPdfJson']);
    const values = entries.map(([key, value]) => {
      if (jsonKeys.has(key) && value != null) return JSON.stringify(value);
      return value;
    });
    assignments.push('updated_at = ?');
    const timestamp = nowIso();
    values.push(timestamp, projectId);
    const syncCharacters = Object.prototype.hasOwnProperty.call(patch, 'characterSheets');
    const characterSheets = syncCharacters ? patch.characterSheets : null;
    if (syncCharacters) this.db.exec('SAVEPOINT sync_chars');
    try {
      this.db.prepare(`UPDATE projects SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
      if (syncCharacters) {
        const canonicalCharacters = syncCharacterRows(this.db, projectId, characterSheets);
        this.db.prepare('UPDATE projects SET character_sheets_json = ? WHERE id = ?')
          .run(JSON.stringify(canonicalCharacters), projectId);
        this.db.exec('RELEASE SAVEPOINT sync_chars');
      }
    } catch (error) {
      if (syncCharacters) {
        this.db.exec('ROLLBACK TO SAVEPOINT sync_chars');
        this.db.exec('RELEASE SAVEPOINT sync_chars');
      }
      throw error;
    }
    return this.getProject(projectId);
  }

  touchProject(projectId) {
    if (!projectId) return null;
    this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(nowIso(), projectId);
    return this.getProject(projectId);
  }

  resetJob(jobId) {
    const existing = this.getJob(jobId);
    const { existsSync } = require('node:fs');
    const src = existing?.editSourcePath || existing?.outputPath || '';
    const editDead = Boolean(
      existing?.editInstruction
      && (!src || !existsSync(src) || /\.svg$/i.test(src))
    );
    return this.updateJob(jobId, {
      status: existing?.editInstruction && !editDead ? 'edit_pending' : 'pending',
      attempts: 0,
      lastError: null,
      lastErrorCode: null,
      baselineJson: null,
      ...(editDead ? {
        editInstruction: null,
        editSourcePath: null,
        outputPath: (existing?.outputPath && existsSync(existing.outputPath) && !/\.svg$/i.test(existing.outputPath))
          ? existing.outputPath
          : null,
        conversationUrl: null
      } : {})
    });
  }

  resetIncomplete(projectId) {
    const timestamp = nowIso();
    this.db.prepare(`
      UPDATE jobs
      SET status = CASE WHEN edit_instruction IS NULL THEN 'pending' ELSE 'edit_pending' END,
          attempts = 0, last_error = NULL,
          last_error_code = NULL, baseline_json = NULL, updated_at = ?
      WHERE project_id = ? AND status != 'complete'
    `).run(timestamp, projectId);
    this.touchProject(projectId);
  }

  queuePageEdit(jobId, instruction) {
    const job = this.getJob(jobId);
    if (!job?.outputPath) {
      throw Object.assign(new Error('This page does not have a completed image to edit.'), { code: 'EDIT_SOURCE_MISSING' });
    }
    if (job.editInstruction) {
      throw Object.assign(new Error('An edit for this page is already queued.'), { code: 'EDIT_ALREADY_QUEUED' });
    }
    const normalized = String(instruction ?? '').trim();
    if (!normalized) throw Object.assign(new Error('Enter an edit instruction first.'), { code: 'EDIT_INSTRUCTION_EMPTY' });
    return this.updateJob(jobId, {
      status: 'edit_pending',
      attempts: 0,
      editInstruction: normalized,
      editSourcePath: job.outputPath,
      baselineJson: null,
      lastError: null,
      lastErrorCode: null
    });
  }

  queuePageRegeneration(jobId) {
    const job = this.getJob(jobId);
    if (!job?.outputPath) {
      throw Object.assign(new Error('This page does not have a completed image to regenerate.'), { code: 'REGENERATION_SOURCE_MISSING' });
    }
    if (!job.conversationUrl) {
      throw Object.assign(new Error('This page does not have a saved Gemini conversation.'), { code: 'CONVERSATION_NOT_FOUND' });
    }
    const description = job.storyText ? `story text "${job.storyText.substring(0, 100)}"` : `page content`;
    const targetRef = job.pageLabel ? `page reference ${job.pageLabel} (${description})` : description;
    return this.queuePageEdit(jobId, [
      `Regenerate the page image matching ${targetRef} in this conversation as a new improved version.`,
      'Keep the same required content, exact text, characters, visual style, page format, and orientation.',
      'Fix any visible generation defects while preserving the original creative direction.'
    ].join(' '));
  }

  recoverInterrupted() {
    const transient = ['preparing', 'submitted', 'generating', 'downloading', 'validating'];
    const placeholders = transient.map(() => '?').join(', ');
    this.db.prepare(`
      UPDATE jobs
      SET status = 'retry_wait',
          last_error = COALESCE(last_error, 'The app closed while this page was active. Recovery will verify it before resubmitting.'),
          last_error_code = COALESCE(last_error_code, 'APP_RESTARTED'),
          updated_at = ?
      WHERE status IN (${placeholders})
    `).run(nowIso(), ...transient);
    this.db.prepare(`
      UPDATE projects SET status = 'paused', updated_at = ? WHERE status = 'running'
    `).run(nowIso());
    const interruptedListings = new Set(['uploading_listing', 'listing_form_ready', 'draft_form_ready', 'submitting_listing']);
    const updateListing = this.db.prepare(`
      UPDATE projects SET tpt_listing_json = ?, updated_at = ? WHERE id = ?
    `);
    for (const row of this.db.prepare(`
      SELECT id, tpt_listing_json FROM projects WHERE tpt_listing_json IS NOT NULL
    `).all()) {
      const listing = parseJson(row.tpt_listing_json, null);
      if (!listing || !interruptedListings.has(listing.status)) continue;
      const submissionWasInterrupted = listing.status === 'submitting_listing';
      updateListing.run(JSON.stringify({
        ...listing,
        status: 'upload_failed',
        uploadError: submissionWasInterrupted
          ? 'The app closed while TPT submission was in progress. Check My Products before resuming to avoid creating a duplicate.'
          : 'The prepared TPT browser tab closed with the app.',
        uploadMessage: submissionWasInterrupted
          ? 'Submission result is unknown. Check My Products before Resume uploading.'
          : 'Resume uploading restores the prepared TPT form without another listing review.'
      }), nowIso(), row.id);
    }
  }

  reconcileCompletedArtifacts() {
    const { existsSync, statSync } = require('node:fs');
    const timestamp = nowIso();
    const invalidJobs = [];
    for (const row of this.db.prepare(`
      SELECT id, project_id, page_number, output_path
      FROM jobs
      WHERE status = 'complete'
    `).all()) {
      let valid = false;
      try {
        valid = Boolean(row.output_path && existsSync(row.output_path) && statSync(row.output_path).isFile() && statSync(row.output_path).size > 0);
      } catch {
        valid = false;
      }
      if (valid) continue;
      invalidJobs.push(row);
      this.db.prepare(`
        UPDATE jobs
        SET status = 'pending',
            attempts = 0,
            output_path = NULL,
            last_error = 'Completed page artifact was missing or invalid during launch reconciliation.',
            last_error_code = 'ARTIFACT_RECONCILED',
            baseline_json = NULL,
            updated_at = ?
        WHERE id = ?
      `).run(timestamp, row.id);
    }

    const touchedProjectIds = [...new Set(invalidJobs.map((row) => row.project_id))];
    for (const projectId of touchedProjectIds) {
      this.db.prepare(`
        UPDATE projects
        SET status = CASE WHEN status = 'complete' THEN 'paused' ELSE status END,
            step_interior_status = CASE WHEN step_interior_status = 'completed' THEN 'pending' ELSE step_interior_status END,
            step_editable_generation_status = CASE WHEN step_editable_generation_status = 'completed' THEN 'pending' ELSE step_editable_generation_status END,
            step_thumbnails_status = CASE WHEN step_thumbnails_status = 'completed' THEN 'pending' ELSE step_thumbnails_status END,
            step_preview_status = CASE WHEN step_preview_status = 'completed' THEN 'pending' ELSE step_preview_status END,
            step_listing_status = CASE WHEN step_listing_status = 'completed' THEN 'pending' ELSE step_listing_status END,
            step_export_status = CASE WHEN step_export_status = 'completed' THEN 'pending' ELSE step_export_status END,
            updated_at = ?
        WHERE id = ?
      `).run(timestamp, projectId);
      this.appendEvent({
        projectId,
        level: 'warn',
        message: `[Recovery] ${invalidJobs.filter((row) => row.project_id === projectId).length} completed page artifact(s) were missing or invalid. The project was reopened from the first incomplete job.`
      });
    }
    return { invalidJobs: invalidJobs.length, projectIds: touchedProjectIds };
  }

  appendEvent({ projectId = null, jobId = null, level = 'info', message, details = null }) {
    this.db.prepare(`
      INSERT INTO events (project_id, job_id, level, message, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(projectId, jobId, level, message, details == null ? null : JSON.stringify(details), nowIso());
    this.db.prepare(`
      DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 1000)
    `).run();
  }

  listEvents(projectId, limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    // Strict per-book activity — never mix other projects or orphaned globals into the studio feed.
    return this.db.prepare(`
      SELECT * FROM events
      WHERE project_id = ?
      ORDER BY id DESC LIMIT ?
    `).all(projectId, safeLimit).map(rowToEvent);
  }

  setSetting(key, value) {
    this.db.prepare(`
      INSERT INTO settings (key, value_json) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `).run(key, JSON.stringify(value));
  }

  getSetting(key, fallback = null) {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key);
    return row ? parseJson(row.value_json, fallback) : fallback;
  }

  // --- Automation pipeline settings ---
  getAutomationSettings() {
    const rows = this.db.prepare('SELECT step_name, mode FROM automation_settings').all();
    const result = {};
    for (const row of rows) result[row.step_name] = row.mode;
    if (!result.editable) result.editable = 'ask';
    return result;
  }

  setAutomationSetting(stepName, mode) {
    const validModes = ['always', 'ask', 'manual'];
    const safeMode = validModes.includes(mode) ? mode : 'always';
    this.db.prepare(`
      INSERT INTO automation_settings (step_name, mode) VALUES (?, ?)
      ON CONFLICT(step_name) DO UPDATE SET mode = excluded.mode
    `).run(stepName, safeMode);
  }

  // Update a single pipeline step status for a project
  updateProjectStepStatus(projectId, stepName, status) {
    const columnMap = {
      overview: 'step_overview_status',
      characters: 'step_characters_status',
      interior: 'step_interior_status',
      listing: 'step_listing_status',
      thumbnails: 'step_thumbnails_status',
      preview: 'step_preview_status',
      export: 'step_export_status',
      editable_generation: 'step_editable_generation_status',
      editable: 'step_editable_status',
      // Editable pipeline: artwork shares the interior page columns, text uses the
      // dedicated editable column, and assembly keeps the editable-generation column.
      interior_artwork: 'step_interior_status',
      interior_text: 'step_editable_status',
      editable_ppt: 'step_editable_generation_status',
      maze: 'step_maze_status'
    };
    const column = columnMap[stepName];
    if (!column) return;
    this.db.prepare(`UPDATE projects SET ${column} = ?, updated_at = ? WHERE id = ?`)
      .run(status, nowIso(), projectId);
  }

  // Returns runnable, non-published projects ordered by creation time. Concept
  // drafts with no page jobs and books already waiting for explicit user
  // attention stay out of Full Automation until the user finishes/resets them.
  listProjectsForAutomation() {
    return this.db.prepare(
      `SELECT projects.*
       FROM projects
       WHERE is_ready_to_publish = 0
         AND EXISTS (
           SELECT 1 FROM jobs WHERE jobs.project_id = projects.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM jobs
           WHERE jobs.project_id = projects.id
             AND jobs.status IN ('needs_user_action', 'rate_limit_paused')
         )
       ORDER BY created_at ASC`
    ).all().map((row) => {
      const project = rowToProject(row);
      project.stats = this.getProjectStats(project.id);
      return project;
    });
  }

  getDashboardState() {
    const projects = this.listProjects();
    let selectedProjectId = this.getSetting('selectedProjectId', projects[0]?.id ?? null);
    if (selectedProjectId && !projects.some((project) => project.id === selectedProjectId)) {
      selectedProjectId = projects[0]?.id ?? null;
      this.setSetting('selectedProjectId', selectedProjectId);
    }
    const activeProject = selectedProjectId ? this.getProject(selectedProjectId) : null;
    const agentPipeline = (this.tasks?.latestByKinds(['trend_scan', 'analysis'], { limit: 8 }) || []).map((task) => ({
      id: task.id,
      kind: task.kind,
      state: task.state,
      checkpoint: task.checkpoint,
      lastError: task.lastError,
      updatedAt: task.updatedAt,
      projectId: task.checkpoint?.projectId || null
    }));
    return {
      projects,
      selectedProjectId,
      activeProject,
      events: activeProject ? this.listEvents(activeProject.id, 120) : [],
      agentPipeline
    };
  }

  clearAllData() {
    this.db.prepare('DELETE FROM jobs').run();
    this.db.prepare('DELETE FROM characters').run();
    this.db.prepare('DELETE FROM projects').run();
    this.db.prepare('DELETE FROM events').run();
    this.db.prepare('DELETE FROM settings').run();
    this.db.prepare('DELETE FROM automation_settings').run();
    try {
      this.db.prepare('VACUUM').run();
    } catch {
      // Ignore vacuum locks
    }
  }

  close() {
    this.db.close();
  }
}

module.exports = { ProjectStore, nowIso, rowToJob, rowToProject };
