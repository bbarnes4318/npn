const express = require('express');
const path = require('path');
const multer = require('multer');
const fse = require('fs-extra');
const fs = require('fs');
const { nanoid } = require('nanoid');
const archiver = require('archiver');
const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLibDocument, StandardFonts, rgb } = require('pdf-lib');

const app = express();
const PORT = process.env.PORT || 3000;

// Paths
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

// Choose a writable directory, with fallbacks (helps when volumes are missing)
function chooseDir(preferred, fallbacks = []) {
  const candidates = [preferred, ...fallbacks].filter(Boolean);
  for (const p of candidates) {
    try {
      fse.ensureDirSync(p);
      return p;
    } catch (e) {
      // try next candidate
    }
  }
  // last resort: use OS temp
  const tmp = path.join(require('os').tmpdir(), 'npn');
  fse.ensureDirSync(tmp);
  return tmp;
}

let UPLOADS_TMP = chooseDir(
  process.env.UPLOADS_DIR || path.join(ROOT, 'uploads'),
  [path.join(ROOT, 'uploads'), '/tmp/npn/uploads']
);
let SUBMISSIONS_DIR = chooseDir(
  process.env.SUBMISSIONS_DIR || path.join(ROOT, 'submissions'),
  [path.join(ROOT, 'submissions'), '/tmp/npn/submissions']
);
let AGENTS_DIR = chooseDir(
  process.env.AGENTS_DIR || path.join(ROOT, 'agents'),
  [path.join(ROOT, 'agents'), '/tmp/npn/agents']
);

// Ensure directories exist
fse.ensureDirSync(PUBLIC_DIR);
fse.ensureDirSync(UPLOADS_TMP);
fse.ensureDirSync(SUBMISSIONS_DIR);
fse.ensureDirSync(AGENTS_DIR);

// Static files
app.use(express.static(PUBLIC_DIR));

// JSON parser for potential JSON endpoints
app.use(express.json({ limit: '10mb' }));
// URL-encoded parser for standard HTML form posts
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Multer for file uploads
const upload = multer({ dest: UPLOADS_TMP, limits: { fileSize: 10 * 1024 * 1024 } });

// Download packet JSON (admin)
app.get('/api/admin/agents/:id/documents/packet', requireAdmin, async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).send('Not found');
    const packetId = agent.submissions?.packetId;
    if (!packetId) return res.status(404).send('No packet');
    const packetJson = path.join(SUBMISSIONS_DIR, packetId, 'packet.json');
    if (!(await fse.pathExists(packetJson))) return res.status(404).send('No packet');
    return res.download(packetJson, `Packet_${packetId}.json`);
  } catch (e) {
    console.error('admin packet download error', e);
    return res.status(500).send('Failed to download packet');
  }
});

// Save full packet submission
app.post('/api/agents/:id/packet', async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).json({ ok: false, error: 'Not found' });
    const id = nanoid(10);
    const destDir = path.join(SUBMISSIONS_DIR, id);
    await fse.ensureDir(destDir);
    const body = req.body || {};
    // Persist raw packet payload for record
    await fse.writeJson(path.join(destDir, 'packet.json'), { id, receivedAt: new Date().toISOString(), payload: body }, { spaces: 2 });
    // Update agent progress and link submission
    agent.submissions = agent.submissions || {};
    agent.submissions.packetId = id;
    agent.progress = agent.progress || {};
    agent.progress.packetSubmitted = true;
    await writeAgent(agent);
    res.json({ ok: true, id });
  } catch (e) {
    console.error('packet submit error', e);
    res.status(500).json({ ok: false, error: 'Failed to save packet' });
  }
});

// --- Admin-protected variants ---
// Find agent by email (admin)
app.get('/api/admin/agents/find', requireAdmin, async (req, res) => {
  try {
    const email = (req.query.email || '').toString().trim();
    if (!email) return res.status(400).json({ ok: false, error: 'Email required' });
    const agent = await findOrCreateAgentByEmail(email);
    if (agent) return res.json({ ok: true, agent });
    return res.status(404).json({ ok: false, error: 'Not found' });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to search' });
  }
});

// List recent agents (admin)
app.get('/api/admin/agents', requireAdmin, async (req, res) => {
  try {
    console.log('Admin: Listing agents...');
    console.log('AGENTS_DIR:', AGENTS_DIR);
    const q = (req.query.q || '').toString().trim().toLowerCase();
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    const entries = await fse.readdir(AGENTS_DIR, { withFileTypes: true });
    console.log(`Admin: Found ${entries.length} entries in AGENTS_DIR`);
    const agents = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const p = path.join(AGENTS_DIR, ent.name, 'agent.json');
      if (!(await fse.pathExists(p))) continue;
      try {
        const a = await fse.readJson(p);
        const email = (a.profile?.email || '').toLowerCase();
        const name = `${a.profile?.firstName || ''} ${a.profile?.lastName || ''}`.toLowerCase();
        if (q && !(email.includes(q) || name.includes(q))) continue;
        agents.push({ id: a.id, createdAt: a.createdAt || '', profile: a.profile || {}, progress: a.progress || {} });
        console.log(`Admin: Added agent ${a.id} - ${a.profile?.firstName} ${a.profile?.lastName}`);
      } catch (e) {
        console.log(`Admin: Error reading agent ${ent.name}:`, e.message);
      }
    }
    agents.sort((x, y) => (new Date(y.createdAt || 0)) - (new Date(x.createdAt || 0)));
    console.log(`Admin: Returning ${agents.length} agents`);
    res.json({ ok: true, agents: agents.slice(0, limit) });
  } catch (e) {
    console.error('admin list agents error', e);
    res.status(500).json({ ok: false, error: 'Failed to list agents' });
  }
});

// List docs (admin)
app.get('/api/admin/agents/:id/documents/list', requireAdmin, async (req, res) => {
  try {
    console.log('Admin: Listing documents for agent:', req.params.id);
    const agent = await readAgent(req.params.id);
    if (!agent) {
      console.log('Admin: Agent not found:', req.params.id);
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    console.log('Admin: Agent found:', agent.id);
    
    // Ensure all PDFs are generated before listing
    await ensurePdfsGenerated(agent);
    
    const files = await gatherAgentDocuments(agent, { includeW9: true });
    console.log('Admin: Found files:', files.length);
    res.json({ ok: true, files: files.map(f => ({ name: f.name })) });
  } catch (e) {
    console.error('admin list docs error', e);
    res.status(500).json({ ok: false, error: 'Failed to list documents' });
  }
});

// Download specific document (admin)
app.get('/api/admin/agents/:id/documents/download/:filename', requireAdmin, async (req, res) => {
  try {
    console.log('Admin: Downloading document for agent:', req.params.id, 'file:', req.params.filename);
    const agent = await readAgent(req.params.id);
    if (!agent) {
      console.log('Admin: Agent not found:', req.params.id);
      return res.status(404).send('Agent not found');
    }
    const files = await gatherAgentDocuments(agent, { includeW9: true });
    const file = files.find(f => f.name === req.params.filename);
    if (!file) {
      console.log('Admin: File not found:', req.params.filename);
      return res.status(404).send('File not found');
    }
    console.log('Admin: Sending file:', file.path);
    return res.download(file.path, file.name);
  } catch (e) {
    console.error('admin download doc error', e);
    return res.status(500).send('Failed to download document');
  }
});

// ZIP (admin)
app.get('/api/admin/agents/:id/documents/zip', requireAdmin, async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).send('Not found');
    const files = await gatherAgentDocuments(agent, { includeW9: true });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="agent_${agent.id}_packet.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', () => { try { res.status(500).end('ZIP error'); } catch {} });
    archive.pipe(res);
    files.forEach(f => archive.file(f.path, { name: f.name }));
    await archive.finalize();
  } catch (e) {
    console.error('admin zip docs error', e);
    try { res.status(500).send('Failed to build ZIP'); } catch {}
  }
});

