import re

# 1. Patch preload.cjs
preload_path = "src/preload.cjs"
with open(preload_path, "r") as f:
    content = f.read()

content = content.replace(
    "exportPdf: (projectId, options) => ipcRenderer.invoke('project:export-pdf', projectId, options),",
    "exportPdf: (projectId, options) => ipcRenderer.invoke('project:export-pdf', projectId, options),\n  exportPptx: (projectId, options) => ipcRenderer.invoke('project:export-pptx', projectId, options),"
)
with open(preload_path, "w") as f:
    f.write(content)


# 2. Patch renderer.js
renderer_path = "renderer/renderer.js"
with open(renderer_path, "r") as f:
    content = f.read()

# Add element ID
content = content.replace("'export-zip-button',", "'export-zip-button', 'export-pptx-button',")
# Change autoStep string
content = content.replace("if (stepLabel === 'export') stepLabel = 'PDF & ZIP Exporting';", "if (stepLabel === 'export') stepLabel = 'PDF, ZIP & PPTX Exporting';")

# Add disabled logic
content = content.replace("elements.exportZipButton.disabled = !canExport;", "elements.exportZipButton.disabled = !canExport;\n  elements.exportPptxButton.disabled = !canExport;")

# Add action handler
action_handler = """  if (action === 'export-pptx') {
    const exportMode = elements.exportModeSelect?.value || 'STANDARD_SEQUENTIAL';
    const label = exportMode === 'BOOKLET_SADDLE_STITCH' ? 'Booklet Spreads PPTX created.' : 'PPTX created.';
    const path = await invoke(() => api.exportPptx(project.id, { exportMode }), { successMessage: label });
    if (path) openItem(path);
    return;
  }
"""
content = content.replace("if (action === 'export-zip') {", action_handler + "  if (action === 'export-zip') {")

# Add click listener
click_listener = "elements.exportPptxButton.addEventListener('click', () => handleAction('export-pptx', elements.exportPptxButton).catch(() => {}));\n"
content = content.replace("elements.exportZipButton.addEventListener('click', () => handleAction('export-zip', elements.exportZipButton).catch(() => {}));",
                          "elements.exportZipButton.addEventListener('click', () => handleAction('export-zip', elements.exportZipButton).catch(() => {}));\n" + click_listener)

with open(renderer_path, "w") as f:
    f.write(content)


# 3. Patch index.html
html_path = "renderer/index.html"
with open(html_path, "r") as f:
    content = f.read()

content = content.replace('<button id="export-zip-button" class="button button-ghost" type="button" disabled>Export ZIP</button>',
                          '<button id="export-zip-button" class="button button-ghost" type="button" disabled>Export ZIP</button>\n                    <button id="export-pptx-button" class="button button-ghost" type="button" disabled>Export PPTX</button>')

content = content.replace("<strong>6. PDF &amp; ZIP Exporting</strong>", "<strong>6. PDF, ZIP &amp; PPTX Exporting</strong>")

with open(html_path, "w") as f:
    f.write(content)

print("UI patches applied.")
