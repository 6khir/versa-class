import re

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/main.cjs"
with open(filepath, "r") as f:
    content = f.read()

pptx_handler = """  ipcMain.handle('project:export-pptx', async (_event, projectId, options) => {
    const project = store.getProject(projectId);
    const outputPath = await fileManager.exportPptx(project, options);
    store.appendEvent({ projectId, level: 'success', message: `PPTX created: ${outputPath}` });
    await broadcastState();
    return outputPath;
  });
"""

content = content.replace("  ipcMain.handle('project:export-zip', async (_event, projectId, options) => {", pptx_handler + "\n  ipcMain.handle('project:export-zip', async (_event, projectId, options) => {")

# In export-all-files
content = content.replace("await fileManager.exportZip(project, options);", "await fileManager.exportZip(project, options);\n    await fileManager.exportPptx(project, options);")

# Wait, there are more places. Pipeline steps?
# "export: async (projectId, onProgress) => {"
# PIPELINE_STEPS has "export: async (projectId, onProgress) => {"
# Let's see if export steps also need exportPptx.
