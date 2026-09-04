import re

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/file-manager.cjs"
with open(filepath, "r") as f:
    content = f.read()

# Find the end of exportPdf
# We can search for the end of exportPdf which looks like:
#     await atomicWrite(outputPath, Buffer.from(await pdf.save()));
#     return outputPath;
#   }
# 
# }
# module.exports = {

match = re.search(r'await atomicWrite\(outputPath, Buffer\.from\(await pdf\.save\(\)\)\);\n\s*return outputPath;\n\s*\}', content)
if not match:
    print("Could not find end of exportPdf")
else:
    end_index = match.end()
    pptx_method = """

  async exportPptx(project, options = {}) {
    if (project.stats.complete !== project.stats.total) {
      throw Object.assign(new Error('PPTX export is locked until every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }
    const PptxGenJS = require('pptxgenjs');
    const pres = new PptxGenJS();
    pres.title = project.name;
    pres.subject = project.theme;

    const setup = resolvePageSetup(project.format, project.orientation);
    
    const widthInches = setup.points[0] / 72;
    const heightInches = setup.points[1] / 72;
    
    pres.defineLayout({
      name: 'CUSTOM',
      width: widthInches,
      height: heightInches
    });
    pres.layout = 'CUSTOM';

    const slug = project.name.replace(/[^a-z0-9_-]+/gi, '-') || 'pod-network-book';
    const pptxName = `${slug}.pptx`;
    const outputPath = require('node:path').join(project.outputDir, pptxName);

    for (const job of project.jobs) {
      const slide = pres.addSlide();
      
      const pngBuffer = await require('fs/promises').readFile(job.outputPath);
      const base64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;
      
      slide.addImage({
        data: base64,
        x: 0,
        y: 0,
        w: widthInches,
        h: heightInches
      });

      if (job.storyText) {
        slide.addNotes(job.storyText);
      }
    }
    
    const buffer = await pres.write({ outputType: 'nodebuffer' });
    await atomicWrite(outputPath, buffer);
    return outputPath;
  }"""
    
    new_content = content[:end_index] + pptx_method + content[end_index:]
    with open(filepath, "w") as f:
        f.write(new_content)
    print("Added exportPptx successfully")
