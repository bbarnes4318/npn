const express = require('express');
const path = require('path');
const multer = require('multer');
const fse = require('fs-extra');
const fs = require('fs');
const { nanoid } = require('nanoid');
const archiver = require('archiver');
const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLibDocument, StandardFonts, rgb } = require('pdf-lib');
const SpacesStorage = require('./spaces-storage');
const GoogleSheets = require('./google-sheets');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Spaces storage
const spacesStorage = new SpacesStorage();

// Initialize Google Sheets
const googleSheets = new GoogleSheets();
(async () => {
  const initialized = await googleSheets.initialize();
  if (!initialized) {
    console.error('⚠️  Google Sheets failed to initialize. Check your environment variables:');
    console.error('   GOOGLE_SHEET_ID:', process.env.GOOGLE_SHEET_ID ? 'SET' : 'NOT SET');
    console.error('   GOOGLE_SERVICE_ACCOUNT_KEY:', process.env.GOOGLE_SERVICE_ACCOUNT_KEY ? 'SET' : 'NOT SET');
    console.error('   GOOGLE_SHEET_NAME:', process.env.GOOGLE_SHEET_NAME || 'Agent Onboarding (default)');
  }
})();

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
const uploadMultiple = multer({ 
  dest: UPLOADS_TMP, 
  limits: { fileSize: 10 * 1024 * 1024 },
  fields: [
    { name: 'certProof', maxCount: 1 },
    { name: 'licenseFront', maxCount: 1 },
    { name: 'licenseBack', maxCount: 1 }
  ]
});

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
    const q = (req.query.q || '').toString().trim().toLowerCase();
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    
    // List all agent directories in Spaces
    const files = await spacesStorage.listFiles('agents/');
    const agentDirs = new Set();
    files.forEach(file => {
      const parts = file.Key.split('/');
      if (parts.length >= 2 && parts[0] === 'agents') {
        agentDirs.add(parts[1]);
      }
    });
    
    console.log(`Admin: Found ${agentDirs.size} agent directories in Spaces`);
    const agents = [];
    
    for (const agentId of agentDirs) {
      try {
        const agent = await readAgent(agentId);
        if (!agent) continue;
        
        const email = (agent.profile?.email || '').toLowerCase();
        const name = `${agent.profile?.firstName || ''} ${agent.profile?.lastName || ''}`.toLowerCase();
        if (q && !(email.includes(q) || name.includes(q))) continue;
        
        agents.push({ 
          id: agent.id, 
          createdAt: agent.createdAt || '', 
          profile: agent.profile || {}, 
          progress: agent.progress || {} 
        });
        console.log(`Admin: Added agent ${agent.id} - ${agent.profile?.firstName} ${agent.profile?.lastName}`);
      } catch (e) {
        console.log(`Admin: Error reading agent ${agentId}:`, e.message);
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
    // Prefer local file if path exists; otherwise treat as Spaces key
    try {
      if (await fse.pathExists(file.path)) {
        return res.download(file.path, file.name);
      }
    } catch {}
    const buffer = await spacesStorage.getFileBuffer(file.path);
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buffer);
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

// ------- Document listing and ZIP download -------
async function gatherAgentDocuments(agent, { includeW9 = true } = {}) {
  const files = [];
  try {
    // Local filesystem artifacts first
    if (agent.submissions?.intakePdfPath && await fse.pathExists(agent.submissions.intakePdfPath)) {
      files.push({ path: agent.submissions.intakePdfPath, name: 'SIGNED_INTAKE.pdf' });
    }
    if (includeW9 && agent.submissions?.w9FilePath && await fse.pathExists(agent.submissions.w9FilePath)) {
      const ext = path.extname(agent.submissions.w9FilePath) || '';
      files.push({ path: agent.submissions.w9FilePath, name: `W9_Upload${ext}` });
    }
    if (agent.uploads?.certProof && await fse.pathExists(agent.uploads.certProof)) {
      const ext = path.extname(agent.uploads.certProof) || '';
      files.push({ path: agent.uploads.certProof, name: `CMS_FFM_CertProof${ext}` });
    }

    if (agent.submissions?.intakeId) {
      const dir = path.join(SUBMISSIONS_DIR, agent.submissions.intakeId);
      try {
        const entries = await fse.readdir(dir);
        for (const fname of entries) {
          if (fname === 'intake.json') continue;
          const full = path.join(dir, fname);
          try { const st = await fse.stat(full); if (st.isFile()) files.push({ path: full, name: `Intake_${fname}` }); } catch {}
        }
      } catch {}
    }

    if (includeW9 && agent.submissions?.w9Id) {
      const dir = path.join(SUBMISSIONS_DIR, agent.submissions.w9Id);
      try {
        const entries = await fse.readdir(dir);
        for (const fname of entries) {
          if (fname === 'w9.json' || fname === 'w9_upload.json') continue;
          const full = path.join(dir, fname);
          try { const st = await fse.stat(full); if (st.isFile()) files.push({ path: full, name: `W9_${fname}` }); } catch {}
        }
      } catch {}
    }

    // Also include Spaces keys if they exist (hybrid)
    try {
      const agentFiles = await spacesStorage.listFiles(`agents/${agent.id}/`);
      for (const file of agentFiles) {
        const fileName = file.Key.split('/').pop();
        if (fileName === 'agent.json') continue;
        files.push({ path: file.Key, name: fileName });
      }
      if (agent.submissions?.intakeId) {
        const intakeFiles = await spacesStorage.listFiles(`submissions/${agent.submissions.intakeId}/`);
        intakeFiles.forEach(f => {
          const fileName = f.Key.split('/').pop();
          if (fileName !== 'intake.json') files.push({ path: f.Key, name: `Intake_${fileName}` });
        });
      }
      if (includeW9 && agent.submissions?.w9Id) {
        const w9Files = await spacesStorage.listFiles(`submissions/${agent.submissions.w9Id}/`);
        w9Files.forEach(f => {
          const fileName = f.Key.split('/').pop();
          if (fileName !== 'w9.json' && fileName !== 'w9_upload.json') files.push({ path: f.Key, name: `W9_${fileName}` });
        });
      }
    } catch {}
  } catch (e) {
    console.error('Error gathering agent documents:', e);
  }

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
    for (const f of files) {
      try {
        if (await fse.pathExists(f.path)) {
          archive.file(f.path, { name: f.name });
        } else {
          const buf = await spacesStorage.getFileBuffer(f.path);
          archive.append(buf, { name: f.name });
        }
      } catch {}
    }
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
  try {
    const key = `agents/${agentId}/agent.json`;
    if (await spacesStorage.fileExists(key)) {
      const buffer = await spacesStorage.getFileBuffer(key);
      return JSON.parse(buffer.toString());
    }
    return null;
  } catch (e) {
    console.error(`Error reading agent ${agentId}:`, e);
    return null;
  }
}

async function writeAgent(agent) {
  try {
    const key = `agents/${agent.id}/agent.json`;
    const agentJson = JSON.stringify(agent, null, 2);
    await spacesStorage.uploadBuffer(Buffer.from(agentJson), key, 'application/json');
  } catch (e) {
    console.error(`Error writing agent ${agent.id}:`, e);
    throw e;
  }
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
        const pdfPath = path.join(dir, `ProducerAgreement_Signed_${Date.now()}.pdf`);
        await new Promise((resolve, reject) => {
          const out = fs.createWriteStream(pdfPath);
          out.on('finish', resolve);
          out.on('error', reject);
          const docPdf = new PDFDocument({ margin: 50 });
          docPdf.pipe(out);
          docPdf.fontSize(16).text('Producer Agreement (REMOTE)', { align: 'center' });
          docPdf.moveDown();
          docPdf.fontSize(11).text('This Producer Agreement (the "Agreement") is made and entered into as of the date written below by and between Life Assurance Solutions LLC (the "Company") and the insurance producer (the "Producer").');
          docPdf.moveDown();
          const items = [
            'Authorization to Sign Documents for Carrier Appointments. The Producer authorizes Life Assurance Solutions LLC to sign and submit all necessary documents on their behalf related to ACA (Affordable Care Act) insurance carrier appointments. This includes appointment forms, contracting packets, and certification confirmations. Life Assurance Solutions LLC is also authorized to represent the Producer with GAs, FMOs, and ACA carriers to facilitate onboarding and production access.',
            'Book of Business. All leads, clients, and applications submitted under this Agreement are considered part of the Company\'s Book of Business. The Company retains full ownership of the Book.',
            'Daily and Performance Bonuses. Bonuses, if any, are issued solely at the discretion of Life Assurance Solutions LLC management.',
            'Term and Termination. This Agreement becomes effective upon execution and remains in effect until terminated by either party in writing.',
            'General Provisions. This is an independent contractor relationship; no employer-employee relationship exists. This Agreement is governed by the laws of the State of New Jersey. No modifications will be valid unless in writing and signed by both parties.'
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
app.post('/api/intake', uploadMultiple.fields([
  { name: 'certProof', maxCount: 1 },
  { name: 'licenseFront', maxCount: 1 },
  { name: 'licenseBack', maxCount: 1 }
]), async (req, res) => {
  try {
    const id = nanoid(10);
    const destDir = path.join(SUBMISSIONS_DIR, id);
    await fse.ensureDir(destDir);

    const body = req.body || {};

    // Helper function to process uploaded files
    async function processFile(file, prefix) {
      if (!file || !file[0]) return null;
      const orig = file[0];
      const safeName = orig.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const destPath = path.join(destDir, `${prefix}_${Date.now()}_${safeName}`);
      await fse.move(orig.path, destPath);
      return {
        fieldname: orig.fieldname,
        originalname: orig.originalname,
        mimetype: orig.mimetype,
        size: orig.size,
        path: destPath
      };
    }

    // Process all uploaded files
    const certProof = await processFile(req.files?.certProof, 'cert');
    const licenseFront = await processFile(req.files?.licenseFront, 'license_front');
    const licenseBack = await processFile(req.files?.licenseBack, 'license_back');

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
        crimeConvicted: body.crimeConvicted || 'no',
        crimeConvictedExplain: body.crimeConvictedExplain || '',
        crimeCharged: body.crimeCharged || 'no',
        crimeChargedExplain: body.crimeChargedExplain || '',
        lawsuitParty: body.lawsuitParty || 'no',
        lawsuitPartyExplain: body.lawsuitPartyExplain || '',
        judgmentLien: body.judgmentLien || 'no',
        judgmentLienExplain: body.judgmentLienExplain || '',
        debtLawsuit: body.debtLawsuit || 'no',
        debtLawsuitExplain: body.debtLawsuitExplain || '',
        delinquentTax: body.delinquentTax || 'no',
        delinquentTaxExplain: body.delinquentTaxExplain || '',
        terminatedForCause: body.terminatedForCause || 'no',
        terminatedForCauseExplain: body.terminatedForCauseExplain || '',
        licenseRevoked: body.licenseRevoked || 'no',
        licenseRevokedExplain: body.licenseRevokedExplain || '',
        indebted: body.indebted || 'no',
        indebtedExplain: body.indebtedExplain || '',
        childSupport: body.childSupport || 'no',
        childSupportExplain: body.childSupportExplain || ''
      },
      acknowledgments: {
        producerAgreementAccepted: body.producerAgreementAccepted === 'on' || body.producerAgreementAccepted === 'true',
        privacyNoticeAccepted: body.privacyNoticeAccepted === 'on' || body.privacyNoticeAccepted === 'true',
        signature: body.signature || '',
        signatureDate: body.signatureDate || ''
      },
      attachments: {
        certProof,
        licenseFront,
        licenseBack
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
      submission.agentId = agent.id;
      agent.progress.intakeSubmitted = true;
      agent.submissions.intakeId = id;
      if (certProof?.path) {
        agent.uploads.certProof = certProof.path;
      }
      if (licenseFront?.path) {
        agent.uploads.licenseFront = licenseFront.path;
      }
      if (licenseBack?.path) {
        agent.uploads.licenseBack = licenseBack.path;
      }
      
      // Generate comprehensive signed documents PDF
      try {
        console.log('Generating comprehensive signed documents for intake submission');
        const agentDir = path.join(AGENTS_DIR, agent.id);
        await fse.ensureDir(agentDir);
        const outPath = path.join(agentDir, `SIGNED_INTAKE_DOCUMENTS_${Date.now()}.pdf`);
        
        // Create comprehensive PDF with all intake data
        const pdfBytes = await new Promise((resolve, reject) => {
          const chunks = [];
          const doc = new PDFDocument({ 
            margin: 50,
            size: 'LETTER',
            info: {
              Title: 'Signed Intake Documents',
              Author: 'Life Assurance Solutions LLC',
              Subject: 'Agent Intake Form with Digital Signature'
            }
          });
          
          doc.on('data', (b) => chunks.push(b));
          doc.on('end', () => resolve(Buffer.concat(chunks)));
          doc.on('error', reject);
          
          // Title Page
          doc.fontSize(20).text('SIGNED INTAKE DOCUMENTS', { align: 'center' });
          doc.moveDown(1);
          doc.fontSize(16).text('Life Assurance Solutions LLC', { align: 'center' });
          doc.moveDown(2);
          
          // Agent Information
          doc.fontSize(14).text('AGENT INFORMATION');
          doc.moveDown(0.5);
          doc.fontSize(12).text(`Name: ${submission.contact?.firstName || ''} ${submission.contact?.lastName || ''}`);
          doc.text(`Email: ${submission.contact?.email || ''}`);
          doc.text(`Phone: ${submission.contact?.phone || ''}`);
          doc.text(`Agent ID: ${agent.id}`);
          doc.text(`Date Submitted: ${new Date().toLocaleDateString()}`);
          doc.moveDown(1);
          
          // Business Information
          doc.fontSize(14).text('BUSINESS INFORMATION');
          doc.moveDown(0.5);
          doc.fontSize(12).text(`Agency Name: ${submission.business?.agencyName || ''}`);
          doc.text(`Website: ${submission.business?.website || ''}`);
          doc.text(`Address: ${submission.business?.address1 || ''} ${submission.business?.address2 || ''}`);
          doc.text(`City, State, ZIP: ${submission.business?.city || ''}, ${submission.business?.state || ''} ${submission.business?.zip || ''}`);
          doc.text(`NPN: ${submission.npn || ''}`);
          doc.text(`States Licensed: ${submission.statesLicensed?.join(', ') || ''}`);
          doc.moveDown(1);
          
          // Background Information
          doc.fontSize(14).text('BACKGROUND INFORMATION');
          doc.moveDown(0.5);
          doc.fontSize(12);
          doc.text(`Crime Convicted: ${submission.background?.crimeConvicted === 'yes' ? 'YES' : 'NO'}`);
          if (submission.background?.crimeConvictedExplain) {
            doc.text(`Explanation: ${submission.background.crimeConvictedExplain}`);
          }
          doc.text(`Crime Charged: ${submission.background?.crimeCharged === 'yes' ? 'YES' : 'NO'}`);
          if (submission.background?.crimeChargedExplain) {
            doc.text(`Explanation: ${submission.background.crimeChargedExplain}`);
          }
          doc.text(`Lawsuit Party: ${submission.background?.lawsuitParty === 'yes' ? 'YES' : 'NO'}`);
          if (submission.background?.lawsuitPartyExplain) {
            doc.text(`Explanation: ${submission.background.lawsuitPartyExplain}`);
          }
          doc.text(`Judgment Lien: ${submission.background?.judgmentLien === 'yes' ? 'YES' : 'NO'}`);
          if (submission.background?.judgmentLienExplain) {
            doc.text(`Explanation: ${submission.background.judgmentLienExplain}`);
          }
          doc.text(`Debt Lawsuit: ${submission.background?.debtLawsuit === 'yes' ? 'YES' : 'NO'}`);
          if (submission.background?.debtLawsuitExplain) {
            doc.text(`Explanation: ${submission.background.debtLawsuitExplain}`);
          }
          doc.text(`Delinquent Tax: ${submission.background?.delinquentTax === 'yes' ? 'YES' : 'NO'}`);
          if (submission.background?.delinquentTaxExplain) {
            doc.text(`Explanation: ${submission.background.delinquentTaxExplain}`);
          }
          doc.text(`Terminated For Cause: ${submission.background?.terminatedForCause === 'yes' ? 'YES' : 'NO'}`);
          if (submission.background?.terminatedForCauseExplain) {
            doc.text(`Explanation: ${submission.background.terminatedForCauseExplain}`);
          }
          doc.text(`License Revoked: ${submission.background?.licenseRevoked === 'yes' ? 'YES' : 'NO'}`);
          if (submission.background?.licenseRevokedExplain) {
            doc.text(`Explanation: ${submission.background.licenseRevokedExplain}`);
          }
          doc.text(`Indebted: ${submission.background?.indebted === 'yes' ? 'YES' : 'NO'}`);
          if (submission.background?.indebtedExplain) {
            doc.text(`Explanation: ${submission.background.indebtedExplain}`);
          }
          doc.text(`Child Support: ${submission.background?.childSupport === 'yes' ? 'YES' : 'NO'}`);
          if (submission.background?.childSupportExplain) {
            doc.text(`Explanation: ${submission.background.childSupportExplain}`);
          }
          doc.moveDown(1);
          
          // Signatures Section
          doc.fontSize(14).text('DIGITAL SIGNATURES AND CERTIFICATIONS');
          doc.moveDown(0.5);
          doc.fontSize(12).text(`Digital Signature: ${submission.acknowledgments?.signature || ''}`);
          doc.text(`Signature Date: ${submission.acknowledgments?.signatureDate || ''}`);
          doc.text(`Producer Agreement Accepted: ${submission.acknowledgments?.producerAgreementAccepted ? 'YES' : 'NO'}`);
          doc.text(`Privacy Notice Accepted: ${submission.acknowledgments?.privacyNoticeAccepted ? 'YES' : 'NO'}`);
          doc.moveDown(1);
          
          // Legal Notice
          doc.fontSize(10).text('This document contains all submitted information and signatures as of the date of generation.');
          doc.text('All signatures are legally binding and represent the agent\'s agreement to the terms and conditions.');
          
          doc.end();
        });
        
        await fse.writeFile(outPath, pdfBytes);
        agent.submissions.intakePdfPath = outPath;
        console.log('Signed intake documents PDF saved to:', outPath);
      } catch (e) {
        console.error('Failed to generate intake PDF:', e);
      }
      
        await writeAgent(agent);
    }

    // Write to Google Sheets
    console.log('📊 Writing intake data to Google Sheets for agent:', submission.agentId || 'N/A');
    try {
      const result = await googleSheets.appendIntakeData(submission);
      if (!result) {
        console.error('⚠️  Google Sheets write returned false - check logs above');
      }
    } catch (sheetsErr) {
      console.error('❌ EXCEPTION writing to Google Sheets (non-fatal):', sheetsErr);
      console.error('   Stack:', sheetsErr.stack);
      // Don't fail the request if Google Sheets write fails
    }

    res.json({ ok: true, id, agent: agent ? { id: agent.id } : null });
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
    let agent = null;
    if (body.agentId) {
      agent = await readAgent(body.agentId);
    if (agent) {
      submission.agentId = agent.id;
      agent.progress.w9Submitted = true;
      agent.submissions.w9Id = id;
      
      // Generate official W-9 PDF
      try {
          console.log('Generating official W-9 PDF for agent:', agent.id);
          const agentDir = path.join(AGENTS_DIR, agent.id);
          await fse.ensureDir(agentDir);
          const outPath = path.join(agentDir, `SIGNED_W9_FORM_${Date.now()}.pdf`);
          console.log('Signed W-9 PDF will be saved to:', outPath);
          
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
            
            // W-9 Header
            doc.fontSize(20).text('FORM W-9', { align: 'center' });
            doc.moveDown(1);
            doc.fontSize(14).text('Request for Taxpayer Identification Number and Certification', { align: 'center' });
            doc.moveDown(2);
            
            // Part I - Taxpayer Information
            doc.fontSize(16).text('PART I — TAXPAYER INFORMATION');
            doc.moveDown(1);
            
            // Name
            doc.fontSize(12).text('1 Name (as shown on your income tax return):');
            doc.moveDown(0.5);
            doc.fontSize(14).text(submission.name || '_________________________________');
            doc.moveDown(1);
            
            // Business Name
            doc.fontSize(12).text('2 Business name/disregarded entity name, if different from above:');
            doc.moveDown(0.5);
            doc.fontSize(14).text(submission.businessName || '_________________________________');
            doc.moveDown(1);
            
            // Tax Classification
            doc.fontSize(12).text('3 Check appropriate box for federal tax classification:');
            doc.moveDown(0.5);
            
            const classifications = [
              { key: 'individual', text: 'Individual/sole proprietor or single-member LLC' },
              { key: 'c_corporation', text: 'C Corporation' },
              { key: 's_corporation', text: 'S Corporation' },
              { key: 'partnership', text: 'Partnership' },
              { key: 'trust', text: 'Trust/estate' },
              { key: 'llc', text: 'LLC' },
              { key: 'other', text: 'Other' }
            ];
            
            classifications.forEach((cls, i) => {
              const isChecked = submission.taxClassification === cls.key;
              doc.text(`${isChecked ? '☑' : '☐'} ${cls.text}`);
            });
            
            if (submission.taxClassification === 'llc' && submission.llcClassification) {
              doc.moveDown(0.5);
              doc.text(`LLC Classification: ${submission.llcClassification}`);
            }
            
            doc.moveDown(1);
            
            // Address
            doc.fontSize(12).text('4 Address (number, street, and apt. or suite no.):');
            doc.moveDown(0.5);
            doc.fontSize(14).text(submission.address?.address1 || '_________________________________');
            doc.moveDown(0.5);
            doc.fontSize(12).text('City, state, and ZIP code:');
            doc.fontSize(14).text(`${submission.address?.city || ''}, ${submission.address?.state || ''} ${submission.address?.zip || ''}`);
            doc.moveDown(2);
            
            // Part II - Certification
            doc.fontSize(16).text('PART II — CERTIFICATION');
            doc.moveDown(1);
            
            // TIN
            doc.fontSize(12).text('5 Requesting taxpayer\'s identification number (TIN):');
            doc.moveDown(0.5);
            
            if (submission.tin?.ssn) {
              doc.fontSize(14).text(`☑ SSN: ${submission.tin.ssn}`);
            } else if (submission.tin?.ein) {
              doc.fontSize(14).text(`☑ EIN: ${submission.tin.ein}`);
            } else {
              doc.text('☐ SSN: _________________  ☐ EIN: _________________');
            }
            
            doc.moveDown(1);
            
            // Certification text
            doc.fontSize(12).text('6 Under penalties of perjury, I certify that:');
            doc.moveDown(0.5);
            doc.text('1. The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me), and');
            doc.text('2. I am not subject to backup withholding because: (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I are no longer subject to backup withholding, and');
            doc.text('3. I am a U.S. person (including a U.S. resident alien), and');
            doc.text('4. The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.');
            doc.moveDown(2);
            
            // Signature Section
            doc.fontSize(16).text('SIGNATURE SECTION');
            doc.moveDown(1);
            doc.fontSize(14).text(`Digital Signature: ${submission.certification?.signature || 'NOT PROVIDED'}`);
            doc.fontSize(14).text(`Signature Date: ${submission.certification?.signatureDate || 'NOT PROVIDED'}`);
            doc.moveDown(2);
            
            // Legal Notice
            doc.fontSize(12).text('This document contains the signed W-9 form with digital signature as of the date of generation.');
            doc.text('The digital signature is legally binding and represents the taxpayer\'s certification under penalties of perjury.');
            
            doc.end();
          });
          
          await fse.writeFile(outPath, pdfBytes);
          agent.submissions.w9PdfPath = outPath;
          console.log('Signed W-9 PDF saved successfully to:', outPath);
      } catch (e) {
          console.error('Failed to generate W-9 PDF:', e);
      }
      
        await writeAgent(agent);
      }
    }

    // Write to Google Sheets
    try {
      await googleSheets.appendW9Data(submission);
    } catch (sheetsErr) {
      console.error('Error writing to Google Sheets (non-fatal):', sheetsErr);
      // Don't fail the request if Google Sheets write fails
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

    // Validate account number confirmation
    if (body.accountNumber !== body.confirmAccountNumber) {
      return res.status(400).json({ ok: false, error: 'Account numbers do not match' });
    }

    if (body.routingNumber !== body.confirmRoutingNumber) {
      return res.status(400).json({ ok: false, error: 'Routing numbers do not match' });
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
    let agent = null;
    if (agentId) {
      agent = await readAgent(agentId);
    if (agent) {
      submission.agentId = agent.id;
      agent.progress.bankingSubmitted = true;
      agent.submissions.bankingId = id;
      agent.banking = {
        bankName: submission.bankName,
        accountType: submission.accountType,
        paymentMethod: submission.paymentMethod,
        lastUpdated: new Date().toISOString()
      };
        await writeAgent(agent);
      }
    }

    // Write to Google Sheets
    try {
      await googleSheets.appendBankingData(submission);
    } catch (sheetsErr) {
      console.error('Error writing to Google Sheets (non-fatal):', sheetsErr);
      // Don't fail the request if Google Sheets write fails
    }

    res.json({ ok: true, id });
  } catch (err) {
    console.error('Error handling /api/banking', err);
    res.status(500).json({ ok: false, error: 'Failed to save banking information' });
  }
});

// Partners ACA lead submission
app.post('/api/partners/lead', async (req, res) => {
  try {
    const body = req.body || {};
    
    // Validate required fields
    const requiredFields = ['name', 'email', 'company'];
    for (const field of requiredFields) {
      if (!body[field] || body[field].trim() === '') {
        return res.status(400).json({ ok: false, error: `Missing required field: ${field}` });
      }
    }

    // Sanitize input data
    const sanitizedData = {
      name: (body.name || '').toString().trim(),
      email: (body.email || '').toString().trim().toLowerCase(),
      phone: (body.phone || '').toString().trim(),
      company: (body.company || '').toString().trim(),
      states: (body.states || '').toString().trim()
    };

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sanitizedData.email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email format' });
    }

    // Simple rate limiting (in-memory)
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const rateLimitKey = `partners_lead_${clientIP}`;
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 20;

    if (!global.rateLimitStore) {
      global.rateLimitStore = new Map();
    }

    const requests = global.rateLimitStore.get(rateLimitKey) || [];
    const recentRequests = requests.filter(time => now - time < windowMs);
    
    if (recentRequests.length >= maxRequests) {
      return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });
    }

    recentRequests.push(now);
    global.rateLimitStore.set(rateLimitKey, recentRequests);

    // Create lead payload
    const leadId = nanoid(10);
    const leadData = {
      type: 'partners_aca_lead',
      id: leadId,
      name: sanitizedData.name,
      email: sanitizedData.email,
      phone: sanitizedData.phone,
      company: sanitizedData.company,
      states: sanitizedData.states,
      ts: new Date().toISOString(),
      userAgent: req.get('User-Agent') || '',
      ip: clientIP
    };

    // Persist to DigitalOcean Spaces
    const fileName = `${new Date().toISOString().split('T')[0]}_${leadId}.json`;
    const key = `leads/partners_aca/${fileName}`;
    
    try {
      await spacesStorage.uploadBuffer(
        Buffer.from(JSON.stringify(leadData, null, 2)),
        key,
        'application/json'
      );
      
      console.log(`Partners ACA lead saved: ${leadId} for ${sanitizedData.company}`);
      
      res.json({ ok: true, id: leadId });
    } catch (storageError) {
      console.error('Failed to save lead to Spaces:', storageError);
      
      // Fallback: save locally if Spaces fails
      const localDir = path.join(ROOT, 'leads', 'partners_aca');
      await fse.ensureDir(localDir);
      const localPath = path.join(localDir, fileName);
      await fse.writeJson(localPath, leadData, { spaces: 2 });
      
      console.log(`Partners ACA lead saved locally: ${leadId}`);
      res.json({ ok: true, id: leadId });
    }

  } catch (err) {
    console.error('Error handling /api/partners/lead', err);
    res.status(500).json({ ok: false, error: 'Failed to save lead information' });
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
    
    // List all agent directories in Spaces
    const files = await spacesStorage.listFiles('agents/');
    const agentDirs = new Set();
    files.forEach(file => {
      const parts = file.Key.split('/');
      if (parts.length >= 2 && parts[0] === 'agents') {
        agentDirs.add(parts[1]);
      }
    });
    
    for (const agentId of agentDirs) {
      try {
        const agent = await readAgent(agentId);
        if (agent) {
          const agentName = `${agent.profile?.firstName || ''} ${agent.profile?.lastName || ''}`.trim() || 'Unknown';
          
          // Get all files for this agent
          const agentFiles = await spacesStorage.listFiles(`agents/${agentId}/`);
          
          for (const file of agentFiles) {
            const fileName = file.Key.split('/').pop();
            if (fileName.toLowerCase().endsWith('.pdf')) {
            allPdfs.push({
              agentId: agentId,
              agentName: agentName,
                type: fileName.includes('SIGNED_INTAKE') ? 'Signed Intake Documents' : 
                      fileName.includes('SIGNED_W9') ? 'Signed W9 Form' :
                      fileName.includes('SIGNED_BANKING') ? 'Signed Banking Form' : 'Other PDF',
                pdfPath: file.Key,
                fileName: fileName,
                date: file.LastModified.toISOString(),
                size: file.Size
              });
            }
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
    
    // Look for the file in Spaces
    const key = `agents/${agentId}/${fileName}`;
    
    if (!await spacesStorage.fileExists(key)) {
      return res.status(404).send('PDF not found');
    }
    
    // Get file from Spaces and stream it
    const buffer = await spacesStorage.getFileBuffer(key);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(buffer);
    
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

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