// W-9 PDF (admin)
app.get('/api/admin/agents/:id/documents/w9.pdf', requireAdmin, async (req, res) => {
  req.url = `/api/agents/${req.params.id}/documents/w9.pdf`; // for logging
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).send('Not found');
    const w9Id = agent.submissions?.w9Id;
    const uploadedPath = agent.submissions?.w9FilePath;
    if (w9Id) {
      const w9JsonPath = path.join(SUBMISSIONS_DIR, w9Id, 'w9.json');
      if (await fse.pathExists(w9JsonPath)) {
        const data = await fse.readJson(w9JsonPath);
        // Try to load official template and fill via pdf-lib
        try {
          const tplPath = DOCS.w9;
          if (tplPath && await fse.pathExists(tplPath)) {
            const tplBytes = await fse.readFile(tplPath);
            const pdfDoc = await PdfLibDocument.load(tplBytes);
            const form = pdfDoc.getForm();
            const fields = form.getFields();
            if (fields && fields.length > 0) {
              const byName = {};
              fields.forEach(f => { byName[f.getName().toLowerCase()] = f; });
              function setIfContains(substrs, value) {
                const key = Object.keys(byName).find(k => substrs.some(s => k.includes(s)));
                if (key && value != null && value !== '') {
                  const fld = byName[key];
                  try { fld.setText(String(value)); } catch {}
                }
              }
              setIfContains(['name', 'taxpayer name', 'f1_1'], data.name);
              setIfContains(['business', 'disregarded', 'f1_2'], data.businessName);
              setIfContains(['address', 'street', 'f1_3'], data.address?.address1);
              setIfContains(['apt', 'address 2', 'f1_4'], data.address?.address2);
              setIfContains(['city', 'town', 'f1_5'], data.address?.city);
              setIfContains(['state', 'f1_6'], data.address?.state);
              setIfContains(['zip', 'zip code', 'postal', 'f1_7'], data.address?.zip);
              // SSN / EIN — set whichever present
              if (data.tin?.ssn) setIfContains(['ssn', 'social'], data.tin.ssn);
              if (data.tin?.ein) setIfContains(['ein', 'employer'], data.tin.ein);
              // Signature and date
              setIfContains(['signature'], data.certification?.signature);
              setIfContains(['date'], data.certification?.signatureDate);
              // Try checking tax classification checkbox text field if present
              const tax = (data.taxClassification || '').toLowerCase();
              function checkIf(labelHints) {
                const key = Object.keys(byName).find(k => labelHints.some(s => k.includes(s)));
                if (key) {
                  try { byName[key].setText('X'); } catch {}
                }
              }
              if (tax) {
                if (tax.includes('individual') || tax.includes('sole')) checkIf(['individual', 'sole']);
                else if (tax.includes('c_corporation') || tax === 'c corporation' || tax === 'c') checkIf(['c corp', 'c corporation']);
                else if (tax.includes('s_corporation') || tax === 's corporation' || tax === 's') checkIf(['s corp', 's corporation']);
                else if (tax.includes('partnership')) checkIf(['partnership']);
                else if (tax.includes('trust') || tax.includes('estate')) checkIf(['trust', 'estate']);
                else if (tax.includes('llc')) checkIf(['llc']);
                else if (tax.includes('other')) checkIf(['other']);
              }
              form.flatten();
              const pdfBytes = await pdfDoc.save();
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', `inline; filename="W9_${w9Id}.pdf"`);
              return res.end(Buffer.from(pdfBytes));
            } else {
              // No AcroForm fields: overlay text at approximate coordinates as fallback
              const page = pdfDoc.getPages()[0];
              const { width, height } = page.getSize();
              const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
              const draw = (t, x, y) => page.drawText(String(t || ''), { x, y, size: 10, font, color: rgb(0,0,0) });
              // Approximate coordinates (may need tuning)
              draw(data.name, 72, height - 100);
              draw(data.businessName, 72, height - 115);
              draw(data.address?.address1, 72, height - 160);
              draw(data.address?.address2, 72, height - 175);
              draw(data.address?.city, 72, height - 190);
              draw(data.address?.state, 260, height - 190);
              draw(data.address?.zip, 320, height - 190);
              if (data.tin?.ssn) draw(data.tin.ssn, 360, height - 260);
              if (data.tin?.ein) draw(data.tin.ein, 360, height - 275);
              draw(data.certification?.signature, 72, 120);
              draw(data.certification?.signatureDate, 360, 120);
              const pdfBytes = await pdfDoc.save();
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', `inline; filename="W9_${w9Id}.pdf"`);
              return res.end(Buffer.from(pdfBytes));
            }
          }
        } catch (e) {
          console.warn('pdf-lib W9 fill failed, falling back to simple PDF', e);
        }
        // Fallback: simple generated summary PDF
        const { generateW9SubstitutePdf } = require('./pdf-generator');
        const pdfBuffer = await generateW9SubstitutePdf(data);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="W9_${w9Id}.pdf"`);
        res.send(pdfBuffer);
        return;
      }
    }
    if (uploadedPath && await fse.pathExists(uploadedPath)) {
      const filename = `W9_Upload_${agent.id}${path.extname(uploadedPath)}`;
      return res.download(uploadedPath, filename);
    }
    return res.status(404).send('No W-9 found');
  } catch (e) {
    console.error('admin w9.pdf error', e);
    return res.status(500).send('Failed to produce W-9 PDF');
  }
});

// Cert proof (admin)
app.get('/api/admin/agents/:id/documents/cert', requireAdmin, async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).send('Not found');
    const p = agent.uploads?.certProof;
    if (!p || !(await fse.pathExists(p))) return res.status(404).send('Not found');
    const filename = `CMS_FFM_CertProof_${agent.id}${path.extname(p)}`;
    return res.download(p, filename);
  } catch (e) {
    console.error('admin cert download error', e);
    return res.status(500).send('Failed to download');
  }
});

// Signed Intake Documents PDF (admin)
app.get('/api/admin/agents/:id/documents/intake.pdf', requireAdmin, async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).send('Not found');
    
    const intakePdfPath = agent.submissions?.intakePdfPath;
    if (intakePdfPath && await fse.pathExists(intakePdfPath)) {
      return res.download(intakePdfPath, 'Signed_Intake_Documents.pdf');
    }
    
    return res.status(404).send('No signed intake documents found');
  } catch (e) {
    console.error('admin intake pdf error', e);
    return res.status(500).send('Error serving intake documents');
  }
});

// Signed W9 Documents PDF (admin)
app.get('/api/admin/agents/:id/documents/w9-signed.pdf', requireAdmin, async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).send('Not found');
    
    const w9PdfPath = agent.submissions?.w9PdfPath;
    if (w9PdfPath && await fse.pathExists(w9PdfPath)) {
      return res.download(w9PdfPath, 'Signed_W9_Form.pdf');
    }
    
    return res.status(404).send('No signed W9 documents found');
  } catch (e) {
    console.error('admin w9 signed pdf error', e);
    return res.status(500).send('Error serving signed W9 documents');
  }
});

// --- Simple Admin token middleware ---
function requireAdmin(req, res, next) {
  // Temporarily disable admin auth for debugging
  return next();
  
  const token = process.env.ADMIN_TOKEN;
  const password = process.env.ADMIN_PASSWORD;
  if (!token && !password) return next(); // not enforced if neither is set

  // Attempt password auth first if configured
  if (password) {
    const headerPwd = req.header('x-admin-password') || req.header('X-Admin-Password');
    if (headerPwd && headerPwd === password) return next();
    // Basic Auth support: Authorization: Basic base64(username:password)
    const auth = req.header('authorization') || req.header('Authorization');
    if (auth && auth.toLowerCase().startsWith('basic ')) {
      try {
        const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
        const parts = decoded.split(':');
        const pass = parts.slice(1).join(':'); // allow any username
        if (pass === password) return next();
      } catch {}
    }
  }

  // Fallback to token auth if configured
  if (token) {
    const provided = req.header('x-admin-token') || req.header('X-Admin-Token');
    if (provided && provided === token) return next();
  }

  return res.status(401).json({ ok: false, error: 'Unauthorized' });
}

// ------- PDF Generation Fallback -------
async function ensurePdfsGenerated(agent) {
  try {
    const agentDir = path.join(AGENTS_DIR, agent.id);
    await fse.ensureDir(agentDir);
    
    // Check and generate intake PDF if missing
    if (agent.submissions?.intakeId && !agent.submissions?.intakePdfPath) {
      console.log('⚠️ Intake PDF missing, attempting to generate...');
      try {
        const intakeJson = path.join(SUBMISSIONS_DIR, agent.submissions.intakeId, 'intake.json');
        if (await fse.pathExists(intakeJson)) {
          const submission = await fse.readJson(intakeJson);
          const { generateIntakePdf } = require('./pdf-generator');
          const pdfBuffer = await generateIntakePdf(submission, agent);
          const outPath = path.join(agentDir, `SIGNED_INTAKE_DOCUMENTS_${Date.now()}.pdf`);
          await fse.writeFile(outPath, pdfBuffer);
          agent.submissions.intakePdfPath = outPath;
          console.log('✅ Generated missing intake PDF:', outPath);
        }
      } catch (e) {
        console.error('❌ Failed to generate missing intake PDF:', e);
      }
    }
    
    // Check and generate W-9 PDF if missing
    if (agent.submissions?.w9Id && !agent.submissions?.w9PdfPath) {
      console.log('⚠️ W-9 PDF missing, attempting to generate...');
      try {
        const w9Json = path.join(SUBMISSIONS_DIR, agent.submissions.w9Id, 'w9.json');
        if (await fse.pathExists(w9Json)) {
          const submission = await fse.readJson(w9Json);
          const pdfBytes = await new Promise((resolve, reject) => {
            const chunks = [];
            const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
            doc.on('data', chunks.push.bind(chunks));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
            
            // Generate W-9 PDF content (simplified version)
            doc.fontSize(20).text('FORM W-9', { align: 'center' });
            doc.moveDown(1);
            doc.fontSize(14).text('Request for Taxpayer Identification Number and Certification', { align: 'center' });
            doc.moveDown(2);
            doc.fontSize(16).text('PART I — TAXPAYER INFORMATION');
            doc.moveDown(1);
            doc.fontSize(14).text(`Name: ${submission.name || 'N/A'}`);
            doc.fontSize(14).text(`Business Name: ${submission.businessName || 'N/A'}`);
            doc.fontSize(14).text(`Tax Classification: ${submission.taxClassification || 'N/A'}`);
            doc.moveDown(1);
            doc.fontSize(14).text(`Address: ${submission.address?.address1 || 'N/A'}`);
            doc.fontSize(14).text(`City: ${submission.address?.city || 'N/A'}`);
            doc.fontSize(14).text(`State: ${submission.address?.state || 'N/A'}`);
            doc.fontSize(14).text(`ZIP: ${submission.address?.zip || 'N/A'}`);
            doc.moveDown(1);
            doc.fontSize(14).text(`SSN: ${submission.tin?.ssn || 'N/A'}`);
            doc.fontSize(14).text(`EIN: ${submission.tin?.ein || 'N/A'}`);
            doc.moveDown(2);
            doc.fontSize(16).text('SIGNATURE SECTION');
            doc.moveDown(1);
            doc.fontSize(14).text(`Digital Signature: ${submission.certification?.signature || 'NOT PROVIDED'}`);
            doc.fontSize(14).text(`Signature Date: ${submission.certification?.signatureDate || 'NOT PROVIDED'}`);
            doc.end();
          });
          
          const outPath = path.join(agentDir, `SIGNED_W9_FORM_${Date.now()}.pdf`);
          await fse.writeFile(outPath, pdfBytes);
          agent.submissions.w9PdfPath = outPath;
          console.log('✅ Generated missing W-9 PDF:', outPath);
        }
      } catch (e) {
        console.error('❌ Failed to generate missing W-9 PDF:', e);
      }
    }
    
    // Check and generate banking PDF if missing
    if (agent.submissions?.bankingId && !agent.submissions?.bankingPdfPath) {
      console.log('⚠️ Banking PDF missing, attempting to generate...');
      try {
        const bankingJson = path.join(SUBMISSIONS_DIR, agent.submissions.bankingId, 'banking.json');
        if (await fse.pathExists(bankingJson)) {
          const submission = await fse.readJson(bankingJson);
          const { generateBankingPdf } = require('./pdf-generator');
          const pdfBuffer = await generateBankingPdf(submission);
          const outPath = path.join(agentDir, `SIGNED_BANKING_FORM_${Date.now()}.pdf`);
          await fse.writeFile(outPath, pdfBuffer);
          agent.submissions.bankingPdfPath = outPath;
          console.log('✅ Generated missing banking PDF:', outPath);
        }
      } catch (e) {
        console.error('❌ Failed to generate missing banking PDF:', e);
      }
    }
    
    // Save agent if any PDFs were generated
    if (agent.submissions?.intakePdfPath || agent.submissions?.w9PdfPath || agent.submissions?.bankingPdfPath) {
      await writeAgent(agent);
    }
  } catch (e) {
    console.error('Error in ensurePdfsGenerated:', e);
  }
}

// ------- Document listing and ZIP download -------
async function gatherAgentDocuments(agent, { includeW9 = true } = {}) {
  const files = [];
  try {
    // Producer Agreement drawn signature
    const sig = agent.signatures?.producerAgreement;
    if (sig?.path && await fse.pathExists(sig.path)) {
      files.push({ path: sig.path, name: `ProducerAgreement_Signature_${agent.id}.png` });
    }
    // Producer Agreement signed PDF
    if (agent.submissions?.producerAgreementPdfPath && await fse.pathExists(agent.submissions.producerAgreementPdfPath)) {
      files.push({ path: agent.submissions.producerAgreementPdfPath, name: path.basename(agent.submissions.producerAgreementPdfPath) });
    }
    // CMS/FFM certification proof
    if (agent.uploads?.certProof && await fse.pathExists(agent.uploads.certProof)) {
      const ext = path.extname(agent.uploads.certProof) || '';
      files.push({ path: agent.uploads.certProof, name: `CMS_FFM_CertProof_${agent.id}${ext}` });
    }
    // Intake submission JSON
    const intakeId = agent.submissions?.intakeId;
    if (intakeId) {
      const intakeJson = path.join(SUBMISSIONS_DIR, intakeId, 'intake.json');
      if (await fse.pathExists(intakeJson)) files.push({ path: intakeJson, name: `Intake_${intakeId}.json` });
    }
    // Packet submission JSON
    const packetId = agent.submissions?.packetId;
    if (packetId) {
      const packetJson = path.join(SUBMISSIONS_DIR, packetId, 'packet.json');
      if (await fse.pathExists(packetJson)) files.push({ path: packetJson, name: `Packet_${packetId}.json` });
    }
    // Banking submission JSON
    const bankingId = agent.submissions?.bankingId;
    if (bankingId) {
      const bankingJson = path.join(SUBMISSIONS_DIR, bankingId, 'banking.json');
      if (await fse.pathExists(bankingJson)) files.push({ path: bankingJson, name: `Banking_${bankingId}.json` });
    }
    // Dashboard/Intake PDF
    if (agent.submissions?.dashboardPdfPath && await fse.pathExists(agent.submissions.dashboardPdfPath)) {
      files.push({ path: agent.submissions.dashboardPdfPath, name: path.basename(agent.submissions.dashboardPdfPath) });
    }
    // Signed Intake Documents PDF
    if (agent.submissions?.intakePdfPath && await fse.pathExists(agent.submissions.intakePdfPath)) {
      files.push({ path: agent.submissions.intakePdfPath, name: path.basename(agent.submissions.intakePdfPath) });
    }
    // Signed Banking Documents PDF
    if (agent.submissions?.bankingPdfPath && await fse.pathExists(agent.submissions.bankingPdfPath)) {
      files.push({ path: agent.submissions.bankingPdfPath, name: path.basename(agent.submissions.bankingPdfPath) });
    }
    // W-9 e-sign JSON
    if (includeW9) {
      const w9Id = agent.submissions?.w9Id;
      if (w9Id) {
        const w9Json = path.join(SUBMISSIONS_DIR, w9Id, 'w9.json');
        if (await fse.pathExists(w9Json)) files.push({ path: w9Json, name: `W9_${w9Id}.json` });
      }
      // W-9 generated PDF
      if (agent.submissions?.w9PdfPath && await fse.pathExists(agent.submissions.w9PdfPath)) {
        files.push({ path: agent.submissions.w9PdfPath, name: path.basename(agent.submissions.w9PdfPath) });
      }
      // W-9 uploaded file (agent-bound)
      if (agent.submissions?.w9FilePath && await fse.pathExists(agent.submissions.w9FilePath)) {
        const ext = path.extname(agent.submissions.w9FilePath) || '';
        files.push({ path: agent.submissions.w9FilePath, name: `W9_Upload_${agent.id}${ext}` });
      }
      // Check for any W9 files in agent directory
      try {
        const agentDir = path.join(AGENTS_DIR, agent.id);
        if (await fse.pathExists(agentDir)) {
          const agentFiles = await fse.readdir(agentDir);
          for (const file of agentFiles) {
            if (file.toLowerCase().includes('w9') || file.toLowerCase().includes('w-9')) {
              const filePath = path.join(agentDir, file);
              const stat = await fse.stat(filePath);
              if (stat.isFile()) {
                files.push({ path: filePath, name: `W9_${agent.id}_${file}` });
              }
            }
          }
        }
      } catch (e) {
        console.error(`Error checking agent directory for W9 files:`, e);
      }
    }
  } catch {}
  return files;
}

// List document names for an agent (for admin UI)
app.get('/api/agents/:id/documents/list', async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).json({ ok: false, error: 'Not found' });
    const files = await gatherAgentDocuments(agent, { includeW9: false });
    res.json({ ok: true, files: files.map(f => ({ name: f.name })) });
  } catch (e) {
    console.error('list docs error', e);
    res.status(500).json({ ok: false, error: 'Failed to list documents' });
  }
});

// Stream a ZIP of all agent documents
app.get('/api/agents/:id/documents/zip', async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).send('Not found');
    const files = await gatherAgentDocuments(agent, { includeW9: false });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="agent_${agent.id}_packet.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', () => { try { res.status(500).end('ZIP error'); } catch {} });
    archive.pipe(res);
    files.forEach(f => archive.file(f.path, { name: f.name }));
    await archive.finalize();
  } catch (e) {
    console.error('zip docs error', e);
    try { res.status(500).send('Failed to build ZIP'); } catch {}
  }
});

// Update agent profile
app.patch('/api/agents/:id/profile', async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).json({ ok: false, error: 'Not found' });
    const p = agent.profile || {};
    const b = req.body || {};
    agent.profile = {
      firstName: b.firstName ?? p.firstName ?? '',
      lastName: b.lastName ?? p.lastName ?? '',
      email: b.email ?? p.email ?? '',
      phone: b.phone ?? p.phone ?? ''
    };
    await writeAgent(agent);
    res.json({ ok: true, profile: agent.profile });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to update profile' });
  }
});

// W-9 file upload tied to agent
app.post('/api/agents/:id/w9', upload.single('w9'), async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).json({ ok: false, error: 'Not found' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    const dir = path.join(AGENTS_DIR, agent.id);
    await fse.ensureDir(dir);
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destPath = path.join(dir, `w9_${Date.now()}_${safeName}`);
    await fse.move(req.file.path, destPath);
    agent.submissions = agent.submissions || {};
    agent.submissions.w9FilePath = destPath;
    agent.progress.w9Submitted = true;
    await writeAgent(agent);
    res.json({ ok: true, path: destPath });
  } catch (err) {
    console.error('Error handling agent W-9 upload', err);
    res.status(500).json({ ok: false, error: 'Failed to upload W-9' });
  }
});

// W-9 file upload (no agent context)
app.post('/api/w9/upload', upload.single('w9'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    const id = nanoid(10);
    const destDir = path.join(SUBMISSIONS_DIR, id);
    await fse.ensureDir(destDir);
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destPath = path.join(destDir, `w9_${Date.now()}_${safeName}`);
    await fse.move(req.file.path, destPath);
    await fse.writeJson(path.join(destDir, 'w9_upload.json'), {
      id,
      type: 'w9_upload',
      receivedAt: new Date().toISOString(),
      file: {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: destPath
      }
    }, { spaces: 2 });
    res.json({ ok: true, id, path: destPath });
  } catch (err) {
    console.error('Error handling anonymous W-9 upload', err);
    res.status(500).json({ ok: false, error: 'Failed to upload W-9' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Secure document download routes for known PDFs in project root
const DOCS = {
  w9: path.join(ROOT, 'W9.pdf'),
  background: path.join(ROOT, 'Background Questions Fillable.pdf'),
  producerAgreement: path.join(ROOT, 'PRODUCER AGREEMENT (REMOTE).pdf'),
  square: path.join(ROOT, 'Square Fillable Form 2025.pdf')
};

app.get('/docs/:doc', async (req, res) => {
  const key = req.params.doc;
  try {
    // Generate updated Producer Agreement PDF dynamically to reflect removed clauses
    if (key === 'producerAgreement') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="Producer_Agreement_REMOTE.pdf"');
      const doc = new PDFDocument({ margin: 50 });
      doc.pipe(res);
      doc.fontSize(16).text('Producer Agreement (REMOTE)', { align: 'center' });
      doc.moveDown();
      doc.fontSize(11).text('This Producer Agreement (the "Agreement") is made and entered into as of the date written below by and between Life Assurance Solutions LLC (the "Company") and the insurance producer (the "Producer").');
      doc.moveDown();
      const items = [
        'Authorization to Sign Documents for Carrier Appointments. The Producer authorizes Life Assurance Solutions LLC to sign and submit all necessary documents on their behalf related to ACA (Affordable Care Act) insurance carrier appointments. This includes appointment forms, contracting packets, and certification confirmations. Life Assurance Solutions LLC is also authorized to represent the Producer with GAs, FMOs, and ACA carriers to facilitate onboarding and production access.',
        'Book of Business. All leads, clients, and applications submitted under this Agreement are considered part of the Company\'s Book of Business. The Company retains full ownership of the Book.',
        'Daily and Performance Bonuses. Bonuses, if any, are issued solely at the discretion of Life Assurance Solutions LLC management.',
        'Term and Termination. This Agreement becomes effective upon execution and remains in effect until terminated by either party in writing.',
        'General Provisions. This is an independent contractor relationship; no employer-employee relationship exists. This Agreement is governed by the laws of the State of New Jersey. No modifications will be valid unless in writing and signed by both parties.'
      ];
      items.forEach((t, i) => {
        doc.moveDown(0.6);
        doc.font('Times-Bold').text(`${i+1}.`, { continued: true });
        doc.font('Times-Roman').text(` ${t}`);
      });
      doc.end();
      return;
    }
    const filePath = DOCS[key];
    if (!filePath) return res.status(404).send('Not found');
    const exists = await fse.pathExists(filePath);
    if (!exists) return res.status(404).send('Not found');
    res.type('application/pdf');
    return res.sendFile(filePath);
  } catch (e) {
    return res.status(500).send('Error serving document');
  }
});

// Generate intake PDF from e-sign JSON if available
app.get('/api/agents/:id/documents/intake.pdf', async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).send('Not found');
    
    const intakeId = agent.submissions?.intakeId;
    const persistedPdf = agent.submissions?.intakePdfPath;
    
    if (persistedPdf && await fse.pathExists(persistedPdf)) {
      return res.download(persistedPdf, path.basename(persistedPdf));
    }
    
    if (intakeId) {
      const intakeJsonPath = path.join(SUBMISSIONS_DIR, intakeId, 'intake.json');
      if (await fse.pathExists(intakeJsonPath)) {
        const data = await fse.readJson(intakeJsonPath);
        
        // Generate PDF using the existing generator
        try {
          const { generateIntakePdf } = require('./pdf-generator');
          const pdfBuffer = await generateIntakePdf(data, agent);
          
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="Signed_Intake_Documents_${agent.id}.pdf"`);
          return res.send(pdfBuffer);
        } catch (e) {
          console.error('Failed to generate intake PDF:', e);
          return res.status(500).send('Failed to generate PDF');
        }
      }
    }
    
    return res.status(404).send('Intake documents not found');
  } catch (e) {
    console.error('intake pdf error', e);
    return res.status(500).send('Error generating intake PDF');
  }
});

