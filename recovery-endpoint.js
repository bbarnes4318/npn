// Add this endpoint to your server.js file
// This creates a web endpoint you can visit to trigger the recovery

app.get('/admin/recovery', async (req, res) => {
  try {
    console.log('🚨 ADMIN RECOVERY TRIGGERED');
    
    const results = {
      startTime: new Date().toISOString(),
      steps: [],
      submissions: [],
      pdfsGenerated: 0,
      errors: []
    };
    
    results.steps.push('Starting production submission recovery...');
    
    // Check directories
    const AGENTS_DIR = process.env.AGENTS_DIR || path.join(__dirname, 'agents');
    const SUBMISSIONS_DIR = process.env.SUBMISSIONS_DIR || path.join(__dirname, 'submissions');
    
    results.steps.push(`AGENTS_DIR: ${AGENTS_DIR}`);
    results.steps.push(`SUBMISSIONS_DIR: ${SUBMISSIONS_DIR}`);
    
    // Check if directories exist
    const agentsExists = await fse.pathExists(AGENTS_DIR);
    const submissionsExists = await fse.pathExists(SUBMISSIONS_DIR);
    
    results.steps.push(`AGENTS_DIR exists: ${agentsExists}`);
    results.steps.push(`SUBMISSIONS_DIR exists: ${submissionsExists}`);
    
    if (!submissionsExists) {
      results.errors.push('SUBMISSIONS_DIR does not exist!');
      return res.json({ ok: false, error: 'SUBMISSIONS_DIR not found', results });
    }
    
    // Find all submissions
    const entries = await fse.readdir(SUBMISSIONS_DIR, { withFileTypes: true });
    results.steps.push(`Found ${entries.length} items in SUBMISSIONS_DIR`);
    
    let processedCount = 0;
    
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      
      const submissionDir = path.join(SUBMISSIONS_DIR, ent.name);
      const files = await fse.readdir(submissionDir);
      
      let submissionData = null;
      let submissionType = 'unknown';
      let contactInfo = {};
      
      // Process intake submission
      if (files.includes('intake.json')) {
        try {
          submissionData = await fse.readJson(path.join(submissionDir, 'intake.json'));
          submissionType = 'intake';
          contactInfo = {
            name: `${submissionData.contact?.firstName || ''} ${submissionData.contact?.lastName || ''}`.trim(),
            email: submissionData.contact?.email || '',
            phone: submissionData.contact?.phone || ''
          };
        } catch (e) {
          results.errors.push(`Error reading intake.json in ${ent.name}: ${e.message}`);
          continue;
        }
      }
      
      // Process W9 submission
      else if (files.includes('w9.json')) {
        try {
          submissionData = await fse.readJson(path.join(submissionDir, 'w9.json'));
          submissionType = 'w9';
          contactInfo = {
            name: submissionData.name || '',
            email: submissionData.email || '',
            phone: submissionData.phone || ''
          };
        } catch (e) {
          results.errors.push(`Error reading w9.json in ${ent.name}: ${e.message}`);
          continue;
        }
      }
      
      // Process banking submission
      else if (files.includes('banking.json')) {
        try {
          submissionData = await fse.readJson(path.join(submissionDir, 'banking.json'));
          submissionType = 'banking';
          contactInfo = {
            name: `${submissionData.firstName || ''} ${submissionData.lastName || ''}`.trim(),
            email: submissionData.email || '',
            phone: submissionData.phone || ''
          };
        } catch (e) {
          results.errors.push(`Error reading banking.json in ${ent.name}: ${e.message}`);
          continue;
        }
      }
      
      // Process packet submission
      else if (files.includes('packet.json')) {
        try {
          submissionData = await fse.readJson(path.join(submissionDir, 'packet.json'));
          submissionType = 'packet';
          contactInfo = {
            name: 'Packet Submission',
            email: '',
            phone: ''
          };
        } catch (e) {
          results.errors.push(`Error reading packet.json in ${ent.name}: ${e.message}`);
          continue;
        }
      }
      
      if (submissionData) {
        results.submissions.push({
          id: ent.name,
          type: submissionType,
          contact: contactInfo,
          receivedAt: submissionData.receivedAt || submissionData.id,
          files: files
        });
        
        results.steps.push(`Found ${submissionType} submission: ${ent.name} - ${contactInfo.name} (${contactInfo.email})`);
        
        // Create agent record
        const agent = {
          id: nanoid(10),
          createdAt: new Date().toISOString(),
          profile: {
            firstName: contactInfo.name.split(' ')[0] || '',
            lastName: contactInfo.name.split(' ').slice(1).join(' ') || '',
            email: contactInfo.email || `${ent.name}@submission.local`,
            phone: contactInfo.phone || ''
          },
          progress: {},
          submissions: {},
          signatures: {},
          uploads: {}
        };
        
        // Generate PDF
        let pdfBuffer = null;
        let pdfFileName = '';
        
        if (submissionType === 'intake') {
          pdfBuffer = await generateIntakePdf(submissionData, agent);
          pdfFileName = `SIGNED_INTAKE_DOCUMENTS_${Date.now()}.pdf`;
          agent.progress.intakeSubmitted = true;
          agent.submissions.intakeId = ent.name;
        } else if (submissionType === 'w9') {
          pdfBuffer = await generateW9Pdf(submissionData);
          pdfFileName = `SIGNED_W9_FORM_${Date.now()}.pdf`;
          agent.progress.w9Submitted = true;
          agent.submissions.w9Id = ent.name;
        } else if (submissionType === 'banking') {
          pdfBuffer = await generateBankingPdf(submissionData);
          pdfFileName = `SIGNED_BANKING_FORM_${Date.now()}.pdf`;
          agent.progress.bankingSubmitted = true;
          agent.submissions.bankingId = ent.name;
        }
        
        if (pdfBuffer) {
          // Save agent record
          const agentDir = path.join(AGENTS_DIR, agent.id);
          await fse.ensureDir(agentDir);
          await fse.writeJson(path.join(agentDir, 'agent.json'), agent, { spaces: 2 });
          
          // Save PDF
          const pdfPath = path.join(agentDir, pdfFileName);
          await fse.writeFile(pdfPath, pdfBuffer);
          
          // Update agent with PDF path
          agent.submissions[`${submissionType}PdfPath`] = pdfPath;
          await fse.writeJson(path.join(agentDir, 'agent.json'), agent, { spaces: 2 });
          
          results.steps.push(`✅ Generated ${submissionType} PDF for ${contactInfo.name}`);
          results.pdfsGenerated++;
        }
        
        processedCount++;
      }
    }
    
    results.steps.push(`🎉 PROCESSING COMPLETE!`);
    results.steps.push(`📊 Processed: ${processedCount} submissions`);
    results.steps.push(`📄 Generated: ${results.pdfsGenerated} signed PDFs`);
    
    results.endTime = new Date().toISOString();
    
    res.json({ 
      ok: true, 
      message: 'Recovery completed successfully!',
      results 
    });
    
  } catch (e) {
    console.error('Recovery error:', e);
    res.status(500).json({ 
      ok: false, 
      error: e.message,
      results: { errors: [e.message] }
    });
  }
});

