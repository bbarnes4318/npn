const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLibDocument, StandardFonts, rgb } = require('pdf-lib');
const fse = require('fs-extra');

/**
 * Generates a substitute W-9 PDF from submission data using pdfkit.
 * This is a fallback method.
 * @param {object} data - The W-9 submission data.
 * @returns {Promise<Buffer>} - A promise that resolves with the PDF data as a Buffer.
 */
function generateW9SubstitutePdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

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
  });
}

/**
 * Generates a Producer Agreement PDF.
 * @param {object} agent - The agent data.
 * @returns {Promise<Buffer>} - A promise that resolves with the PDF data as a Buffer.
 */
function generateProducerAgreementPdf(agent) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

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
      doc.font('Times-Bold').text(`${i + 1}.`, { continued: true });
      doc.font('Times-Roman').text(` ${t}`);
    });
    doc.moveDown();
    const fullName = `${agent.profile?.firstName || ''} ${agent.profile?.lastName || ''}`.trim();
    if (fullName) doc.font('Times-Bold').text('Producer: ', { continued: true }).font('Times-Roman').text(fullName);
    doc.moveDown(0.4);
    const signedAt = new Date().toLocaleDateString();
    doc.font('Times-Bold').text('Date: ', { continued: true }).font('Times-Roman').text(signedAt);
    try {
      const sigPath = agent.signatures?.producerAgreement?.path;
      if (sigPath && fse.existsSync(sigPath)) {
        doc.moveDown();
        doc.font('Times-Bold').text('Signature:');
        doc.image(sigPath, { fit: [300, 120] });
      }
    } catch {}
    doc.end();
  });
}

/**
 * Generates a comprehensive signed documents PDF for an intake submission.
 * @param {object} submission - The intake submission data.
 * @param {object} agent - The agent data.
 * @returns {Promise<Buffer>} - A promise that resolves with the PDF data as a Buffer.
 */
function generateIntakePdf(submission, agent) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: 'LETTER',
      info: {
        Title: 'Signed Intake Documents',
        Author: 'Life Assurance Solutions LLC',
        Subject: 'Agent Intake Form with Digital Signature'
      }
    });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
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
    doc.fontSize(12).text(`Prior Terminations: ${submission.background?.priorTerminations ? 'YES' : 'NO'}`);
    if (submission.background?.priorTerminationsExplain) {
      doc.text(`Termination Explanation: ${submission.background.priorTerminationsExplain}`);
    }
    doc.text(`Felonies: ${submission.background?.felonies ? 'YES' : 'NO'}`);
    if (submission.background?.feloniesExplain) {
      doc.text(`Felony Explanation: ${submission.background.feloniesExplain}`);
    }
    doc.text(`Bankruptcies: ${submission.background?.bankruptcies ? 'YES' : 'NO'}`);
    if (submission.background?.bankruptciesExplain) {
      doc.text(`Bankruptcy Explanation: ${submission.background.bankruptciesExplain}`);
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
}

/**
 * Generates a banking information PDF.
 * @param {object} submission - The banking submission data.
 * @returns {Promise<Buffer>} - A promise that resolves with the PDF data as a Buffer.
 */
function generateBankingPdf(submission) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // Header
    doc.fontSize(20).text('Square 1099 Employee & Banking Information', { align: 'center' });
    doc.moveDown(2);

    // Helper for fields
    function field(label, value) {
      doc.font('Helvetica-Bold').text(label + ':', { continued: true }).font('Helvetica').text(' ' + (value || 'N/A'));
      doc.moveDown(0.5);
    }

    function sectionHeader(title) {
      doc.font('Helvetica-Bold').fontSize(16).text(title);
      doc.moveDown(1);
    }

    // Employee Info
    sectionHeader('Employee Information');
    field('Full Name', `${submission.employeeInfo.firstName} ${submission.employeeInfo.lastName}`);
    field('Address', `${submission.employeeInfo.streetAddress}, ${submission.employeeInfo.city}, ${submission.employeeInfo.state} ${submission.employeeInfo.zipCode}`);
    field('SSN', `***-**-${(submission.employeeInfo.ssn || '    ').slice(-4)}`); // Masked SSN
    field('Date of Birth', submission.employeeInfo.dateOfBirth);
    field('Date of Hire', submission.employeeInfo.dateOfHire);
    doc.moveDown(1);

    // Banking Info
    sectionHeader('Banking Information');
    field('Bank Name', submission.bankName);
    field('Account Holder Name', submission.accountHolderName);
    field('Account Type', submission.accountType);
    field('Routing Number', `******${(submission.routingNumber || '   ').slice(-3)}`); // Masked
    field('Account Number', `******${(submission.accountNumber || '   ').slice(-4)}`); // Masked
    field('Payment Method', submission.paymentMethod);
    doc.moveDown(1);

    // Authorizations
    sectionHeader('Authorizations & Signature');
    doc.fontSize(12).text('The employee has authorized the following:');
    doc.list([
      `Direct Deposit Authorized: ${submission.authorizations.authorizeDirectDeposit ? 'YES' : 'NO'}`,
      `Banking Information Verified: ${submission.authorizations.verifyBankingInfo ? 'YES' : 'NO'}`,
      `Privacy Consent Given: ${submission.authorizations.privacyConsent ? 'YES' : 'NO'}`
    ]);
    doc.moveDown(1);
    field('Digital Signature', submission.signature.digitalSignature);
    field('Signature Date', submission.signature.signatureDate);
    doc.moveDown(2);

    // Legal Notice
    doc.fontSize(10).text('This document contains the banking information and authorizations provided by the employee for payment purposes. The information is certified as correct by the digital signature above.', {
      align: 'center'
    });

    doc.end();
  });
}

module.exports = {
  generateW9SubstitutePdf,
  generateProducerAgreementPdf,
  generateIntakePdf,
  generateBankingPdf,
};