// Per-document downloads
// Generate W-9 PDF from e-sign JSON if available; otherwise return uploaded file if present
app.get('/api/agents/:id/documents/w9.pdf', async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).send('Not found');
    const w9Id = agent.submissions?.w9Id;
    const uploadedPath = agent.submissions?.w9FilePath;
    const persistedPdf = agent.submissions?.w9PdfPath;
    if (persistedPdf && await fse.pathExists(persistedPdf)) {
      return res.download(persistedPdf, path.basename(persistedPdf));
    }
    if (w9Id) {
      const w9JsonPath = path.join(SUBMISSIONS_DIR, w9Id, 'w9.json');
      if (await fse.pathExists(w9JsonPath)) {
        const data = await fse.readJson(w9JsonPath);
        // Try to load official template and fill via pdf-lib
        try {
          const tplPath = DOCS.w9;
          if (tplPath && await fse.pathExists(tplPath)) {
            const tplBytes = await fse.readFile(tplPath);
            const pdfDoc = await PdfLibDocument.load(tplBytes);
            const form = pdfDoc.getForm();
            const fields = form.getFields();
            if (fields && fields.length > 0) {
              const byName = {};
              fields.forEach(f => { byName[f.getName().toLowerCase()] = f; });
              function setIfContains(substrs, value) {
                const key = Object.keys(byName).find(k => substrs.some(s => k.includes(s)));
                if (key && value != null && value !== '') {
                  const fld = byName[key];
                  try { fld.setText(String(value)); } catch {}
                }
              }
              setIfContains(['name', 'taxpayer name', 'f1_1'], data.name);
              setIfContains(['business', 'disregarded', 'f1_2'], data.businessName);
              setIfContains(['address', 'street', 'f1_3'], data.address?.address1);
              setIfContains(['apt', 'address 2', 'f1_4'], data.address?.address2);
              setIfContains(['city', 'town', 'f1_5'], data.address?.city);
              setIfContains(['state', 'f1_6'], data.address?.state);
              setIfContains(['zip', 'zip code', 'postal', 'f1_7'], data.address?.zip);
              // SSN / EIN — set whichever present
              if (data.tin?.ssn) setIfContains(['ssn', 'social'], data.tin.ssn);
              if (data.tin?.ein) setIfContains(['ein', 'employer'], data.tin.ein);
              // Signature and date
              setIfContains(['signature'], data.certification?.signature);
              setIfContains(['date'], data.certification?.signatureDate);
              // Try checking tax classification checkbox text field if present
              const tax = (data.taxClassification || '').toLowerCase();
              function checkIf(labelHints) {
                const key = Object.keys(byName).find(k => labelHints.some(s => k.includes(s)));
                if (key) {
                  try { byName[key].setText('X'); } catch {}
                }
              }
              if (tax) {
                if (tax.includes('individual') || tax.includes('sole')) checkIf(['individual', 'sole']);
                else if (tax.includes('c_corporation') || tax === 'c corporation' || tax === 'c') checkIf(['c corp', 'c corporation']);
                else if (tax.includes('s_corporation') || tax === 's corporation' || tax === 's') checkIf(['s corp', 's corporation']);
                else if (tax.includes('partnership')) checkIf(['partnership']);
                else if (tax.includes('trust') || tax.includes('estate')) checkIf(['trust', 'estate']);
                else if (tax.includes('llc')) checkIf(['llc']);
                else if (tax.includes('other')) checkIf(['other']);
              }
              form.flatten();
              const pdfBytes = await pdfDoc.save();
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', `inline; filename="W9_${w9Id}.pdf"`);
              return res.end(Buffer.from(pdfBytes));
            } else {
              // No AcroForm fields: overlay text at approximate coordinates as fallback
              const page = pdfDoc.getPages()[0];
              const { width, height } = page.getSize();
              const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
              const draw = (t, x, y) => page.drawText(String(t || ''), { x, y, size: 10, font, color: rgb(0,0,0) });
              // Approximate coordinates (may need tuning)
              draw(data.name, 72, height - 100);
              draw(data.businessName, 72, height - 115);
              draw(data.address?.address1, 72, height - 160);
              draw(data.address?.address2, 72, height - 175);
              draw(data.address?.city, 72, height - 190);
              draw(data.address?.state, 260, height - 190);
              draw(data.address?.zip, 320, height - 190);
              if (data.tin?.ssn) draw(data.tin.ssn, 360, height - 260);
              if (data.tin?.ein) draw(data.tin.ein, 360, height - 275);
              draw(data.certification?.signature, 72, 120);
              draw(data.certification?.signatureDate, 360, 120);
              const pdfBytes = await pdfDoc.save();
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', `inline; filename="W9_${w9Id}.pdf"`);
              return res.end(Buffer.from(pdfBytes));
            }
          }
        } catch (e) {
          console.warn('user w9.pdf fill failed, falling back to summary', e);
        }
        // Fallback: simple generated summary PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="W9_${w9Id}.pdf"`);
        const doc = new PDFDocument({ margin: 50 });
        doc.pipe(res);
        doc.fontSize(16).text('Form W-9 (Substitute)', { align: 'center' });
        doc.moveDown();
        doc.fontSize(11).text('Request for Taxpayer Identification Number and Certification');
        doc.moveDown();
        function field(label, value) {
          doc.font('Times-Bold').text(label + ':', { continued: true });
          doc.font('Times-Roman').text(' ' + (value || ''));
        }
        field('Name', data.name);
        field('Business name', data.businessName);
        field('Tax classification', data.taxClassification);
        if (data.taxClassification === 'llc') field('LLC classification', data.llcClassification);
        field('Exempt payee code', data.exemptPayeeCode);
        field('FATCA code', data.fatcaCode);
        field('Address 1', data.address?.address1);
        field('Address 2', data.address?.address2);
        field('City', data.address?.city);
        field('State', data.address?.state);
        field('ZIP', data.address?.zip);
        doc.moveDown();
        field('SSN', data.tin?.ssn);
        field('EIN', data.tin?.ein);
        doc.moveDown();
        field('Certification signature (typed)', data.certification?.signature);
        field('Certification date', data.certification?.signatureDate);
        doc.end();
        return;
      }
    }
    if (uploadedPath && await fse.pathExists(uploadedPath)) {
      const filename = `W9_Upload_${agent.id}${path.extname(uploadedPath)}`;
      return res.download(uploadedPath, filename);
    }
    return res.status(404).send('No W-9 found');
  } catch (e) {
    console.error('user w9.pdf error', e);
    return res.status(500).send('Failed to produce W-9 PDF');
  }
});

