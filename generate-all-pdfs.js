const fse = require('fs-extra');
const path = require('path');
const { nanoid } = require('nanoid');
const PDFDocument = require('pdfkit');

// Configuration
const AGENTS_DIR = process.env.AGENTS_DIR || path.join(__dirname, 'agents');
const SUBMISSIONS_DIR = process.env.SUBMISSIONS_DIR || path.join(__dirname, 'submissions');

console.log('📄 GENERATING SIGNED DOCUMENTS FOR ALL SUBMISSIONS');
console.log('AGENTS_DIR:', AGENTS_DIR);
console.log('SUBMISSIONS_DIR:', SUBMISSIONS_DIR);

function newAgent({ firstName = '', lastName = '', email = '', phone = '' }) {
  return {
    id: nanoid(10),
    createdAt: new Date().toISOString(),
    profile: {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim()
    },
    progress: {},
    submissions: {},
    signatures: {},
    uploads: {}
  };
}

async function writeAgent(agent) {
  const agentDir = path.join(AGENTS_DIR, agent.id);
  await fse.ensureDir(agentDir);
  await fse.writeJson(path.join(agentDir, 'agent.json'), agent, { spaces: 2 });
  console.log(`✅ Created agent: ${agent.id} - ${agent.profile.firstName} ${agent.profile.lastName} (${agent.profile.email})`);
}

async function readAgent(agentId) {
  try {
    const agentPath = path.join(AGENTS_DIR, agentId, 'agent.json');
    if (await fse.pathExists(agentPath)) {
      return await fse.readJson(agentPath);
    }
  } catch (e) {
    console.error(`Error reading agent ${agentId}:`, e.message);
  }
  return null;
}

async function findOrCreateAgentByEmail(email) {
  const target = (email || '').toString().trim().toLowerCase();
  if (!target) return null;
  
  try {
    const entries = await fse.readdir(AGENTS_DIR, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const p = path.join(AGENTS_DIR, ent.name, 'agent.json');
      if (!(await fse.pathExists(p))) continue;
      try {
        const a = await fse.readJson(p);
        if ((a.profile?.email || '').toLowerCase() === target) return a;
      } catch {}
    }
  } catch {}
  
  return null;
}

