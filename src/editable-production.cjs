'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { FileManager, resolvePageSetup, atomicWrite, bookFileCode } = require('./file-manager.cjs');
const { EditableRepository } = require('./editable-repository.cjs');
const { createEditablePage, applyEditablePageCommand, selectCurrentEditablePair } = require('./editable-page-revisions.cjs');
const { validateEditablePageContract } = require('./editable-page-contract.cjs');
const { buildDeterministicPageLayout, buildPageElements } = require('./editable-layout-engine.cjs');
const { locateJobImage } = require('./editable-page-assets.cjs');
const { readCachedPageText } = require('./editable-page-text.cjs');
const { resolveLayout } = require('./editable-layout-resolver.cjs');
const { assertEditableLayoutMatchesContract } = require('./editable-engine-orchestrator.cjs');
const { assembleEditableEnginePptx } = require('./editable-pptx-assembler.cjs');
const { detectProductEngine, ENGINE_TYPES } = require('./product-engine-boundary.cjs');
const { blankFileName } = require('./text-overlay-layout.cjs');
const {
  inpaintOkSidecar,
  shouldCleanBakedText,
  sidecarIsClean
} = require('./text-inpaint-bridge.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function sortJobsByPage(jobs) {
  return (Array.isArray(jobs) ? jobs : [])
    .slice()
    .sort((left, right) => (Number(left?.pageNumber) || 0) - (Number(right?.pageNumber) || 0));
}

function isRawPngPath(filePath) {
  return /\.raw\.png$/i.test(String(filePath || ''));
}

function rawSiblingPath(filePath) {
  const value = String(filePath || '');
  if (!value) return null;
  if (isRawPngPath(value)) return value;
  if (/\.png$/i.test(value)) return value.replace(/\.png$/i, '.raw.png');
  return `${value}.raw.png`;
}

function firstExisting(paths) {
  for (const filePath of paths) {
    if (filePath && existsSync(filePath)) return filePath;
  }
  return null;
}

function exportPageRole(index, pageCount) {
  if (index === 0) return 'cover';
  if (pageCount >= 2 && index === pageCount - 1) return 'back';
  return 'interior';
}

function resolveRawFlatPath(job, outputDir) {
  const outputPath = String(job?.outputPath || '');
  const fileName = String(job?.fileName || '');
  const candidates = [
    rawSiblingPath(outputPath),
    outputDir && fileName ? join(outputDir, fileName.replace(/\.png$/i, '.raw.png')) : null
  ];
  const rawPath = firstExisting(candidates);
  if (rawPath) return rawPath;
  if (outputPath && existsSync(outputPath)) return outputPath;
  return rawPath || outputPath || null;
}

function resolveRebuiltInteriorPath(job, outputDir) {
  const outputPath = String(job?.outputPath || '');
  const namedBlank = outputDir ? join(outputDir, blankFileName(job?.pageNumber)) : null;
  const showcaseSibling = outputPath.replace(/_showcase\.png$/i, '_blank.png');
  const candidates = [namedBlank, outputPath, showcaseSibling].filter((filePath) => (
    filePath && existsSync(filePath) && !isRawPngPath(filePath)
  ));
  return candidates[0] || null;
}

function sidecarReportsResidual(imagePath) {
  const sidecar = inpaintOkSidecar(imagePath);
  if (!sidecar || !existsSync(sidecar)) return false;
  try {
    const payload = JSON.parse(readFileSync(sidecar, 'utf8'));
    if (payload?.code === 'TEXT_INPAINT_RESIDUAL') return true;
    if (payload?.ok === false && Number(payload.residual_count || 0) > 0) return true;
    return false;
  } catch {
    return false;
  }
}