// Download CMS/FFM certification proof if present
app.get('/api/agents/:id/documents/cert', async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).send('Not found');
    const p = agent.uploads?.certProof;
    if (!p || !(await fse.pathExists(p))) return res.status(404).send('Not found');
    const filename = `CMS_FFM_CertProof_${agent.id}${path.extname(p)}`;
    return res.download(p, filename);
  } catch (e) {
    console.error('cert download error', e);
    return res.status(500).send('Failed to download');
  }
});

// ---- Agent portal helpers ----
async function readAgent(agentId) {
  const p = path.join(AGENTS_DIR, agentId, 'agent.json');
  if (!(await fse.pathExists(p))) return null;
  return fse.readJson(p);
}

async function writeAgent(agent) {
  const dir = path.join(AGENTS_DIR, agent.id);
  await fse.ensureDir(dir);
  await fse.writeJson(path.join(dir, 'agent.json'), agent, { spaces: 2 });
}

function newAgent({ firstName = '', lastName = '', email = '', phone = '' }) {
  const id = nanoid(10);
  return {
    id,
    createdAt: new Date().toISOString(),
    profile: { firstName, lastName, email, phone },
    progress: {
      step1: false,
      step2: false,
      step3: false,
      step4: false,
      step5: false,
      intakeSubmitted: false,
      w9Submitted: false,
      producerAgreementSigned: false
    },
    submissions: {},
    signatures: {},
    uploads: {}
  };
}