// Helper function to generate intake PDF
async function generateIntakePdf(submission, agent) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    
    doc.on('data', (b) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    
    doc.fontSize(20).font('Helvetica-Bold').text('SIGNED INTAKE DOCUMENTS', 50, 50, { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('Life Assurance Solutions LLC & JJN Protection Insurance Agency LLC', 50, 80, { align: 'center' });
    
    let y = 120;
    
    if (submission.contact) {
      doc.fontSize(14).font('Helvetica-Bold').text('CONTACT INFORMATION', 50, y);
      y += 30;
      doc.fontSize(12).font('Helvetica').text(`Name: ${submission.contact.firstName || ''} ${submission.contact.lastName || ''}`, 50, y);
      y += 20;
      doc.text(`Email: ${submission.contact.email || ''}`, 50, y);
      y += 20;
      doc.text(`Phone: ${submission.contact.phone || ''}`, 50, y);
      y += 30;
    }
    
    if (submission.business) {
      doc.fontSize(14).font('Helvetica-Bold').text('BUSINESS INFORMATION', 50, y);
      y += 30;
      doc.fontSize(12).font('Helvetica').text(`Agency: ${submission.business.agencyName || ''}`, 50, y);
      y += 20;
      doc.text(`Address: ${submission.business.address1 || ''}`, 50, y);
      y += 20;
      doc.text(`${submission.business.city || ''}, ${submission.business.state || ''} ${submission.business.zip || ''}`, 50, y);
      y += 30;
    }
    
    doc.fontSize(12).font('Helvetica').text(`NPN: ${submission.npn || ''}`, 50, y);
    y += 20;
    doc.text(`States Licensed: ${Array.isArray(submission.statesLicensed) ? submission.statesLicensed.join(', ') : submission.statesLicensed || ''}`, 50, y);
    y += 30;
    
    if (submission.acknowledgments) {
      doc.fontSize(14).font('Helvetica-Bold').text('SIGNATURE', 50, y);
      y += 30;
      doc.fontSize(12).font('Helvetica').text(`Signature: ${submission.acknowledgments.signature || ''}`, 50, y);
      y += 20;
      doc.text(`Date: ${submission.acknowledgments.signatureDate || ''}`, 50, y);
    }
    
    doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`, 50, y + 30);
    doc.text(`Submission ID: ${submission.id}`, 50, y + 45);
    
    doc.end();
  });
}

// Helper function to generate W9 PDF
async function generateW9Pdf(submission) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    
    doc.on('data', (b) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    
    doc.fontSize(20).font('Helvetica-Bold').text('SIGNED W-9 FORM', 50, 50, { align: 'center' });
    
    let y = 100;
    
    doc.fontSize(14).font('Helvetica-Bold').text('TAXPAYER INFORMATION', 50, y);
    y += 30;
    doc.fontSize(12).font('Helvetica').text(`Name: ${submission.name || ''}`, 50, y);
    y += 20;
    doc.text(`Business Name: ${submission.businessName || ''}`, 50, y);
    y += 20;
    doc.text(`Address: ${submission.address || ''}`, 50, y);
    y += 20;
    doc.text(`City, State ZIP: ${submission.city || ''}, ${submission.state || ''} ${submission.zip || ''}`, 50, y);
    y += 30;
    
    doc.fontSize(14).font('Helvetica-Bold').text('TAX INFORMATION', 50, y);
    y += 30;
    doc.fontSize(12).font('Helvetica').text(`SSN: ${submission.ssn || ''}`, 50, y);
    y += 20;
    doc.text(`EIN: ${submission.ein || ''}`, 50, y);
    y += 30;
    
    doc.fontSize(14).font('Helvetica-Bold').text('SIGNATURE', 50, y);
    y += 30;
    doc.fontSize(12).font('Helvetica').text(`Signature: ${submission.signature || ''}`, 50, y);
    y += 20;
    doc.text(`Date: ${submission.signatureDate || ''}`, 50, y);
    
    doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`, 50, y + 30);
    doc.text(`Submission ID: ${submission.id}`, 50, y + 45);
    
    doc.end();
  });
}

