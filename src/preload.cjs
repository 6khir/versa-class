const { contextBridge, ipcRenderer } = require('electron');

function engineIpcArg(value) {
  if (value && typeof value === 'object') return value.target ?? value.engine ?? null;
  return value ?? null;
}

contextBridge.exposeInMainWorld('tptDesktop', {
  getState: () => ipcRenderer.invoke('state:get'),
  setAppearance: (appearance) => ipcRenderer.invoke('settings:set-appearance', appearance),
  selectProject: (projectId) => ipcRenderer.invoke('project:select', projectId),
  setProjectFormat: (projectId, productFormat) => ipcRenderer.invoke('project:set-format', projectId, productFormat),
  createProject: (input) => ipcRenderer.invoke('project:create', input),
  chooseOutputDirectory: (projectId) => ipcRenderer.invoke('project:choose-output', projectId),
  launchBrowser: () => ipcRenderer.invoke('browser:launch'),
  openLoginBrowser: (target) => ipcRenderer.invoke('browser:open-login', engineIpcArg(target)),
  // Canva Dashboard bridges (manual steps)
  uploadPdf: (projectId, pdfPath) => ipcRenderer.invoke('canva:upload-pdf', projectId, pdfPath),
  runMagicLayers: (projectId, pageIndex) => ipcRenderer.invoke('canva:run-magic', projectId, pageIndex),
  approveMagicLayers: (projectId, pageIndex) => ipcRenderer.invoke('canva:approve-magic', projectId, pageIndex),
  finalizeCanvaTemplate: (projectId) => ipcRenderer.invoke('canva:finalize-template', projectId),
  startCanvaTelemetry: () => ipcRenderer.invoke('canva:startTelemetry'),
  stopCanvaTelemetry: () => ipcRenderer.invoke('canva:stopTelemetry'),
  copyToClipboard: (text) => ipcRenderer.invoke('util:copy', text),
  verifyChatGptLogin: (target) => ipcRenderer.invoke('browser:verify-login', engineIpcArg(target)),
  logoutChatGpt: () => ipcRenderer.invoke('browser:logout-chatgpt'),
  logoutGemini: () => ipcRenderer.invoke('browser:logout-gemini'),
  logoutMeta: () => ipcRenderer.invoke('browser:logout-meta'),
  logoutCanva: () => ipcRenderer.invoke('browser:logout-canva'),
  getCanvaTemplates: () => ipcRenderer.invoke('settings:get-canva-templates'),
  setCanvaTemplates: (templates) => ipcRenderer.invoke('settings:set-canva-templates', templates),
  updateSettings: (input) => ipcRenderer.invoke('settings:update', input),
  saveSupabaseSettings: (input) => ipcRenderer.invoke('settings:set-supabase', input),
  runCanvaEditable: (projectId, options) => ipcRenderer.invoke('project:run-canva-editable', projectId, options),
  runCanvaDryRun: (projectId) => ipcRenderer.invoke('project:canva-dry-run', projectId),
  canvaHealthCheck: (projectId) => ipcRenderer.invoke('project:canva-health-check', projectId),
  pauseCanvaJob: () => ipcRenderer.invoke('canva:pause-job'),
  resumeCanvaJob: () => ipcRenderer.invoke('canva:resume-job'),
  retryCanvaStep: () => ipcRenderer.invoke('canva:retry-step'),
  retryCanvaPage: () => ipcRenderer.invoke('canva:retry-page'),
  resumeCanvaFromPage: (pageNumber) => ipcRenderer.invoke('canva:resume-from-page', pageNumber),
  abortCanvaJob: () => ipcRenderer.invoke('canva:abort'),
  resolveCanvaIntervention: (decision) => ipcRenderer.invoke('canva:resolve-intervention', decision),
  clearCanvaTemplate: (projectId) => ipcRenderer.invoke('project:clear-canva-template', projectId),
  clearTptListing: (projectId) => ipcRenderer.invoke('project:clear-tpt-listing', projectId),
  clearTptThumbnail: (projectId, index) => ipcRenderer.invoke('project:clear-tpt-thumbnail', projectId, index),
  clearTptThumbnails: (projectId) => ipcRenderer.invoke('project:clear-tpt-thumbnails', projectId),
  clearCompetitorMockups: (projectId) => ipcRenderer.invoke('project:clear-competitor-mockups', projectId),
  clearJobImage: (jobId) => ipcRenderer.invoke('job:clear-image', jobId),
  getProfileRotation: () => ipcRenderer.invoke('profiles:get-rotation'),
  setProfileRotation: (payload) => ipcRenderer.invoke('profiles:set-rotation', payload),
  switchNextProfile: () => ipcRenderer.invoke('profiles:switch-next'),
  setAiEngine: (engine) => ipcRenderer.invoke('settings:set-ai-engine', engine),
  testMetaConnection: () => ipcRenderer.invoke('settings:test-meta-connection'),
  getSystemProfiles: () => ipcRenderer.invoke('browser:get-system-profiles'),
  setSelectedProfile: (profile) => ipcRenderer.invoke('browser:set-selected-profile', profile),
  openCustomGpt: () => ipcRenderer.invoke('browser:open-studio', 'planning'),
  openMockupsGpt: () => ipcRenderer.invoke('browser:open-studio', 'mockups-gpt'),
  openStudio: (studioId) => ipcRenderer.invoke('browser:open-studio', studioId),
  bringBrowserToFront: () => ipcRenderer.invoke('browser:focus'),
  // #region agent log
  debugAgentLog: (payload) => ipcRenderer.invoke('debug:agent-log', payload),
  // #endregion
  openJobConversation: (jobId) => ipcRenderer.invoke('browser:open-job', jobId),
  startQueue: (projectId) => ipcRenderer.invoke('queue:start', projectId),
  pauseQueue: () => ipcRenderer.invoke('queue:pause'),
  retryJob: (jobId) => ipcRenderer.invoke('queue:retry-job', jobId),
  retryAll: (projectId) => ipcRenderer.invoke('queue:retry-all', projectId),
  importPageImage: (jobId) => ipcRenderer.invoke('job:import-image', jobId),
  requestPageEdit: (jobId, instruction) => ipcRenderer.invoke('job:request-edit', jobId, instruction),
  requestPageRegeneration: (jobId) => ipcRenderer.invoke('job:request-regeneration', jobId),
  reprocessPageImage: (jobId, zoom, offsetX, offsetY) => ipcRenderer.invoke('job:reprocess-image', jobId, zoom, offsetX, offsetY),
  exportPdf: (projectId, options) => ipcRenderer.invoke('project:export-pdf', projectId, options),
  exportZip: (projectId, options) => ipcRenderer.invoke('project:export-zip', projectId, options),
  exportPptx: (projectId, options) => ipcRenderer.invoke('project:export-pptx', projectId, options),
  exportAllFiles: (projectId, options) => ipcRenderer.invoke('project:export-all-files', projectId, options),
  generateTptListing: (projectId) => ipcRenderer.invoke('project:generate-tpt-listing', projectId),
  generateTptThumbnails: (projectId) => ipcRenderer.invoke('project:generate-tpt-thumbnails', projectId),
  generateTptPreviewVideo: (projectId, options) => ipcRenderer.invoke('project:generate-tpt-preview-video', projectId, options),
  regenerateTptField: (projectId, field) => ipcRenderer.invoke('project:regenerate-tpt-field', projectId, field),
  updateTptPublication: (projectId, settings) => ipcRenderer.invoke('project:update-tpt-publication', projectId, settings),
  chooseTptAsset: (projectId, assetType) => ipcRenderer.invoke('project:choose-tpt-asset', projectId, assetType),
  clearTptAsset: (projectId, assetType) => ipcRenderer.invoke('project:clear-tpt-asset', projectId, assetType),
  regenerateTptThumbnail: (projectId, index) => ipcRenderer.invoke('project:regenerate-tpt-thumbnail', projectId, index),
  markTptReady: (projectId) => ipcRenderer.invoke('project:mark-tpt-ready', projectId),
  openTptUpload: () => ipcRenderer.invoke('tpt:open-upload'),
  completeTptHumanVerification: () => ipcRenderer.invoke('tpt:complete-human-verification'),
  openSavedTptListing: (listingUrl) => ipcRenderer.invoke('tpt:open-saved-listing', listingUrl),
  startTptUploading: (projectId) => ipcRenderer.invoke('project:start-tpt-upload', projectId),
  submitTptListing: (projectId) => ipcRenderer.invoke('project:submit-tpt-listing', projectId),
  submitTptDraft: (projectId) => ipcRenderer.invoke('project:submit-tpt-draft', projectId),
  startBundleUpload: () => ipcRenderer.invoke('bundle-upload:start'),
  stopBundleUpload: () => ipcRenderer.invoke('bundle-upload:stop'),
  renameProject: (projectId, newName) => ipcRenderer.invoke('project:rename', projectId, newName),
  deleteProject: (projectId) => ipcRenderer.invoke('project:delete', projectId),
  setWhenCompleteAction: (action) => ipcRenderer.invoke('project:set-when-complete', action),
  cancelSystemAction: () => ipcRenderer.invoke('app:cancel-system-action'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-update'),
  installUpdate: (options) => ipcRenderer.invoke('app:install-update', options),
  fetchAnnouncement: () => ipcRenderer.invoke('announcement:fetch'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  exportGuidePdf: (language) => ipcRenderer.invoke('guide:export-pdf', language),
  analyzeProduct: (input) => ipcRenderer.invoke('analysis:analyze', input),
  generatePromptsAndCreateProject: (payload) => ipcRenderer.invoke('analysis:generate-prompts', payload),
  generateStorybook: (input) => ipcRenderer.invoke('analysis:generate-storybook', input),
  retryStorybookPhase2: (projectId) => ipcRenderer.invoke('analysis:retry-storybook-phase2', projectId),
  generateCharacterSheet: (projectId, characterIndex) => ipcRenderer.invoke('storybook:generate-character-sheet', projectId, characterIndex),
  generateAllCharacterSheets: (projectId) => ipcRenderer.invoke('storybook:generate-all-character-sheets', projectId),
  revealPath: (path) => ipcRenderer.invoke('path:reveal', path),
  onComplete: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('notification:complete', listener);
    return () => ipcRenderer.removeListener('notification:complete', listener);
  },
  onStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  },
  onHeartbeat: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('queue:heartbeat', listener);
    return () => ipcRenderer.removeListener('queue:heartbeat', listener);
  },
  onLoginProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('browser:login-progress', listener);
    return () => ipcRenderer.removeListener('browser:login-progress', listener);
  },
  onStorybookPhase1: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('storybook:phase1-ready', listener);
    return () => ipcRenderer.removeListener('storybook:phase1-ready', listener);
  },
  // Automation pipeline
  startAutomation: (projectId) => ipcRenderer.invoke('automation:start', projectId),
  pauseAutomation: () => ipcRenderer.invoke('automation:pause'),
  getAutomationStatus: () => ipcRenderer.invoke('automation:status'),
  resolveAutomationAsk: (decision) => ipcRenderer.invoke('automation:resolve_ask', decision),
  getAutomationSettings: () => ipcRenderer.invoke('automation:get-settings'),
  updateAutomationSetting: (stepName, mode) => ipcRenderer.invoke('automation:update-setting', stepName, mode),
  onAutomationProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('automation:progress', listener);
    return () => ipcRenderer.removeListener('automation:progress', listener);
  },
  onAutomationAskRequired: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('automation:ask_required', listener);
    return () => ipcRenderer.removeListener('automation:ask_required', listener);
  },
  onAutomationNotification: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('automation:notify', listener);
    return () => ipcRenderer.removeListener('automation:notify', listener);
  },
  onCanvaIntervention: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('canva:intervention', listener);
    return () => ipcRenderer.removeListener('canva:intervention', listener);
  }
});
