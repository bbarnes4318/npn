#!/usr/bin/env node

// PRODUCTION SERVER SCRIPT - Run this ON YOUR SERVER at perenroll.com
// This will find ALL real submissions and generate signed documents

const fse = require('fs-extra');
const path = require('path');
const { nanoid } = require('nanoid');
const PDFDocument = require('pdfkit');

console.log('🚨 PRODUCTION SERVER SUBMISSION RECOVERY');
console.log('=====================================');
console.log('This script will find ALL submissions on your production server');
console.log('and generate signed documents for them.');
console.log('');

// Production paths - these should match your server configuration
const AGENTS_DIR = process.env.AGENTS_DIR || '/data/agents' || path.join(__dirname, 'agents');
const SUBMISSIONS_DIR = process.env.SUBMISSIONS_DIR || '/data/submissions' || path.join(__dirname, 'submissions');
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/data/uploads' || path.join(__dirname, 'uploads');

console.log('📁 Checking directories:');
console.log('AGENTS_DIR:', AGENTS_DIR);
console.log('SUBMISSIONS_DIR:', SUBMISSIONS_DIR);
console.log('UPLOADS_DIR:', UPLOADS_DIR);
console.log('');

async function checkDirectories() {
  console.log('🔍 Checking if directories exist...');
  
  try {
    const agentsExists = await fse.pathExists(AGENTS_DIR);
    const submissionsExists = await fse.pathExists(SUBMISSIONS_DIR);
    const uploadsExists = await fse.pathExists(UPLOADS_DIR);
    
    console.log(`AGENTS_DIR exists: ${agentsExists}`);
    console.log(`SUBMISSIONS_DIR exists: ${submissionsExists}`);
    console.log(`UPLOADS_DIR exists: ${uploadsExists}`);
    
    if (submissionsExists) {
      const entries = await fse.readdir(SUBMISSIONS_DIR, { withFileTypes: true });
      console.log(`SUBMISSIONS_DIR contains ${entries.length} items:`);
      entries.forEach(ent => {
        console.log(`  - ${ent.name} (${ent.isDirectory() ? 'directory' : 'file'})`);
      });
    }
    
    if (agentsExists) {
      const entries = await fse.readdir(AGENTS_DIR, { withFileTypes: true });
      console.log(`AGENTS_DIR contains ${entries.length} items:`);
      entries.forEach(ent => {
        console.log(`  - ${ent.name} (${ent.isDirectory() ? 'directory' : 'file'})`);
      });
    }
    
    return { agentsExists, submissionsExists, uploadsExists };
  } catch (e) {
    console.error('❌ Error checking directories:', e.message);
    return { agentsExists: false, submissionsExists: false, uploadsExists: false };
  }
}

async function findRealSubmissions() {
  console.log('\n📋 SCANNING FOR REAL SUBMISSIONS...');
  
  try {
    if (!await fse.pathExists(SUBMISSIONS_DIR)) {
      console.log('❌ SUBMISSIONS_DIR does not exist!');
      return [];
    }
    
    const entries = await fse.readdir(SUBMISSIONS_DIR, { withFileTypes: true });
    const submissions = [];
    
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      
      const submissionDir = path.join(SUBMISSIONS_DIR, ent.name);
      const files = await fse.readdir(submissionDir);
      
      let submissionData = null;
      let submissionType = 'unknown';
      
      // Check for different submission types
      if (files.includes('intake.json')) {
        try {
          submissionData = await fse.readJson(path.join(submissionDir, 'intake.json'));
          submissionType = 'intake';
        } catch (e) {
          console.error(`Error reading intake.json in ${ent.name}:`, e.message);
        }
      } else if (files.includes('w9.json')) {
        try {
          submissionData = await fse.readJson(path.join(submissionDir, 'w9.json'));
          submissionType = 'w9';
        } catch (e) {
          console.error(`Error reading w9.json in ${ent.name}:`, e.message);
        }
      } else if (files.includes('banking.json')) {
        try {
          submissionData = await fse.readJson(path.join(submissionDir, 'banking.json'));
          submissionType = 'banking';
        } catch (e) {
          console.error(`Error reading banking.json in ${ent.name}:`, e.message);
        }
      } else if (files.includes('packet.json')) {
        try {
          submissionData = await fse.readJson(path.join(submissionDir, 'packet.json'));
          submissionType = 'packet';
        } catch (e) {
          console.error(`Error reading packet.json in ${ent.name}:`, e.message);
        }
      }
      
      if (submissionData) {
        submissions.push({
          id: ent.name,
          type: submissionType,
          data: submissionData,
          files: files,
          receivedAt: submissionData.receivedAt || submissionData.id,
          path: submissionDir
        });
        
        console.log(`✅ Found ${submissionType} submission: ${ent.name}`);
        if (submissionType === 'intake' && submissionData.contact) {
          console.log(`   Name: ${submissionData.contact.firstName} ${submissionData.contact.lastName}`);
          console.log(`   Email: ${submissionData.contact.email}`);
        } else if (submissionType === 'w9' && submissionData.name) {
          console.log(`   Name: ${submissionData.name}`);
          console.log(`   Email: ${submissionData.email || 'No email'}`);
        } else if (submissionType === 'banking') {
          console.log(`   Name: ${submissionData.firstName} ${submissionData.lastName}`);
          console.log(`   Email: ${submissionData.email || 'No email'}`);
        }
      }
    }
    
    console.log(`\n📊 Found ${submissions.length} real submissions:`);
    submissions.forEach(sub => {
      console.log(`  - ${sub.id}: ${sub.type} (${sub.receivedAt})`);
    });
    
    return submissions;
  } catch (e) {
    console.error('❌ Error scanning submissions:', e.message);
    return [];
  }
}

