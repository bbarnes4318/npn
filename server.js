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

// List docs (admin)
app.get('/api/admin/agents/:id/documents/list', requireAdmin, async (req, res) => {
  try {
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).json({ ok: false, error: 'Not found' });
    const files = await gatherAgentDocuments(agent, { includeW9: true });
    res.json({ ok: true, files: files.map(f => ({ name: f.name })) });
  } catch (e) {
    console.error('admin list docs error', e);
    res.status(500).json({ ok: false, error: 'Failed to list documents' });
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

// --- Simple Admin token middleware ---
function requireAdmin(req, res, next) {
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
// User W-9 download disabled; admin route is available under /api/admin/agents/:id/documents/w9.pdf
app.get('/api/agents/:id/documents/w9.pdf', async (req, res) => {
  return res.status(404).send('Not available');
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
        const pdfPath = path.join(dir, `ProducerAgreement_Signed_${Date.now()}.pdf`);
        await new Promise((resolve, reject) => {
          const out = fs.createWriteStream(pdfPath);
          out.on('finish', resolve);
          out.on('error', reject);
          const docPdf = new PDFDocument({ margin: 50 });
          docPdf.pipe(out);
          docPdf.fontSize(16).text('Producer Agreement (REMOTE)', { align: 'center' });
          docPdf.moveDown();
          docPdf.fontSize(11).text('This Producer Agreement (the "Agreement") is made and entered into as of the date written below by and between JJNProtection (the "Company") and the insurance producer (the "Producer").');
          docPdf.moveDown();
          const items = [
            'Authorization to Sign Documents for Carrier Appointments. The Producer authorizes JJNProtection to sign and submit all necessary documents on their behalf related to ACA insurance carrier appointments, including appointment forms, contracting packets, and certification confirmations. JJNProtection is authorized to represent the Producer with GAs, FMOs, and ACA carriers to facilitate onboarding and production access.',
            'Book of Business. All leads, clients, and applications submitted under this Agreement are considered part of the Company\'s Book of Business. The Company retains full ownership. The Producer agrees not to solicit these clients for 2 years following termination of this Agreement. Violation may result in legal action and liability for all related costs.',
            'Confidentiality and Non-Solicitation. The Producer must protect Company data during and after the relationship. No confidential information may be disclosed or reused. For 2 years after termination, the Producer shall not solicit JJNProtection clients or use Company materials for competing work.',
            'Daily and Performance Bonuses. Bonuses, if any, are issued solely at the discretion of JJNProtection management.',
            'Term and Termination. This Agreement becomes effective upon execution and remains in effect until terminated by either party in writing.',
            'General Provisions. This is an independent contractor relationship; no employer-employee relationship exists. This Agreement is governed by the laws of the State of Florida. No modifications will be valid unless in writing and signed by both parties.'
          ];
          items.forEach((t, i) => {
            docPdf.moveDown(0.6);
            docPdf.font('Times-Bold').text(`${i+1}.`, { continued: true });
            docPdf.font('Times-Roman').text(` ${t}`);
          });
          docPdf.moveDown();
          const fullName = `${agent.profile?.firstName || ''} ${agent.profile?.lastName || ''}`.trim();
          if (fullName) docPdf.font('Times-Bold').text('Producer: ', { continued: true }).font('Times-Roman').text(fullName);
          docPdf.moveDown(0.4);
          const signedAt = new Date().toLocaleDateString();
          docPdf.font('Times-Bold').text('Date: ', { continued: true }).font('Times-Roman').text(signedAt);
          try {
            const sigPath = agent.signatures?.producerAgreement?.path;
            if (sigPath && fs.existsSync(sigPath)) {
              docPdf.moveDown();
              docPdf.font('Times-Bold').text('Signature:');
              docPdf.image(sigPath, { fit: [300, 120] });
            }
          } catch {}
          docPdf.end();
        });
        agent.submissions = agent.submissions || {};
        agent.submissions.producerAgreementPdfPath = agent.submissions.producerAgreementPdfPath || null;
        // Save latest
        agent.submissions.producerAgreementPdfPath = path.join(AGENTS_DIR, agent.id, path.basename(pdfPath));
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
        // Attempt to generate and persist the official W-9 PDF to the agent folder
        try {
          const tplPath = DOCS.w9;
          const agentDir = path.join(AGENTS_DIR, agent.id);
          await fse.ensureDir(agentDir);
          const outPath = path.join(agentDir, `W9_${id}.pdf`);
          let pdfBytes = null;
          try {
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
                    try { byName[key].setText(String(value)); } catch {}
                  }
                }
                setIfContains(['name', 'taxpayer name', 'f1_1'], submission.name);
                setIfContains(['business', 'disregarded', 'f1_2'], submission.businessName);
                setIfContains(['address', 'street', 'f1_3'], submission.address?.address1);
                setIfContains(['apt', 'address 2', 'f1_4'], submission.address?.address2);
                setIfContains(['city', 'town', 'f1_5'], submission.address?.city);
                setIfContains(['state', 'f1_6'], submission.address?.state);
                setIfContains(['zip', 'zip code', 'postal', 'f1_7'], submission.address?.zip);
                if (submission.tin?.ssn) setIfContains(['ssn', 'social'], submission.tin.ssn);
                if (submission.tin?.ein) setIfContains(['ein', 'employer'], submission.tin.ein);
                setIfContains(['signature'], submission.certification?.signature);
                setIfContains(['date'], submission.certification?.signatureDate);
                form.flatten();
                pdfBytes = await pdfDoc.save();
              }
            }
          } catch (e) {
            console.warn('pdf-lib W9 build at submission failed, will use fallback', e);
          }
          if (!pdfBytes) {
            // Fallback: create a simple summary PDF using pdfkit (not the official layout)
            pdfBytes = await new Promise((resolve, reject) => {
              const chunks = [];
              const doc = new PDFDocument({ margin: 50 });
              doc.on('data', (b) => chunks.push(b));
              doc.on('end', () => resolve(Buffer.concat(chunks)));
              doc.on('error', reject);
              doc.fontSize(16).text('Form W-9 (Summary)', { align: 'center' });
              doc.moveDown();
              function field(label, value) { doc.font('Times-Bold').text(label + ':', { continued: true }); doc.font('Times-Roman').text(' ' + (value || '')); }
              field('Name', submission.name);
              field('Business name', submission.businessName);
              field('Tax classification', submission.taxClassification);
              if (submission.taxClassification === 'llc') field('LLC classification', submission.llcClassification);
              field('Address 1', submission.address?.address1);
              field('Address 2', submission.address?.address2);
              field('City', submission.address?.city);
              field('State', submission.address?.state);
              field('ZIP', submission.address?.zip);
              field('SSN', submission.tin?.ssn);
              field('EIN', submission.tin?.ein);
              field('Certification signature (typed)', submission.certification?.signature);
              field('Certification date', submission.certification?.signatureDate);
              doc.end();
            });
          }
          await fse.writeFile(outPath, pdfBytes);
          agent.submissions.w9PdfPath = outPath;
        } catch (e) {
          console.warn('Failed to persist W-9 PDF at submission', e);
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

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