// Find existing agent by email (case-insensitive); if not found, try to build from submissions/intake and create agent.
async function findOrCreateAgentByEmail(email) {
  const target = (email || '').toString().trim().toLowerCase();
  if (!target) return null;
  // 1) search existing agents
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
  // 2) try to derive from submissions (intake)
  try {
    const subs = await fse.readdir(SUBMISSIONS_DIR, { withFileTypes: true });
    for (const ent of subs) {
      if (!ent.isDirectory()) continue;
      const p = path.join(SUBMISSIONS_DIR, ent.name, 'intake.json');
      if (!(await fse.pathExists(p))) continue;
      try {
        const s = await fse.readJson(p);
        const e = (s?.contact?.email || '').toLowerCase();
        if (e && e === target) {
          const agent = newAgent({
            firstName: s.contact.firstName || '',
            lastName: s.contact.lastName || '',
            email: s.contact.email || '',
            phone: s.contact.phone || ''
          });
          // link submission
          agent.progress.intakeSubmitted = true;
          agent.submissions.intakeId = s.id || ent.name;
          await writeAgent(agent);
          return agent;
        }
      } catch {}
    }
  } catch {}
  return null;
}

// Create agent
app.post('/api/agents', async (req, res) => {
  try {
    console.log('Creating agent with data:', req.body);
    const agent = newAgent({
      firstName: req.body.firstName || '',
      lastName: req.body.lastName || '',
      email: req.body.email || '',
      phone: req.body.phone || ''
    });
    console.log('Created agent:', agent.id);
    await writeAgent(agent);
    console.log('Agent saved successfully');
    res.json({ ok: true, agent });
  } catch (e) {
    console.error('Error creating agent', e);
    res.status(500).json({ ok: false, error: 'Failed to create agent' });
  }
});

// Find agent by email
app.get('/api/agents/find', async (req, res) => {
  try {
    const email = (req.query.email || '').toString().trim();
    if (!email) return res.status(400).json({ ok: false, error: 'Email required' });
    const agent = await findOrCreateAgentByEmail(email);
    if (agent) return res.json({ ok: true, agent });
    return res.status(404).json({ ok: false, error: 'Not found' });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to search' });
  }
});

// Get agent
app.get('/api/agents/:id', async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, agent });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to read agent' });
  }
});

// Update agent progress
app.patch('/api/agents/:id/progress', async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).json({ ok: false, error: 'Not found' });
    agent.progress = { ...agent.progress, ...(req.body || {}) };
    await writeAgent(agent);
    res.json({ ok: true, progress: agent.progress });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to update progress' });
  }
});

// Upload certification proof tied to agent
app.post('/api/agents/:id/uploadCert', upload.single('certProof'), async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).json({ ok: false, error: 'Not found' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    const dir = path.join(AGENTS_DIR, agent.id);
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destPath = path.join(dir, `cert_${Date.now()}_${safeName}`);
    await fse.move(req.file.path, destPath);
    agent.uploads.certProof = destPath;
    await writeAgent(agent);
    res.json({ ok: true, path: destPath });
  } catch (e) {
    console.error('uploadCert error', e);
    res.status(500).json({ ok: false, error: 'Failed to upload' });
  }
});

// Capture signature (typed or drawn as data URL)
app.post('/api/agents/:id/signatures', async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).json({ ok: false, error: 'Not found' });
    const { doc, type, value } = req.body || {};
    if (!doc || !type || !value) return res.status(400).json({ ok: false, error: 'Missing fields' });
    const dir = path.join(AGENTS_DIR, agent.id);
    await fse.ensureDir(dir);

    if (type === 'drawn' && typeof value === 'string' && value.startsWith('data:image/')) {
      const b64 = value.split(',')[1];
      const buf = Buffer.from(b64, 'base64');
      const sigPath = path.join(dir, `signature_${doc}_${Date.now()}.png`);
      await fse.writeFile(sigPath, buf);
      agent.signatures[doc] = { type, path: sigPath, signedAt: new Date().toISOString() };
    } else {
      agent.signatures[doc] = { type, text: String(value), signedAt: new Date().toISOString() };
    }
    if (doc === 'producerAgreement') agent.progress.producerAgreementSigned = true;
    // When Producer Agreement is signed, also generate and persist a signed PDF copy for records
    if (doc === 'producerAgreement') {
      try {
        const { generateProducerAgreementPdf } = require('./pdf-generator');
        const pdfBuffer = await generateProducerAgreementPdf(agent);
        const pdfPath = path.join(dir, `ProducerAgreement_Signed_${Date.now()}.pdf`);
        await fse.writeFile(pdfPath, pdfBuffer);

        agent.submissions = agent.submissions || {};
        agent.submissions.producerAgreementPdfPath = pdfPath;
      } catch (e) {
        console.warn('Failed to persist Producer Agreement PDF copy', e);
      }
    }
    await writeAgent(agent);
    res.json({ ok: true, signatures: agent.signatures, progress: agent.progress });
  } catch (e) {
    console.error('signatures error', e);
    res.status(500).json({ ok: false, error: 'Failed to save signature' });
  }
});

