'use strict';

const { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } = require('node:fs');
const { basename, join, relative, resolve, sep } = require('node:path');

const WORKING_DIRS = new Set([
  'editable',
  'editable-pages',
  'maze',
  'competitor-mockups',
  'tpt-thumbnails',
  'tpt-preview',
  'tpt-assets',
  'product-reference',
  'seo',
  'jobs',
  'references',
  'canva-import'
]);

let workspaceRootPath = null;

function setWorkspaceRoot(userDataPath) {
  if (!userDataPath) {
    workspaceRootPath = null;
    return null;
  }
  workspaceRootPath = join(userDataPath, 'workspace');
  mkdirSync(workspaceRootPath, { recursive: true });
  return workspaceRootPath;
}

function getWorkspaceRoot() {
  return workspaceRootPath;
}

function projectWorkspaceDir(projectId) {
  if (!workspaceRootPath || !projectId) return null;
  return join(workspaceRootPath, String(projectId));
}

function pageWorkspaceDir(projectId) {
  const root = projectWorkspaceDir(projectId);
  return root ? join(root, 'pages') : null;
}

function resolvePageSaveDir(project) {
  const dir = pageWorkspaceDir(project?.id);
  if (dir) {
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  return project?.outputDir || null;
}

function isPublishDeliverable(name) {
  return /\.(pdf|pptx|docx|zip)$/i.test(String(name || ''));
}

function _inside(root, filePath) {
  const relativePath = relative(resolve(root), resolve(filePath));
  return relativePath && !relativePath.startsWith('..') && !relativePath.startsWith(sep);
}

function _moveFile(from, to) {
  mkdirSync(require('node:path').dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch {
    copyFileSync(from, to);
    unlinkSync(from);
  }
}

function migrateProjectWorkingFiles(store, project) {
  const outputDir = project?.outputDir;
  const workspace = projectWorkspaceDir(project?.id);
  if (!outputDir || !workspace || !existsSync(outputDir)) {
    return { moved: 0, jobs: 0 };
  }
  const pageDir = join(workspace, 'pages');
  mkdirSync(pageDir, { recursive: true });
  let moved = 0;
  let jobs = 0;

  for (const job of project.jobs || []) {
    const current = String(job.outputPath || '');
    if (!current || !_inside(outputDir, current) || isPublishDeliverable(current)) continue;
    const dest = join(pageDir, basename(current));
    if (existsSync(current) && resolve(current) !== resolve(dest)) {
      if (!existsSync(dest)) _moveFile(current, dest);
      else unlinkSync(current);
      moved += 1;
    }
    if (existsSync(dest)) {
      if (store?.updateJob) store.updateJob(job.id, { outputPath: dest });
      job.outputPath = dest;
      jobs += 1;
    }
  }

  for (const name of readdirSync(outputDir)) {
    if (name === '.DS_Store' || name.startsWith('.')) continue;
    const source = join(outputDir, name);
    let info;
    try { info = statSync(source); } catch { continue; }
    if (info.isDirectory()) {
      if (!WORKING_DIRS.has(name)) continue;
      const dest = join(workspace, name);
      if (existsSync(dest)) {
        rmSync(source, { recursive: true, force: true });
      } else {
        _moveFile(source, dest);
      }
      moved += 1;
      continue;
    }
    if (isPublishDeliverable(name)) continue;
    const dest = join(pageDir, name);
    if (existsSync(dest)) {
      unlinkSync(source);
    } else {
      _moveFile(source, dest);
    }
    moved += 1;
  }

  return { moved, jobs };
}

module.exports = {
  setWorkspaceRoot,
  getWorkspaceRoot,
  projectWorkspaceDir,
  pageWorkspaceDir,
  resolvePageSaveDir,
  isPublishDeliverable,
  migrateProjectWorkingFiles,
  WORKING_DIRS
};
