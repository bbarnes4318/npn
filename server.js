const express = require('express');
const path = require('path');
const multer = require('multer');
const fse = require('fs-extra');
const { nanoid } = require('nanoid');
const archiver = require('archiver');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

// Paths
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOADS_TMP = process.env.UPLOADS_DIR || path.join(ROOT, 'uploads');
const SUBMISSIONS_DIR = process.env.SUBMISSIONS_DIR || path.join(ROOT, 'submissions');
const AGENTS_DIR = process.env.AGENTS_DIR || path.join(ROOT, 'agents');

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

// ------- Document listing and ZIP download -------
async function gatherAgentDocuments(agent) {
  const files = [];
  try {
    // Producer Agreement drawn signature
    const sig = agent.signatures?.producerAgreement;
    if (sig?.path && await fse.pathExists(sig.path)) {
      files.push({ path: sig.path, name: `ProducerAgreement_Signature_${agent.id}.png` });
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
    // W-9 e-sign JSON
    const w9Id = agent.submissions?.w9Id;
    if (w9Id) {
      const w9Json = path.join(SUBMISSIONS_DIR, w9Id, 'w9.json');
      if (await fse.pathExists(w9Json)) files.push({ path: w9Json, name: `W9_${w9Id}.json` });
    }
    // W-9 uploaded file (agent-bound)
    if (agent.submissions?.w9FilePath && await fse.pathExists(agent.submissions.w9FilePath)) {
      const ext = path.extname(agent.submissions.w9FilePath) || '';
      files.push({ path: agent.submissions.w9FilePath, name: `W9_Upload_${agent.id}${ext}` });
    }
  } catch {}
  return files;
}

// List document names for an agent (for admin UI)
app.get('/api/agents/:id/documents/list', async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).json({ ok: false, error: 'Not found' });
    const files = await gatherAgentDocuments(agent);
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
    const files = await gatherAgentDocuments(agent);
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
  paycor: path.join(ROOT, 'Paycor Fillable Form 2025.pdf')
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
      doc.fontSize(11).text('This Producer Agreement (the "Agreement") is made and entered into as of the date written below by and between JJNProtection (the "Company") and the insurance producer (the "Producer").');
      doc.moveDown();
      const items = [
        'Authorization to Sign Documents for Carrier Appointments. The Producer authorizes JJNProtection to sign and submit all necessary documents on their behalf related to ACA insurance carrier appointments, including appointment forms, contracting packets, and certification confirmations. JJNProtection is authorized to represent the Producer with GAs, FMOs, and ACA carriers to facilitate onboarding and production access.',
        'Book of Business. All leads, clients, and applications submitted under this Agreement are considered part of the Company\'s Book of Business. The Company retains full ownership. The Producer agrees not to solicit these clients for 2 years following termination of this Agreement. Violation may result in legal action and liability for all related costs.',
        'Confidentiality and Non-Solicitation. The Producer must protect Company data during and after the relationship. No confidential information may be disclosed or reused. For 2 years after termination, the Producer shall not solicit JJNProtection clients or use Company materials for competing work.',
        'Daily and Performance Bonuses. Bonuses, if any, are issued solely at the discretion of JJNProtection management.',
        'Term and Termination. This Agreement becomes effective upon execution and remains in effect until terminated by either party in writing.',
        'General Provisions. This is an independent contractor relationship; no employer-employee relationship exists. This Agreement is governed by the laws of the State of Florida. No modifications will be valid unless in writing and signed by both parties.'
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

// Per-document downloads
// Generate W-9 PDF from e-sign JSON if available; otherwise return uploaded file if present
app.get('/api/agents/:id/documents/w9.pdf', async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).send('Not found');
    const w9Id = agent.submissions?.w9Id;
    const uploadedPath = agent.submissions?.w9FilePath;
    if (w9Id) {
      const w9JsonPath = path.join(SUBMISSIONS_DIR, w9Id, 'w9.json');
      if (await fse.pathExists(w9JsonPath)) {
        const data = await fse.readJson(w9JsonPath);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="W9_${w9Id}.pdf"`);
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
      // Stream the uploaded file directly
      const filename = `W9_Upload_${agent.id}${path.extname(uploadedPath)}`;
      return res.download(uploadedPath, filename);
    }
    return res.status(404).send('No W-9 found');
  } catch (e) {
    console.error('w9.pdf error', e);
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

// Create agent
app.post('/api/agents', async (req, res) => {
  try {
    const agent = newAgent({
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      phone: req.body.phone
    });
    await writeAgent(agent);
    res.json({ ok: true, agent });
  } catch (e) {
    console.error('Error creating agent', e);
    res.status(500).json({ ok: false, error: 'Failed to create agent' });
  }
});

// Find agent by email
app.get('/api/agents/find', async (req, res) => {
  try {
    const email = (req.query.email || '').toString().trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: 'Email required' });
    const entries = await fse.readdir(AGENTS_DIR, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const p = path.join(AGENTS_DIR, ent.name, 'agent.json');
      if (!(await fse.pathExists(p))) continue;
      try {
        const a = await fse.readJson(p);
        if ((a.profile?.email || '').toLowerCase() === email) {
          return res.json({ ok: true, agent: a });
        }
      } catch {}
    }
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
    // Link to agent if provided
    if (body.agentId) {
      const agent = await readAgent(body.agentId);
      if (agent) {
        agent.progress.intakeSubmitted = true;
        agent.submissions.intakeId = id;
        if (certProof?.path) {
          agent.uploads.certProof = certProof.path;
        }
        await writeAgent(agent);
      }
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
        await writeAgent(agent);
      }
    }
    res.json({ ok: true, id });
  } catch (err) {
    console.error('Error handling /api/w9', err);
    res.status(500).json({ ok: false, error: 'Failed to save W-9 submission' });
  }
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