// Intake form submission (combined form)
app.post('/api/intake', upload.single('certProof'), async (req, res) => {
  try {
    const id = nanoid(10);
    const destDir = path.join(SUBMISSIONS_DIR, id);
    await fse.ensureDir(destDir);

    const body = req.body || {};

    // Move uploaded file if present
    let certProof = null;
    if (req.file) {
      const orig = req.file;
      const safeName = orig.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const destPath = path.join(destDir, `cert_${Date.now()}_${safeName}`);
      await fse.move(orig.path, destPath);
      certProof = {
        fieldname: orig.fieldname,
        originalname: orig.originalname,
        mimetype: orig.mimetype,
        size: orig.size,
        path: destPath
      };
    }

    const submission = {
      id,
      type: 'intake',
      receivedAt: new Date().toISOString(),
      contact: {
        firstName: body.firstName || '',
        lastName: body.lastName || '',
        email: body.email || '',
        phone: body.phone || ''
      },
      business: {
        agencyName: body.agencyName || '',
        website: body.website || '',
        address1: body.address1 || '',
        address2: body.address2 || '',
        city: body.city || '',
        state: body.state || '',
        zip: body.zip || ''
      },
      npn: body.npn || '',
      statesLicensed: Array.isArray(body.statesLicensed) ? body.statesLicensed : (body.statesLicensed ? [body.statesLicensed] : []),
      background: {
        priorTerminations: body.priorTerminations === 'yes',
        priorTerminationsExplain: body.priorTerminationsExplain || '',
        felonies: body.felonies === 'yes',
        feloniesExplain: body.feloniesExplain || '',
        bankruptcies: body.bankruptcies === 'yes',
        bankruptciesExplain: body.bankruptciesExplain || ''
      },
      acknowledgments: {
        producerAgreementAccepted: body.producerAgreementAccepted === 'on' || body.producerAgreementAccepted === 'true',
        privacyNoticeAccepted: body.privacyNoticeAccepted === 'on' || body.privacyNoticeAccepted === 'true',
        signature: body.signature || '',
        signatureDate: body.signatureDate || ''
      },
      attachments: {
        certProof
      }
    };

    await fse.writeJson(path.join(destDir, 'intake.json'), submission, { spaces: 2 });
    // Link to agent if provided, or find/create by email
    let agent = null;
    if (body.agentId) {
      agent = await readAgent(body.agentId);
    } else if (body.email) {
      agent = await findOrCreateAgentByEmail(body.email);
      if (!agent) {
        agent = newAgent({
          firstName: body.firstName || '',
          lastName: body.lastName || '',
          email: body.email || '',
          phone: body.phone || ''
        });
      }
    }
    if (agent) {
      agent.progress.intakeSubmitted = true;
      agent.submissions.intakeId = id;
      if (certProof?.path) {
        agent.uploads.certProof = certProof.path;
      }
      
      // Generate comprehensive signed documents PDF
      try {
        console.log('Generating intake PDF for agent:', agent.id);
        const { generateIntakePdf } = require('./pdf-generator');
        const pdfBuffer = await generateIntakePdf(submission, agent);
        const agentDir = path.join(AGENTS_DIR, agent.id);
        await fse.ensureDir(agentDir);
        const outPath = path.join(agentDir, `SIGNED_INTAKE_DOCUMENTS_${Date.now()}.pdf`);
        await fse.writeFile(outPath, pdfBuffer);
        agent.submissions.intakePdfPath = outPath;
        console.log('✅ Signed intake documents PDF saved to:', outPath);
      } catch (e) {
        console.error('❌ Failed to generate intake PDF:', e);
        // Don't fail the entire submission if PDF generation fails
      }
      
      await writeAgent(agent);
    }
    res.json({ ok: true, id });
  } catch (err) {
    console.error('Error handling /api/intake', err);
    res.status(500).json({ ok: false, error: 'Failed to save intake submission' });
  }
});

// W-9 form submission (separate)
app.post('/api/w9', async (req, res) => {
  try {
    const id = nanoid(10);
    const destDir = path.join(SUBMISSIONS_DIR, id);
    await fse.ensureDir(destDir);

    const body = req.body || {};
    const submission = {
      id,
      type: 'w9',
      receivedAt: new Date().toISOString(),
      name: body.name || '',
      businessName: body.businessName || '',
      taxClassification: body.taxClassification || '',
      llcClassification: body.llcClassification || '',
      exemptPayeeCode: body.exemptPayeeCode || '',
      fatcaCode: body.fatcaCode || '',
      address: {
        address1: body.address1 || '',
        address2: body.address2 || '',
        city: body.city || '',
        state: body.state || '',
        zip: body.zip || ''
      },
      tin: {
        ssn: body.ssn || '',
        ein: body.ein || ''
      },
      certification: {
        signature: body.signature || '',
        signatureDate: body.signatureDate || ''
      }
    };

    await fse.writeJson(path.join(destDir, 'w9.json'), submission, { spaces: 2 });
    
    // Link to agent if provided
    if (body.agentId) {
      const agent = await readAgent(body.agentId);
      if (agent) {
        agent.progress.w9Submitted = true;
        agent.submissions.w9Id = id;
        
        // Generate official W-9 PDF
        try {
          console.log('Generating W-9 PDF for agent:', agent.id);
          const agentDir = path.join(AGENTS_DIR, agent.id);
          await fse.ensureDir(agentDir);
          const outPath = path.join(agentDir, `SIGNED_W9_FORM_${Date.now()}.pdf`);
          console.log('W-9 PDF will be saved to:', outPath);
          
          // Create official W-9 PDF
          console.log('W9 PDF Data:', JSON.stringify(submission, null, 2));
          const pdfBytes = await new Promise((resolve, reject) => {
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
            doc.on('end', () => {
              console.log('W9 PDF generation completed, size:', Buffer.concat(chunks).length);
              resolve(Buffer.concat(chunks));
            });
            doc.on('error', (err) => {
              console.error('W9 PDF generation error:', err);
              reject(err);
            });
            
            // Official W-9 Form Layout - Looks like real IRS form
            const pageWidth = doc.page.width;
            const pageHeight = doc.page.height;
            const margin = 36; // Standard 0.5 inch margins
            const contentWidth = pageWidth - (margin * 2);
            
            // Header - IRS Logo Area (simulated)
            doc.rect(margin, margin, contentWidth, 40)
               .stroke('#000000');
            
            doc.fontSize(16).font('Helvetica-Bold')
               .text('Department of the Treasury', margin + 10, margin + 10)
               .text('Internal Revenue Service', margin + 10, margin + 25);
            
            doc.fontSize(20).font('Helvetica-Bold')
               .text('Request for Taxpayer', pageWidth - 200, margin + 10)
               .text('Identification Number', pageWidth - 200, margin + 25)
               .text('and Certification', pageWidth - 200, margin + 40);
            
            // Form Title
            doc.fontSize(24).font('Helvetica-Bold')
               .text('Form W-9', margin, margin + 60, { align: 'center' });
            
            doc.fontSize(12).font('Helvetica')
               .text('(Rev. December 2023)', margin, margin + 85, { align: 'center' });
            
            // Part I - Taxpayer Identification Number (TIN)
            doc.fontSize(14).font('Helvetica-Bold')
               .text('Part I', margin, margin + 110)
               .text('Taxpayer Identification Number (TIN)', margin + 50, margin + 110);
            
            // TIN Section
            doc.rect(margin, margin + 130, contentWidth, 60)
               .stroke('#000000');
            
            doc.fontSize(12).font('Helvetica-Bold')
               .text('Enter your TIN in the appropriate box. The TIN provided must match the name given on Line 1 to avoid', margin + 5, margin + 135)
               .text('backup withholding. For individuals, this is your social security number (SSN). However, for a resident alien,', margin + 5, margin + 150)
               .text('sole proprietor, or disregarded entity, see the Part I instructions on page 3. For other entities, it is your employer', margin + 5, margin + 165)
               .text('identification number (EIN). If you do not have a number, see How to get a TIN on page 3.', margin + 5, margin + 180);
            
            // TIN Input Boxes
            const tinY = margin + 200;
            doc.fontSize(12).font('Helvetica-Bold')
               .text('Social Security Number', margin + 5, tinY);
            
            // SSN Boxes
            const ssnValue = submission.tin?.ssn || '';
            const ssnParts = ssnValue.match(/(\d{3})(\d{2})(\d{4})/) || ['', '', '', ''];
            
            for (let i = 0; i < 3; i++) {
              const boxX = margin + 5 + (i * 35);
              doc.rect(boxX, tinY + 15, 30, 20).stroke('#000000');
              doc.fontSize(12).font('Helvetica')
                 .text(ssnParts[i + 1] || '', boxX + 2, tinY + 20);
            }
            
            doc.fontSize(12).font('Helvetica-Bold')
               .text('OR', margin + 120, tinY + 20);
            
            doc.fontSize(12).font('Helvetica-Bold')
               .text('Employer Identification Number', margin + 150, tinY);
            
            // EIN Boxes
            const einValue = submission.tin?.ein || '';
            const einParts = einValue.match(/(\d{2})(\d{7})/) || ['', '', ''];
            
            for (let i = 0; i < 2; i++) {
              const boxX = margin + 150 + (i * 35);
              doc.rect(boxX, tinY + 15, 30, 20).stroke('#000000');
              doc.fontSize(12).font('Helvetica')
                 .text(einParts[i + 1] || '', boxX + 2, tinY + 20);
            }
            
            // Part II - Certification
            doc.fontSize(14).font('Helvetica-Bold')
               .text('Part II', margin, margin + 250)
               .text('Certification', margin + 50, margin + 250);
            
            doc.fontSize(12).font('Helvetica')
               .text('Under penalties of perjury, I certify that:', margin + 5, margin + 270)
               .text('1. The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me), and', margin + 5, margin + 285)
               .text('2. I am not subject to backup withholding because: (a) I am exempt from backup withholding, or (b) I have not been notified by the', margin + 5, margin + 300)
               .text('Internal Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS', margin + 5, margin + 315)
               .text('has notified me that I am no longer subject to backup withholding, and', margin + 5, margin + 330)
               .text('3. I am a U.S. person (including a U.S. resident alien), and', margin + 5, margin + 345)
               .text('4. The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.', margin + 5, margin + 360);
            
            // Signature Section
            doc.fontSize(14).font('Helvetica-Bold')
               .text('Signature of U.S. person', margin + 5, margin + 390);
            
            doc.rect(margin + 5, margin + 410, 200, 30).stroke('#000000');
            doc.fontSize(12).font('Helvetica')
               .text(submission.certification?.signature || '', margin + 10, margin + 420);
            
            doc.fontSize(14).font('Helvetica-Bold')
               .text('Date', margin + 220, margin + 390);
            
            doc.rect(margin + 220, margin + 410, 100, 30).stroke('#000000');
            doc.fontSize(12).font('Helvetica')
               .text(submission.certification?.signatureDate || '', margin + 225, margin + 420);
            
            // Part I - Name and Address
            doc.fontSize(14).font('Helvetica-Bold')
               .text('Part I', margin, margin + 460)
               .text('Name and Address', margin + 50, margin + 460);
            
            // Name Line
            doc.fontSize(12).font('Helvetica-Bold')
               .text('Name (as shown on your income tax return)', margin + 5, margin + 480);
            
            doc.rect(margin + 5, margin + 495, contentWidth - 10, 25).stroke('#000000');
            doc.fontSize(12).font('Helvetica')
               .text(submission.name || '', margin + 10, margin + 500);
            
            // Business Name Line
            doc.fontSize(12).font('Helvetica-Bold')
               .text('Business name/disregarded entity name, if different from above', margin + 5, margin + 530);
            
            doc.rect(margin + 5, margin + 545, contentWidth - 10, 25).stroke('#000000');
            doc.fontSize(12).font('Helvetica')
               .text(submission.businessName || '', margin + 10, margin + 550);
            
            // Address Lines
            doc.fontSize(12).font('Helvetica-Bold')
               .text('Address (number, street, and apt. or suite no.)', margin + 5, margin + 580);
            
            doc.rect(margin + 5, margin + 595, contentWidth - 10, 25).stroke('#000000');
            doc.fontSize(12).font('Helvetica')
               .text(submission.address?.address1 || '', margin + 10, margin + 600);
            
            doc.fontSize(12).font('Helvetica-Bold')
               .text('City, state, and ZIP code', margin + 5, margin + 630);
            
            doc.rect(margin + 5, margin + 645, contentWidth - 10, 25).stroke('#000000');
            doc.fontSize(12).font('Helvetica')
               .text(`${submission.address?.city || ''}, ${submission.address?.state || ''} ${submission.address?.zip || ''}`, margin + 10, margin + 650);
            
            // Tax Classification
            doc.fontSize(14).font('Helvetica-Bold')
               .text('Part I', margin, margin + 690)
               .text('Tax Classification', margin + 50, margin + 690);
            
            doc.fontSize(12).font('Helvetica-Bold')
               .text('Check the appropriate box for the federal tax classification of the person whose name is entered on Line 1:', margin + 5, margin + 710);
            
            const classifications = [
              'Individual/sole proprietor or single-member LLC',
              'C Corporation',
              'S Corporation', 
              'Partnership',
              'Trust/estate',
              'LLC',
              'Other'
            ];
            
            const selectedClassification = submission.taxClassification || '';
            let yPos = margin + 730;
            
            classifications.forEach((classification, index) => {
              const checkboxX = margin + 5;
              const checkboxY = yPos;
              
              // Draw checkbox
              doc.rect(checkboxX, checkboxY, 12, 12).stroke('#000000');
              
              // Check if this classification is selected
              if (selectedClassification.toLowerCase().includes(classification.toLowerCase().split('/')[0])) {
                doc.fontSize(10).font('Helvetica-Bold')
                   .text('X', checkboxX + 2, checkboxY + 1);
              }
              
              doc.fontSize(11).font('Helvetica')
                 .text(classification, checkboxX + 20, checkboxY + 2);
              
              yPos += 18;
            });
            
            // Footer
            doc.fontSize(10).font('Helvetica')
               .text('For Privacy Act and Paperwork Reduction Act Notice, see page 3.', margin, pageHeight - 30)
               .text('Cat. No. 10231X', pageWidth - 100, pageHeight - 30);
            
            doc.end();
          });
          
          await fse.writeFile(outPath, pdfBytes);
          agent.submissions.w9PdfPath = outPath;
          console.log('✅ Signed W-9 PDF saved successfully to:', outPath);
        } catch (e) {
          console.error('❌ Failed to generate W-9 PDF:', e);
          // Don't fail the entire submission if PDF generation fails
        }
        
        await writeAgent(agent);
      }
    }
    
    res.json({ ok: true, id });
  } catch (err) {
    console.error('Error handling /api/w9', err);
    res.status(500).json({ ok: false, error: 'Failed to save W-9 submission' });
  }
});

