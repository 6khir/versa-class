import re

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/file-manager.cjs"
with open(filepath, "r") as f:
    content = f.read()

pptx_old = """  async exportPptx(project, options = {}) {
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

pptx_new = """  async exportPptx(project, options = {}) {
    if (project.stats.complete !== project.stats.total) {
      throw Object.assign(new Error('PPTX export is locked until every page is complete.'), { code: 'BOOK_INCOMPLETE' });
    }
    const mode = typeof options === 'string'
      ? options
      : (options && options.exportMode) ? options.exportMode : 'STANDARD_SEQUENTIAL';
    const isBooklet = mode === 'BOOKLET_SADDLE_STITCH';

    const PptxGenJS = require('pptxgenjs');
    const pres = new PptxGenJS();
    pres.title = project.name;
    pres.subject = project.theme;

    const setup = resolvePageSetup(project.format, project.orientation);
    
    const widthInches = (isBooklet ? setup.points[0] * 2 : setup.points[0]) / 72;
    const heightInches = setup.points[1] / 72;
    
    pres.defineLayout({
      name: 'CUSTOM',
      width: widthInches,
      height: heightInches
    });
    pres.layout = 'CUSTOM';

    const slug = project.name.replace(/[^a-z0-9_-]+/gi, '-') || 'pod-network-book';
    const pptxName = isBooklet ? `${slug}-booklet.pptx` : `${slug}.pptx`;
    const outputPath = require('node:path').join(project.outputDir, pptxName);

    if (isBooklet) {
      const imposition = calculateSaddleStitchSpreads(project.jobs.length);
      for (const spread of imposition.spreads) {
        const leftJob = project.jobs[spread.leftPage - 1];
        const rightJob = project.jobs[spread.rightPage - 1];

        const leftPng = leftJob && require('node:fs').existsSync(leftJob.outputPath) ? await require('node:fs/promises').readFile(leftJob.outputPath) : null;
        const rightPng = rightJob && require('node:fs').existsSync(rightJob.outputPath) ? await require('node:fs/promises').readFile(rightJob.outputPath) : null;

        const spreadPng = await createSpreadPng({
          leftPng,
          rightPng,
          format: project.format,
          orientation: project.orientation
        });

        const slide = pres.addSlide();
        const base64 = `data:image/png;base64,${spreadPng.toString('base64')}`;
        slide.addImage({ data: base64, x: 0, y: 0, w: widthInches, h: heightInches });

        let notes = [];
        if (leftJob && leftJob.storyText) notes.push(`Left Page (${leftJob.pageLabel}): ${leftJob.storyText}`);
        if (rightJob && rightJob.storyText) notes.push(`Right Page (${rightJob.pageLabel}): ${rightJob.storyText}`);
        if (notes.length > 0) slide.addNotes(notes.join('\\n\\n'));
      }
    } else {
      for (const job of project.jobs) {
        const slide = pres.addSlide();
        
        const pngBuffer = await require('node:fs/promises').readFile(job.outputPath);
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
    }
    
    const buffer = await pres.write({ outputType: 'nodebuffer' });
    await atomicWrite(outputPath, buffer);
    return outputPath;
  }"""
content = content.replace(pptx_old, pptx_new)

with open(filepath, "w") as f:
    f.write(content)