// Helper function to generate banking PDF
async function generateBankingPdf(submission) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    
    doc.on('data', (b) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    
    doc.fontSize(20).font('Helvetica-Bold').text('SIGNED BANKING FORM', 50, 50, { align: 'center' });
    
    let y = 100;
    
    doc.fontSize(14).font('Helvetica-Bold').text('PERSONAL INFORMATION', 50, y);
    y += 30;
    doc.fontSize(12).font('Helvetica').text(`Name: ${submission.firstName || ''} ${submission.lastName || ''}`, 50, y);
    y += 20;
    doc.text(`Address: ${submission.streetAddress || ''}`, 50, y);
    y += 20;
    doc.text(`City, State ZIP: ${submission.city || ''}, ${submission.state || ''} ${submission.zipCode || ''}`, 50, y);
    y += 20;
    doc.text(`SSN: ${submission.ssn || ''}`, 50, y);
    y += 30;
    
    doc.fontSize(14).font('Helvetica-Bold').text('BANKING INFORMATION', 50, y);
    y += 30;
    doc.fontSize(12).font('Helvetica').text(`Bank Name: ${submission.bankName || ''}`, 50, y);
    y += 20;
    doc.text(`Routing Number: ${submission.routingNumber || ''}`, 50, y);
    y += 20;
    doc.text(`Account Number: ${submission.accountNumber || ''}`, 50, y);
    y += 20;
    doc.text(`Account Type: ${submission.accountType || ''}`, 50, y);
    y += 30;
    
    doc.fontSize(14).font('Helvetica-Bold').text('SIGNATURE', 50, y);
    y += 30;
    doc.fontSize(12).font('Helvetica').text(`Signature: ${submission.digitalSignature || ''}`, 50, y);
    y += 20;
    doc.text(`Date: ${submission.signatureDate || ''}`, 50, y);
    
    doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`, 50, y + 30);
    doc.text(`Submission ID: ${submission.id}`, 50, y + 45);
    
    doc.end();
  });
}