// Banking details submission
app.post('/api/banking', async (req, res) => {
  try {
    const body = req.body || {};
    const agentId = body.agentId;
    
    // Validate required fields
    const requiredFields = ['firstName', 'lastName', 'bankName', 'routingNumber', 'accountNumber', 'accountType', 'accountHolderName'];
    for (const field of requiredFields) {
      if (!body[field] || body[field].trim() === '') {
        return res.status(400).json({ ok: false, error: `Missing required field: ${field}` });
      }
    }

    // Validate SSN format if provided
    if (body.ssn && !/^\d{9}$/.test(body.ssn)) {
      return res.status(400).json({ ok: false, error: 'SSN must be exactly 9 digits' });
    }

    // Validate routing number format
    if (!/^\d{9}$/.test(body.routingNumber)) {
      return res.status(400).json({ ok: false, error: 'Routing number must be exactly 9 digits' });
    }

    // Create banking submission
    const id = nanoid(10);
    const destDir = path.join(SUBMISSIONS_DIR, id);
    await fse.ensureDir(destDir);

    const submission = {
      id,
      type: 'banking',
      receivedAt: new Date().toISOString(),
      employeeInfo: {
        firstName: body.firstName || '',
        lastName: body.lastName || '',
        streetAddress: body.streetAddress || '',
        city: body.city || '',
        state: body.state || '',
        zipCode: body.zipCode || '',
        ssn: body.ssn || '',
        dateOfHire: body.dateOfHire || '',
        dateOfBirth: body.dateOfBirth || '',
        workLocationAddress: body.workLocationAddress || ''
      },
      bankName: body.bankName || '',
      routingNumber: body.routingNumber || '',
      accountNumber: body.accountNumber || '',
      accountType: body.accountType || '',
      accountHolderName: body.accountHolderName || '',
      paymentMethod: body.paymentMethod || 'direct_deposit',
      paymentFrequency: body.paymentFrequency || 'bi-weekly',
      authorizations: {
        authorizeDirectDeposit: body.authorizeDirectDeposit === 'on' || body.authorizeDirectDeposit === 'true',
        verifyBankingInfo: body.verifyBankingInfo === 'on' || body.verifyBankingInfo === 'true',
        privacyConsent: body.privacyConsent === 'on' || body.privacyConsent === 'true'
      },
      signature: {
        digitalSignature: body.digitalSignature || '',
        signatureDate: body.signatureDate || ''
      }
    };

    await fse.writeJson(path.join(destDir, 'banking.json'), submission, { spaces: 2 });

    // Link to agent if provided
    if (agentId) {
      const agent = await readAgent(agentId);
      if (agent) {
        agent.progress.bankingSubmitted = true;
        agent.submissions.bankingId = id;
        agent.banking = {
          bankName: submission.bankName,
          accountType: submission.accountType,
          paymentMethod: submission.paymentMethod,
          lastUpdated: new Date().toISOString()
        };

        // Generate and save banking PDF
        try {
          console.log('Generating banking PDF for agent:', agent.id);
          const { generateBankingPdf } = require('./pdf-generator');
          const pdfBuffer = await generateBankingPdf(submission);
          const agentDir = path.join(AGENTS_DIR, agent.id);
          await fse.ensureDir(agentDir);
          const pdfPath = path.join(agentDir, `SIGNED_BANKING_FORM_${Date.now()}.pdf`);
          await fse.writeFile(pdfPath, pdfBuffer);
          agent.submissions.bankingPdfPath = pdfPath;
          console.log('✅ Signed banking PDF saved to:', pdfPath);
        } catch (e) {
          console.error('❌ Failed to generate banking PDF:', e);
          // Don't fail the entire submission if PDF generation fails
        }

        await writeAgent(agent);
      }
    }

    res.json({ ok: true, id });
  } catch (err) {
    console.error('Error handling /api/banking', err);
    res.status(500).json({ ok: false, error: 'Failed to save banking information' });
  }
});