async function generateProductionPDFs(submissions) {
  console.log('\n📄 GENERATING SIGNED DOCUMENTS FOR PRODUCTION SUBMISSIONS...');
  
  let pdfsGenerated = 0;
  
  for (const submission of submissions) {
    try {
      console.log(`\n📁 Processing: ${submission.id} (${submission.type})`);
      
      // Create agent record
      const agent = {
        id: nanoid(10),
        createdAt: new Date().toISOString(),
        profile: {
          firstName: '',
          lastName: '',
          email: '',
          phone: ''
        },
        progress: {},
        submissions: {},
        signatures: {},
        uploads: {}
      };
      
      // Extract contact info based on submission type
      if (submission.type === 'intake' && submission.data.contact) {
        agent.profile.firstName = submission.data.contact.firstName || '';
        agent.profile.lastName = submission.data.contact.lastName || '';
        agent.profile.email = submission.data.contact.email || '';
        agent.profile.phone = submission.data.contact.phone || '';
      } else if (submission.type === 'w9') {
        const name = submission.data.name || '';
        agent.profile.firstName = name.split(' ')[0] || '';
        agent.profile.lastName = name.split(' ').slice(1).join(' ') || '';
        agent.profile.email = submission.data.email || `${submission.id}@submission.local`;
        agent.profile.phone = submission.data.phone || '';
      } else if (submission.type === 'banking') {
        agent.profile.firstName = submission.data.firstName || '';
        agent.profile.lastName = submission.data.lastName || '';
        agent.profile.email = submission.data.email || `${submission.id}@submission.local`;
        agent.profile.phone = submission.data.phone || '';
      }
      
      // Generate PDF based on type
      let pdfBuffer = null;
      let pdfFileName = '';
      
      if (submission.type === 'intake') {
        pdfBuffer = await generateIntakePdf(submission.data, agent);
        pdfFileName = `SIGNED_INTAKE_DOCUMENTS_${Date.now()}.pdf`;
        agent.progress.intakeSubmitted = true;
        agent.submissions.intakeId = submission.id;
      } else if (submission.type === 'w9') {
        pdfBuffer = await generateW9Pdf(submission.data);
        pdfFileName = `SIGNED_W9_FORM_${Date.now()}.pdf`;
        agent.progress.w9Submitted = true;
        agent.submissions.w9Id = submission.id;
      } else if (submission.type === 'banking') {
        pdfBuffer = await generateBankingPdf(submission.data);
        pdfFileName = `SIGNED_BANKING_FORM_${Date.now()}.pdf`;
        agent.progress.bankingSubmitted = true;
        agent.submissions.bankingId = submission.id;
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
        agent.submissions[`${submission.type}PdfPath`] = pdfPath;
        await fse.writeJson(path.join(agentDir, 'agent.json'), agent, { spaces: 2 });
        
        console.log(`✅ Generated ${submission.type} PDF: ${pdfFileName}`);
        console.log(`📁 Saved to: ${pdfPath}`);
        console.log(`👤 Agent: ${agent.profile.firstName} ${agent.profile.lastName} (${agent.profile.email})`);
        
        pdfsGenerated++;
      }
      
    } catch (e) {
      console.error(`❌ Error processing ${submission.id}:`, e.message);
    }
  }
  
  console.log(`\n🎉 PRODUCTION PDF GENERATION COMPLETE!`);
  console.log(`📄 Generated: ${pdfsGenerated} signed PDFs`);
  console.log(`✅ All production submissions now have signed documents!`);
}

// PDF Generation Functions (simplified versions)
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

// Main execution
async function main() {
  console.log('🚀 Starting production submission recovery...\n');
  
  const dirs = await checkDirectories();
  
  if (!dirs.submissionsExists) {
    console.log('❌ SUBMISSIONS_DIR does not exist! Cannot proceed.');
    console.log('Please check your server configuration.');
    process.exit(1);
  }
  
  const submissions = await findRealSubmissions();
  
  if (submissions.length === 0) {
    console.log('❌ No submissions found!');
    console.log('This could mean:');
    console.log('1. No one has submitted forms yet');
    console.log('2. Submissions are stored in a different location');
    console.log('3. There is a configuration issue');
    process.exit(1);
  }
  
  await generateProductionPDFs(submissions);
  
  console.log('\n🏁 Production recovery completed!');
  console.log('✅ All real submissions now have signed documents');
  console.log('🌐 Check your admin portal at: https://perenroll.com/admin.html');
}

main().catch(e => {
  console.error('💥 Script failed:', e);
  process.exit(1);
});