function hasTextInpaintResidual(job, imagePath) {
  if (job?.lastErrorCode === 'TEXT_INPAINT_RESIDUAL' || job?.error === 'TEXT_INPAINT_RESIDUAL') {
    return true;
  }
  if (imagePath && sidecarReportsResidual(imagePath)) return true;
  const outputPath = String(job?.outputPath || '');
  return Boolean(outputPath && sidecarReportsResidual(outputPath));
}

function interiorIsRebuilt(job, imagePath) {
  if (!imagePath || !existsSync(imagePath) || isRawPngPath(imagePath)) return false;
  if (hasTextInpaintResidual(job, imagePath)) return false;
  if (job?.rebuilt === true) return true;
  if (sidecarIsClean(imagePath)) return true;
  if (shouldCleanBakedText(job)) return false;
  return true;
}

function assemblyError(message, code, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function assertExportPageReady(page) {
  const pageNumber = Number(page?.pageNumber) || 0;
  const index = Number(page?.index) || 0;
  const extra = { pageNumber, index, path: page?.path || null, role: page?.role || null };
  if (!page?.path || !existsSync(page.path)) {
    throw assemblyError(
      `Assembly halted: missing file for ${page?.role || 'page'} ${pageNumber}.`,
      'ASSEMBLY_PAGE_MISSING',
      extra
    );
  }
  if (page.role !== 'interior') return page;
  if (hasTextInpaintResidual(page.job, page.path) || page.lastErrorCode === 'TEXT_INPAINT_RESIDUAL') {
    throw assemblyError(
      `Assembly halted: TEXT_INPAINT_RESIDUAL on interior page ${pageNumber}.`,
      'TEXT_INPAINT_RESIDUAL',
      extra
    );
  }
  if (isRawPngPath(page.path)) {
    throw assemblyError(
      `Assembly halted: interior page ${pageNumber} resolved to a raw flat file.`,
      'ASSEMBLY_RAW_FALLBACK_FORBIDDEN',
      extra
    );
  }
  if (page.rebuilt !== true) {
    throw assemblyError(
      `Assembly halted: interior page ${pageNumber} is not rebuilt.`,
      'ASSEMBLY_PAGE_NOT_REBUILT',
      extra
    );
  }
  return page;
}

function buildExportPageArray(project, { validate = true } = {}) {
  const jobs = sortJobsByPage(project?.jobs);
  if (!jobs.length) {
    throw assemblyError('No pages found for document assembly.', 'ASSEMBLY_PAGES_MISSING');
  }
  const outputDir = project?.outputDir || '';
  const pageCount = jobs.length;
  const pages = jobs.map((job, index) => {
    const role = exportPageRole(index, pageCount);
    const path = role === 'interior'
      ? resolveRebuiltInteriorPath(job, outputDir)
      : resolveRawFlatPath(job, outputDir);
    const rebuilt = role === 'interior' ? interiorIsRebuilt(job, path) : false;
    return {
      index,
      pageNumber: Number(job?.pageNumber) || (index + 1),
      role,
      path,
      rebuilt,
      lastErrorCode: job?.lastErrorCode || null,
      job
    };
  });
  if (validate) {
    for (const page of pages) assertExportPageReady(page);
  }
  return pages;
}

function exportPageByNumber(pages, pageNumber) {
  const wanted = Number(pageNumber) || 0;
  return (Array.isArray(pages) ? pages : []).find((page) => page.pageNumber === wanted)
    || (Array.isArray(pages) ? pages[wanted - 1] : null)
    || null;
}

function sourceHash(project) {
  return hash(JSON.stringify([project.id, project.format, project.orientation, project.name, project.theme,
    project.jobs.map(job => [job.id, job.pageNumber, job.prompt, job.storyText, job.imagePrompt])]));
}
function verifyEditableOutput(project) {
  const meta = project.editableOutputJson;
  if (!meta || meta.runId !== project.editableRunId || meta.sourceHash !== sourceHash(project)
    || !Array.isArray(meta.pages) || !meta.pages.length || meta.pages.length !== project.jobs.length
    || new Set(meta.pages.map(p => p.pageId)).size !== meta.pages.length) throw new Error('EDITABLE_OUTPUT_STALE');
  if (hash(readFileSync(meta.pptxPath)) !== meta.pptxHash) throw new Error('EDITABLE_OUTPUT_STALE');
  for (const page of meta.pages) {
    const job = project.jobs.find(job => job.id === page.jobId);
    if (job?.status !== 'complete' || job?.outputPath !== page.outputPath) throw new Error('EDITABLE_OUTPUT_STALE');
    for (const [path, checksum] of [[page.outputPath,page.outputHash],[page.backgroundPath,page.backgroundHash],[page.layoutPath,page.layoutHash]]) {
      if (hash(readFileSync(path)) !== checksum) throw new Error('EDITABLE_OUTPUT_STALE');
    }
  }
  return meta;
}
class ProductFileManager extends FileManager {
  async exportPdf(project, options = {}) {
    // A project whose editable step has not run yet is not stale, just unbuilt:
    // its pages are the queue's own images, which the static PDF path already handles.
    if (detectProductEngine(project) === ENGINE_TYPES.NATIVE_TEXT_EDITABLE && project.editableOutputJson) {
      verifyEditableOutput(project);
    }
    return super.exportPdf(project, options);
  }
  async exportPptx(project, options = {}) {
    // Preferred path: the pages were read locally, so the deck is compiled from the
    // cleaned artwork plus one native text box per detected run - the format a TPT
    // buyer can actually drag and retype in.
    if (options.store) {
      const { collectPageVision } = require('./editable-vision-pages.cjs');
      if (collectPageVision(options.store, project).length) {
        const { buildEditableDeck } = require('./editable-layered-pptx.cjs');
        const built = await buildEditableDeck({ store: options.store, projectId: project.id });
        return built.outputPath;
      }
    }
    if (detectProductEngine(project) !== ENGINE_TYPES.NATIVE_TEXT_EDITABLE) return super.exportPptx(project, options);
    if ((typeof options === 'string' ? options : options.exportMode) === 'BOOKLET_SADDLE_STITCH') throw new Error('EDITABLE_BOOKLET_UNSUPPORTED');
    const manifest = verifyEditableOutput(project);
    const destination = join(project.outputDir, `${bookFileCode(project)}.pptx`);
    await atomicWrite(destination, readFileSync(manifest.pptxPath));
    return destination;
  }
}
function templateFor(project, job, pageId, revisionId) {
  const [width,height] = resolvePageSetup(project.format,project.orientation).points;
  const owner = { projectId:project.id, runId:project.editableRunId, pageId, revisionId };
  return { schemaVersion:2, engineType:ENGINE_TYPES.NATIVE_TEXT_EDITABLE, project:{id:project.id,revision:1},
    runId:owner.runId, revisionId, page:{id:pageId,number:job.pageNumber}, format:project.format,orientation:project.orientation,
    dimensions:{units:'pt',width,height},safeRegions:[{id:'safe',x:36,y:36,width:width-72,height:height-72}],
    textRegions:[{id:'body',safeRegionId:'safe',roles:['title','instruction','paragraph','question','label','number','footer','caption','subtitle'],x:54,y:54,width:width-108,height:height-108}],
    artwork:{id:`${revisionId}-art`,kind:'artwork',owner,reference:`${pageId}.png`},
    textLayout:{id:`${revisionId}-layout`,kind:'layout',owner,reference:`${pageId}.json`}, elements:[] };
}

function deterministicContract(project, job, pageId, revisionId, pageText = null) {
  const contract = templateFor(project, job, pageId, revisionId);
  contract.elements = buildPageElements(project, job, revisionId, contract.textRegions[0].id, pageText);
  return validateEditablePageContract(contract);
}
async function runEditableProject({ store, projectId, onProgress = () => {}, onActivity = () => {}, signal, jobIds = null }) {
  const check = () => { if (signal?.aborted) throw Object.assign(new Error('Editable generation cancelled.'), {code:'STEP_ABORTED'}); };
  check();
  const project = store.lockProductEngine(projectId);
  if (detectProductEngine(project) !== ENGINE_TYPES.NATIVE_TEXT_EDITABLE) throw new Error('EDITABLE_ENGINE_REQUIRED');
  try { const cached = verifyEditableOutput(project); onProgress(100); return cached; } catch {}
  const jobs = [...project.jobs].sort((a,b)=>a.pageNumber-b.pageNumber);
  if (!jobs.length || new Set(jobs.map(j=>j.pageNumber)).size !== jobs.length || jobs.some(j=>!Number.isSafeInteger(j.pageNumber)||j.pageNumber<1)) throw new Error('EDITABLE_PAGE_SEQUENCE_INVALID');
  const mapKey = `editable-page-map:${project.id}:${project.editableRunId}`;
  const pageMap = store.getSetting(mapKey, {});
  for (const job of jobs) if (!pageMap[job.id]) pageMap[job.id] = `A${String(Object.keys(pageMap).length+1).padStart(2,'0')}`;
  store.setSetting(mapKey,pageMap);
  const repository = new EditableRepository(store);
  const pages = [], slides = [];
  const requested = jobIds ? new Set(jobIds) : null;
  if (requested && [...requested].some(id => !jobs.some(job => job.id === id))) throw new Error("JOB_NOT_FOUND");
  const readVerifiedPage = (job, checkpointKey, fingerprint) => {
    const cached = store.getSetting(checkpointKey, null);
    if (!cached || cached.fingerprint !== fingerprint || job.status !== 'complete') throw Error('stale');
    for (const [file,checksum] of [[cached.page.backgroundPath,cached.page.backgroundHash],[cached.page.layoutPath,cached.page.layoutHash],[cached.page.outputPath,cached.page.outputHash]]) {
      if(hash(readFileSync(file))!==checksum)throw Error('stale');
    }
    const current=selectCurrentEditablePair(repository.load(project.id,project.editableRunId,cached.page.pageId).state);
    if (current.owner.revisionId !== cached.page.revisionId) throw Error('stale');
    return cached.page;
  };
  for (const job of jobs) {
    check();
    const pageId = pageMap[job.id];
    const checkpointKey = `editable-page-output:${project.id}:${project.editableRunId}:${job.id}`;
    const fingerprint = sourceHash({...project,jobs:[job]});
    try {
      const page = readVerifiedPage(job, checkpointKey, fingerprint);
      pages.push(page);
      slides.push({pageNumber:job.pageNumber,backgroundPng:readFileSync(page.backgroundPath),layout:JSON.parse(readFileSync(page.layoutPath,'utf8')).layout});
      onProgress(Math.round(pages.length/jobs.length*90));
      continue;
    } catch {}
    if (requested && !requested.has(job.id)) continue;

    onActivity({jobId:job.id,phase:"preparing",attempt:1});
    const revisionId = randomUUID();
    const backgroundPath = locateJobImage(project, job);
    const backgroundPng = readFileSync(backgroundPath);
    const contract = deterministicContract(project, job, pageId, revisionId, readCachedPageText(store, project, job));
    const layout = assertEditableLayoutMatchesContract(contract, resolveLayout(buildDeterministicPageLayout(contract)));

    let loaded = repository.load(project.id,project.editableRunId,pageId);
    const key = {projectId:project.id,runId:project.editableRunId,pageId};
    const advance = command => { loaded = repository.compareAndSwap(key,loaded.token,command,applyEditablePageCommand(loaded.state,command)); };
    if (loaded) {
      const latest = loaded.state.revisions.at(-1);
      if (["DRAFT","GENERATED"].includes(latest.state)) advance({type:"fail-revision",revisionId:latest.id,failure:{code:"INTERRUPTED",message:"Unfinished previous attempt."}});
      if (loaded.state.pageNumber !== job.pageNumber) advance({type:"renumber",pageNumber:job.pageNumber});
      advance({type:"begin-revision",contract});
    } else loaded = repository.insert(createEditablePage(contract));

    const dir = join(project.outputDir,"editable",project.editableRunId,pageId,revisionId);
    await mkdir(dir,{recursive:true});
    const layoutPath = join(dir,`${pageId}.json`);
    const layoutBytes = Buffer.from(JSON.stringify({contract,layout,evidence:{textFree:true,method:"deterministic-template"}}));
    await writeFile(layoutPath,layoutBytes,{flag:"wx"});
    check();
    advance({type:"record-artifact",revisionId,artifact:{...contract.artwork,reference:backgroundPath}});
    advance({type:"record-artifact",revisionId,artifact:{...contract.textLayout,reference:layoutPath}});
    advance({type:"validate-pair",revisionId});
    selectCurrentEditablePair(loaded.state);
    if (sourceHash(store.getProject(project.id)) !== sourceHash(project)) throw new Error("EDITABLE_SOURCE_CHANGED");

    const backgroundHash = hash(backgroundPng);
    const page = {jobId:job.id,pageId,revisionId,backgroundPath,layoutPath,outputPath:backgroundPath,
      pageNumber:job.pageNumber,textBoxes:layout.elements.length,
      backgroundHash,layoutHash:hash(layoutBytes),outputHash:backgroundHash};
    pages.push(page);
    slides.push({pageNumber:job.pageNumber,backgroundPng,layout});
    store.setSetting(checkpointKey,{fingerprint,page});
    onActivity({jobId:job.id,phase:"complete",attempt:1});
    onProgress(Math.round(pages.length/jobs.length*90));
  }
  if (pages.length !== jobs.length) return {partial:true,pages};
  const {buffer}=await assembleEditableEnginePptx(project,slides);
  check();
  const pptxPath=join(project.outputDir,'editable',project.editableRunId,`${randomUUID()}.pptx`);
  await writeFile(pptxPath,buffer,{flag:'wx'});
  const manifest={runId:project.editableRunId,sourceHash:sourceHash(project),pptxPath,pptxHash:hash(buffer),pages};
  check();
  if (sourceHash(store.getProject(project.id))!==manifest.sourceHash) throw new Error('EDITABLE_SOURCE_CHANGED');
  store.db.exec('SAVEPOINT editable_publish');
  try {
    for (const page of pages) store.updateJob(page.jobId,{status:'complete',outputPath:page.outputPath,textOverlays:[]});
    store.updateProject(project.id,{editableOutputJson:manifest,printPdfJson:null,productPdfPath:null,compressedPdfPath:null,tptListing:null,
      stepThumbnailsStatus:'pending',stepPreviewStatus:'pending',stepListingStatus:'pending',stepExportStatus:'pending'});
    store.db.exec('RELEASE SAVEPOINT editable_publish');
  } catch(error) { store.db.exec('ROLLBACK TO SAVEPOINT editable_publish');store.db.exec('RELEASE SAVEPOINT editable_publish');throw error; }
  onProgress(95);
  return manifest;
}
module.exports={
  runEditableProject,verifyEditableOutput,ProductFileManager,templateFor,deterministicContract,locateJobImage,
  ASSEMBLY_RAW_FALLBACK_FORBIDDEN:'ASSEMBLY_RAW_FALLBACK_FORBIDDEN',
  ASSEMBLY_PAGE_NOT_REBUILT:'ASSEMBLY_PAGE_NOT_REBUILT',
  assertExportPageReady,buildExportPageArray,exportPageByNumber,exportPageRole,
  interiorIsRebuilt,isRawPngPath,rawSiblingPath,resolveRawFlatPath,resolveRebuiltInteriorPath,sortJobsByPage
};