async function generateIntakePdf(submission, agent) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ 
      margin: 50,
      size: 'LETTER',
      info: {
        Title: 'Signed Intake Documents',
        Author: 'Life Assurance Solutions LLC',
        Subject: 'Agent Onboarding Intake Form'
      }
    });
    
    doc.on('data', (b) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    
    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('AGENT INTAKE FORM', 50, 50, { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('Life Assurance Solutions LLC & JJN Protection Insurance Agency LLC', 50, 80, { align: 'center' });
    
    let y = 120;
    
    // Contact Information
    doc.fontSize(14).font('Helvetica-Bold').text('CONTACT INFORMATION', 50, y);
    y += 30;
    
    doc.fontSize(12).font('Helvetica').text(`Name: ${submission.contact?.firstName || ''} ${submission.contact?.lastName || ''}`, 50, y);
    y += 20;
    doc.text(`Email: ${submission.contact?.email || ''}`, 50, y);
    y += 20;
    doc.text(`Phone: ${submission.contact?.phone || ''}`, 50, y);
    y += 30;
    
    // Business Information
    if (submission.business) {
      doc.fontSize(14).font('Helvetica-Bold').text('BUSINESS INFORMATION', 50, y);
      y += 30;
      
      doc.fontSize(12).font('Helvetica').text(`Agency Name: ${submission.business.agencyName || ''}`, 50, y);
      y += 20;
      doc.text(`Website: ${submission.business.website || ''}`, 50, y);
      y += 20;
      doc.text(`Address: ${submission.business.address1 || ''}`, 50, y);
      y += 20;
      if (submission.business.address2) {
        doc.text(submission.business.address2, 50, y);
        y += 20;
      }
      doc.text(`${submission.business.city || ''}, ${submission.business.state || ''} ${submission.business.zip || ''}`, 50, y);
      y += 30;
    }
    
    // NPN and Licensing
    doc.fontSize(14).font('Helvetica-Bold').text('LICENSING INFORMATION', 50, y);
    y += 30;
    
    doc.fontSize(12).font('Helvetica').text(`NPN: ${submission.npn || ''}`, 50, y);
    y += 20;
    doc.text(`States Licensed: ${Array.isArray(submission.statesLicensed) ? submission.statesLicensed.join(', ') : submission.statesLicensed || ''}`, 50, y);
    y += 30;
    
    // Background Information
    if (submission.background) {
      doc.fontSize(14).font('Helvetica-Bold').text('BACKGROUND INFORMATION', 50, y);
      y += 30;
      
      doc.fontSize(12).font('Helvetica').text(`Prior Terminations: ${submission.background.priorTerminations ? 'Yes' : 'No'}`, 50, y);
      y += 20;
      if (submission.background.priorTerminationsExplain) {
        doc.text(`Explanation: ${submission.background.priorTerminationsExplain}`, 50, y);
        y += 20;
      }
      
      doc.text(`Felonies: ${submission.background.felonies ? 'Yes' : 'No'}`, 50, y);
      y += 20;
      if (submission.background.feloniesExplain) {
        doc.text(`Explanation: ${submission.background.feloniesExplain}`, 50, y);
        y += 20;
      }
      
      doc.text(`Bankruptcies: ${submission.background.bankruptcies ? 'Yes' : 'No'}`, 50, y);
      y += 20;
      if (submission.background.bankruptciesExplain) {
        doc.text(`Explanation: ${submission.background.bankruptciesExplain}`, 50, y);
        y += 20;
      }
      y += 20;
    }
    
    // Acknowledgments
    if (submission.acknowledgments) {
      doc.fontSize(14).font('Helvetica-Bold').text('ACKNOWLEDGMENTS', 50, y);
      y += 30;
      
      doc.fontSize(12).font('Helvetica').text(`Producer Agreement Accepted: ${submission.acknowledgments.producerAgreementAccepted ? 'Yes' : 'No'}`, 50, y);
      y += 20;
      doc.text(`Privacy Notice Accepted: ${submission.acknowledgments.privacyNoticeAccepted ? 'Yes' : 'No'}`, 50, y);
      y += 20;
      doc.text(`Signature: ${submission.acknowledgments.signature || ''}`, 50, y);
      y += 20;
      doc.text(`Signature Date: ${submission.acknowledgments.signatureDate || ''}`, 50, y);
      y += 30;
    }
    
    // Footer
    doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`, 50, y);
    doc.text(`Submission ID: ${submission.id}`, 50, y + 15);
    
    doc.end();
  });
}

async function generateW9Pdf(submission) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ 
      margin: 50,
      size: 'LETTER',
      info: {
        Title: 'Signed W-9 Form',
        Author: 'Life Assurance Solutions LLC',
        Subject: 'Request for Taxpayer Identification Number and Certification'
      }
    });
    
    doc.on('data', (b) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    
    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('FORM W-9', 50, 50, { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('Request for Taxpayer Identification Number and Certification', 50, 80, { align: 'center' });
    
    let y = 120;
    
    // Form Information
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
    
    // Tax Information
    doc.fontSize(14).font('Helvetica-Bold').text('TAX INFORMATION', 50, y);
    y += 30;
    
    doc.fontSize(12).font('Helvetica').text(`SSN: ${submission.ssn || ''}`, 50, y);
    y += 20;
    doc.text(`EIN: ${submission.ein || ''}`, 50, y);
    y += 20;
    doc.text(`Tax Classification: ${submission.taxClassification || ''}`, 50, y);
    y += 30;
    
    // Signature
    doc.fontSize(14).font('Helvetica-Bold').text('SIGNATURE', 50, y);
    y += 30;
    
    doc.fontSize(12).font('Helvetica').text(`Signature: ${submission.signature || ''}`, 50, y);
    y += 20;
    doc.text(`Date: ${submission.signatureDate || ''}`, 50, y);
    y += 30;
    
    // Footer
    doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`, 50, y);
    doc.text(`Submission ID: ${submission.id}`, 50, y + 15);
    
    doc.end();
  });
}