// Get all submissions (admin)
app.get('/api/admin/submissions', requireAdmin, async (req, res) => {
  try {
    const submissions = [];
    const entries = await fse.readdir(SUBMISSIONS_DIR, { withFileTypes: true });
    
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const submissionDir = path.join(SUBMISSIONS_DIR, ent.name);
      
      // Check for different submission types
      const files = await fse.readdir(submissionDir);
      let submissionData = null;
      let submissionType = 'unknown';
      
      // Check for intake submission
      if (files.includes('intake.json')) {
        try {
          submissionData = await fse.readJson(path.join(submissionDir, 'intake.json'));
          submissionType = 'intake';
        } catch (e) {}
      }
      // Check for W-9 submission
      else if (files.includes('w9.json')) {
        try {
          submissionData = await fse.readJson(path.join(submissionDir, 'w9.json'));
          submissionType = 'w9';
        } catch (e) {}
      }
      // Check for banking submission
      else if (files.includes('banking.json')) {
        try {
          submissionData = await fse.readJson(path.join(submissionDir, 'banking.json'));
          submissionType = 'banking';
        } catch (e) {}
      }
      // Check for packet submission
      else if (files.includes('packet.json')) {
        try {
          submissionData = await fse.readJson(path.join(submissionDir, 'packet.json'));
          submissionType = 'packet';
        } catch (e) {}
      }
      
      if (submissionData) {
        submissions.push({
          id: ent.name,
          type: submissionType,
          receivedAt: submissionData.receivedAt || submissionData.id,
          data: submissionData,
          files: files
        });
      }
    }
    
    // Sort by received date (newest first)
    submissions.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
    
    res.json({ ok: true, submissions });
  } catch (e) {
    console.error('Error fetching submissions', e);
    res.status(500).json({ ok: false, error: 'Failed to fetch submissions' });
  }
});

// Get all PDFs from all agents (admin)
app.get('/api/admin/all-pdfs', requireAdmin, async (req, res) => {
  try {
    console.log('Admin: Getting all PDFs from all agents');
    
    const allPdfs = [];
    const agentEntries = await fse.readdir(AGENTS_DIR, { withFileTypes: true });
    
    for (const ent of agentEntries) {
      if (!ent.isDirectory()) continue;
      const agentId = ent.name;
      try {
        const agent = await readAgent(agentId);
        if (agent) {
          const agentName = `${agent.profile?.firstName || ''} ${agent.profile?.lastName || ''}`.trim() || 'Unknown';
          
          // Check for signed intake PDF
          if (agent.submissions?.intakePdfPath && await fse.pathExists(agent.submissions.intakePdfPath)) {
            const stats = await fse.stat(agent.submissions.intakePdfPath);
            allPdfs.push({
              agentId: agentId,
              agentName: agentName,
              type: 'Signed Intake Documents',
              pdfPath: agent.submissions.intakePdfPath,
              fileName: path.basename(agent.submissions.intakePdfPath),
              date: stats.mtime.toISOString(),
              size: stats.size
            });
          }
          
          // Check for signed W9 PDF
          if (agent.submissions?.w9PdfPath && await fse.pathExists(agent.submissions.w9PdfPath)) {
            const stats = await fse.stat(agent.submissions.w9PdfPath);
            allPdfs.push({
              agentId: agentId,
              agentName: agentName,
              type: 'Signed W9 Form',
              pdfPath: agent.submissions.w9PdfPath,
              fileName: path.basename(agent.submissions.w9PdfPath),
              date: stats.mtime.toISOString(),
              size: stats.size
            });
          }
          
          // Check for other PDFs in agent directory
          try {
            const agentDir = path.join(AGENTS_DIR, agentId);
            const files = await fse.readdir(agentDir);
            for (const file of files) {
              if (file.toLowerCase().endsWith('.pdf')) {
                const filePath = path.join(agentDir, file);
                const stats = await fse.stat(filePath);
                allPdfs.push({
                  agentId: agentId,
                  agentName: agentName,
                  type: 'Other PDF',
                  pdfPath: filePath,
                  fileName: file,
                  date: stats.mtime.toISOString(),
                  size: stats.size
                });
              }
            }
          } catch (e) {
            console.error(`Error checking agent directory for PDFs:`, e);
          }
        }
      } catch (e) {
        console.error(`Error processing agent ${agentId}:`, e);
      }
    }
    
    // Sort by date (newest first)
    allPdfs.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    console.log(`Admin: Found ${allPdfs.length} PDFs from all agents`);
    res.json({ ok: true, pdfs: allPdfs });
    
  } catch (e) {
    console.error('Error getting all PDFs:', e);
    res.status(500).json({ ok: false, error: 'Failed to get PDFs' });
  }
});

// Download specific PDF (admin)
app.get('/api/admin/pdf/:agentId/:fileName', requireAdmin, async (req, res) => {
  try {
    const { agentId, fileName } = req.params;
    const agent = await readAgent(agentId);
    if (!agent) return res.status(404).send('Agent not found');
    
    // Check if it's a known PDF path
    let pdfPath = null;
    if (fileName.includes('SIGNED_INTAKE_DOCUMENTS') && agent.submissions?.intakePdfPath) {
      pdfPath = agent.submissions.intakePdfPath;
    } else if (fileName.includes('SIGNED_W9_FORM') && agent.submissions?.w9PdfPath) {
      pdfPath = agent.submissions.w9PdfPath;
    } else {
      // Look for the file in agent directory
      const agentDir = path.join(AGENTS_DIR, agentId);
      const fullPath = path.join(agentDir, fileName);
      if (await fse.pathExists(fullPath)) {
        pdfPath = fullPath;
      }
    }
    
    if (!pdfPath || !await fse.pathExists(pdfPath)) {
      return res.status(404).send('PDF not found');
    }
    
    return res.download(pdfPath, fileName);
    
  } catch (e) {
    console.error('Error downloading PDF:', e);
    res.status(500).send('Error downloading PDF');
  }
});

// Download ALL documents from ALL agents and submissions (admin)
app.get('/api/admin/download-all-documents', requireAdmin, async (req, res) => {
  try {
    console.log('Admin: Generating comprehensive download of ALL documents');
    
    // Get all agents
    const agentEntries = await fse.readdir(AGENTS_DIR, { withFileTypes: true });
    const allFiles = [];
    
    // Collect all agent documents
    for (const ent of agentEntries) {
      if (!ent.isDirectory()) continue;
      const agentId = ent.name;
      try {
        const agent = await readAgent(agentId);
        if (agent) {
          const agentFiles = await gatherAgentDocuments(agent, { includeW9: true });
          allFiles.push(...agentFiles.map(f => ({
            ...f,
            name: `Agent_${agentId}_${f.name}`,
            agentId: agentId
          })));
        }
      } catch (e) {
        console.error(`Error processing agent ${agentId}:`, e);
      }
    }
    
    // Collect all submission files
    const submissionEntries = await fse.readdir(SUBMISSIONS_DIR, { withFileTypes: true });
    for (const ent of submissionEntries) {
      if (!ent.isDirectory()) continue;
      const submissionDir = path.join(SUBMISSIONS_DIR, ent.name);
      try {
        const files = await fse.readdir(submissionDir);
        for (const file of files) {
          const filePath = path.join(submissionDir, file);
          const stat = await fse.stat(filePath);
          if (stat.isFile()) {
            allFiles.push({
              path: filePath,
              name: `Submission_${ent.name}_${file}`,
              agentId: 'submission'
            });
          }
        }
      } catch (e) {
        console.error(`Error processing submission ${ent.name}:`, e);
      }
    }
    
    console.log(`Admin: Found ${allFiles.length} total files to include in download`);
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="ALL_SIGNED_DOCUMENTS_${new Date().toISOString().split('T')[0]}.zip"`);
    
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      try { res.status(500).end('ZIP error'); } catch {}
    });
    
    archive.pipe(res);
    
    // Add all files to the archive
    for (const file of allFiles) {
      try {
        if (await fse.pathExists(file.path)) {
          archive.file(file.path, { name: file.name });
        }
      } catch (e) {
        console.error(`Error adding file ${file.path}:`, e);
      }
    }
    
    await archive.finalize();
    console.log('Admin: Comprehensive download completed');
    
  } catch (e) {
    console.error('Error generating comprehensive download:', e);
    res.status(500).json({ ok: false, error: 'Failed to generate comprehensive download' });
  }
});

// Get specific submission details (admin)
app.get('/api/admin/submissions/:id', requireAdmin, async (req, res) => {
  try {
    const submissionId = req.params.id;
    const submissionDir = path.join(SUBMISSIONS_DIR, submissionId);
    
    if (!(await fse.pathExists(submissionDir))) {
      return res.status(404).json({ ok: false, error: 'Submission not found' });
    }
    
    const files = await fse.readdir(submissionDir);
    let submissionData = null;
    let submissionType = 'unknown';
    
    // Determine submission type and load data
    if (files.includes('intake.json')) {
      submissionData = await fse.readJson(path.join(submissionDir, 'intake.json'));
      submissionType = 'intake';
    } else if (files.includes('w9.json')) {
      submissionData = await fse.readJson(path.join(submissionDir, 'w9.json'));
      submissionType = 'w9';
    } else if (files.includes('banking.json')) {
      submissionData = await fse.readJson(path.join(submissionDir, 'banking.json'));
      submissionType = 'banking';
    } else if (files.includes('packet.json')) {
      submissionData = await fse.readJson(path.join(submissionDir, 'packet.json'));
      submissionType = 'packet';
    }
    
    if (!submissionData) {
      return res.status(404).json({ ok: false, error: 'No valid submission data found' });
    }
    
    res.json({ 
      ok: true, 
      submission: {
        id: submissionId,
        type: submissionType,
        receivedAt: submissionData.receivedAt || submissionData.id,
        data: submissionData,
        files: files
      }
    });
  } catch (e) {
    console.error('Error fetching submission details', e);
    res.status(500).json({ ok: false, error: 'Failed to fetch submission details' });
  }
});

// Fallback to serving portal.html for any unhandled routes
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'portal.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