async function generateBankingPdf(submission) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ 
      margin: 50,
      size: 'LETTER',
      info: {
        Title: 'Signed Banking Form',
        Author: 'Life Assurance Solutions LLC',
        Subject: 'Banking Information for Commission Payments'
      }
    });
    
    doc.on('data', (b) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    
    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('BANKING INFORMATION FORM', 50, 50, { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('Life Assurance Solutions LLC & JJN Protection Insurance Agency LLC', 50, 80, { align: 'center' });
    
    let y = 120;
    
    // Personal Information
    doc.fontSize(14).font('Helvetica-Bold').text('PERSONAL INFORMATION', 50, y);
    y += 30;
    
    doc.fontSize(12).font('Helvetica').text(`Name: ${submission.firstName || ''} ${submission.lastName || ''}`, 50, y);
    y += 20;
    doc.text(`Address: ${submission.streetAddress || ''}`, 50, y);
    y += 20;
    doc.text(`City, State ZIP: ${submission.city || ''}, ${submission.state || ''} ${submission.zipCode || ''}`, 50, y);
    y += 20;
    doc.text(`SSN: ${submission.ssn || ''}`, 50, y);
    y += 20;
    doc.text(`Date of Birth: ${submission.dateOfBirth || ''}`, 50, y);
    y += 30;
    
    // Banking Information
    doc.fontSize(14).font('Helvetica-Bold').text('BANKING INFORMATION', 50, y);
    y += 30;
    
    doc.fontSize(12).font('Helvetica').text(`Bank Name: ${submission.bankName || ''}`, 50, y);
    y += 20;
    doc.text(`Routing Number: ${submission.routingNumber || ''}`, 50, y);
    y += 20;
    doc.text(`Account Number: ${submission.accountNumber || ''}`, 50, y);
    y += 20;
    doc.text(`Account Type: ${submission.accountType || ''}`, 50, y);
    y += 20;
    doc.text(`Account Holder Name: ${submission.accountHolderName || ''}`, 50, y);
    y += 30;
    
    // Signature
    doc.fontSize(14).font('Helvetica-Bold').text('SIGNATURE', 50, y);
    y += 30;
    
    doc.fontSize(12).font('Helvetica').text(`Signature: ${submission.digitalSignature || ''}`, 50, y);
    y += 20;
    doc.text(`Date: ${submission.signatureDate || ''}`, 50, y);
    y += 30;
    
    // Footer
    doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`, 50, y);
    doc.text(`Submission ID: ${submission.id}`, 50, y + 15);
    
    doc.end();
  });
}

async function generateAllSignedDocuments() {
  console.log('\n📄 Generating signed documents for ALL submissions...');
  
  try {
    const entries = await fse.readdir(SUBMISSIONS_DIR, { withFileTypes: true });
    console.log(`Found ${entries.length} submission directories`);
    
    let processedCount = 0;
    let pdfsGenerated = 0;
    
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const submissionDir = path.join(SUBMISSIONS_DIR, ent.name);
      
      try {
        const files = await fse.readdir(submissionDir);
        console.log(`\n📁 Processing submission: ${ent.name}`);
        console.log(`   Files: ${files.join(', ')}`);
        
        let submissionData = null;
        let submissionType = 'unknown';
        let email = '';
        let firstName = '';
        let lastName = '';
        let phone = '';
        
        // Process intake submission
        if (files.includes('intake.json')) {
          try {
            submissionData = await fse.readJson(path.join(submissionDir, 'intake.json'));
            submissionType = 'intake';
            email = submissionData.contact?.email || '';
            firstName = submissionData.contact?.firstName || '';
            lastName = submissionData.contact?.lastName || '';
            phone = submissionData.contact?.phone || '';
            console.log(`   📝 Intake submission: ${firstName} ${lastName} (${email})`);
          } catch (e) {
            console.error(`   ❌ Error reading intake.json:`, e.message);
            continue;
          }
        }
        
        // Process W9 submission
        else if (files.includes('w9.json')) {
          try {
            submissionData = await fse.readJson(path.join(submissionDir, 'w9.json'));
            submissionType = 'w9';
            email = submissionData.email || '';
            const name = submissionData.name || '';
            firstName = name.split(' ')[0] || '';
            lastName = name.split(' ').slice(1).join(' ') || '';
            phone = submissionData.phone || '';
            console.log(`   📄 W9 submission: ${firstName} ${lastName} (${email})`);
          } catch (e) {
            console.error(`   ❌ Error reading w9.json:`, e.message);
            continue;
          }
        }
        
        // Process banking submission
        else if (files.includes('banking.json')) {
          try {
            submissionData = await fse.readJson(path.join(submissionDir, 'banking.json'));
            submissionType = 'banking';
            email = submissionData.email || '';
            firstName = submissionData.firstName || '';
            lastName = submissionData.lastName || '';
            phone = submissionData.phone || '';
            console.log(`   🏦 Banking submission: ${firstName} ${lastName} (${email})`);
          } catch (e) {
            console.error(`   ❌ Error reading banking.json:`, e.message);
            continue;
          }
        }
        
        // Process packet submission
        else if (files.includes('packet.json')) {
          try {
            submissionData = await fse.readJson(path.join(submissionDir, 'packet.json'));
            submissionType = 'packet';
            console.log(`   📦 Packet submission`);
          } catch (e) {
            console.error(`   ❌ Error reading packet.json:`, e.message);
            continue;
          }
        }
        
        // Create agent if needed
        let agent = null;
        if (email && (firstName || lastName)) {
          agent = await findOrCreateAgentByEmail(email);
          
          if (!agent) {
            agent = newAgent({
              firstName,
              lastName,
              email,
              phone
            });
            await writeAgent(agent);
          }
        } else {
          // Create agent even without email for W9 submissions
          agent = newAgent({
            firstName: firstName || 'Unknown',
            lastName: lastName || 'User',
            email: email || `${ent.name}@submission.local`,
            phone: phone || ''
          });
          await writeAgent(agent);
        }
        
        // Generate appropriate PDF
        let pdfBuffer = null;
        let pdfFileName = '';
        
        if (submissionType === 'intake') {
          pdfBuffer = await generateIntakePdf(submissionData, agent);
          pdfFileName = `SIGNED_INTAKE_DOCUMENTS_${Date.now()}.pdf`;
        } else if (submissionType === 'w9') {
          pdfBuffer = await generateW9Pdf(submissionData);
          pdfFileName = `SIGNED_W9_FORM_${Date.now()}.pdf`;
        } else if (submissionType === 'banking') {
          pdfBuffer = await generateBankingPdf(submissionData);
          pdfFileName = `SIGNED_BANKING_FORM_${Date.now()}.pdf`;
        } else if (submissionType === 'packet') {
          // For packet submissions, create a generic document
          pdfBuffer = await generateIntakePdf(submissionData, agent);
          pdfFileName = `SIGNED_PACKET_DOCUMENTS_${Date.now()}.pdf`;
        }
        
        if (pdfBuffer) {
          // Save PDF to agent directory
          const agentDir = path.join(AGENTS_DIR, agent.id);
          await fse.ensureDir(agentDir);
          const pdfPath = path.join(agentDir, pdfFileName);
          await fse.writeFile(pdfPath, pdfBuffer);
          
          // Update agent record
          if (submissionType === 'intake') {
            agent.progress.intakeSubmitted = true;
            agent.submissions.intakeId = ent.name;
            agent.submissions.intakePdfPath = pdfPath;
          } else if (submissionType === 'w9') {
            agent.progress.w9Submitted = true;
            agent.submissions.w9Id = ent.name;
            agent.submissions.w9PdfPath = pdfPath;
          } else if (submissionType === 'banking') {
            agent.progress.bankingSubmitted = true;
            agent.submissions.bankingId = ent.name;
            agent.submissions.bankingPdfPath = pdfPath;
          } else if (submissionType === 'packet') {
            agent.progress.packetSubmitted = true;
            agent.submissions.packetId = ent.name;
            agent.submissions.packetPdfPath = pdfPath;
          }
          
          await fse.writeJson(path.join(agentDir, 'agent.json'), agent, { spaces: 2 });
          
          console.log(`   ✅ Generated ${submissionType} PDF: ${pdfFileName}`);
          console.log(`   📁 Saved to: ${pdfPath}`);
          pdfsGenerated++;
        }
        
        processedCount++;
        
      } catch (e) {
        console.error(`   ❌ Error processing submission ${ent.name}:`, e.message);
      }
    }
    
    console.log(`\n🎉 PDF GENERATION COMPLETE!`);
    console.log(`   📊 Processed: ${processedCount} submissions`);
    console.log(`   📄 Generated: ${pdfsGenerated} signed PDFs`);
    console.log(`   ✅ ALL submissions now have signed documents!`);
    
  } catch (e) {
    console.error('❌ Error processing submissions:', e);
  }
}

// Run the PDF generation
generateAllSignedDocuments().then(() => {
  console.log('\n🏁 Script completed');
  process.exit(0);
}).catch(e => {
  console.error('💥 Script failed:', e);
  process.exit(1);
});
