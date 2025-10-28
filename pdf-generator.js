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

    // Header
    doc.fontSize(16).text('LIFE ASSURANCE SOLUTIONS LLC & JJN PROTECTION INSURANCE AGENCY LLC', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(18).text('REMOTE PRODUCER AGREEMENT (ACA DIVISION)', { align: 'center' });
    doc.moveDown(1);
    
    // Introduction
    doc.fontSize(11).text('This Remote Producer Agreement ("Agreement") is made and entered into as of the date written below by and between Life Assurance Solutions, LLC and JJN Protection Insurance Agency, LLC (collectively referred to herein as the "Company"), and the undersigned licensed insurance producer ("Producer").');
    doc.moveDown(1);

    // Producer Information
    const fullName = `${agent.profile?.firstName || ''} ${agent.profile?.lastName || ''}`.trim();
    doc.fontSize(12).text('Producer Name: ' + (fullName || '___________________________________________'));
    doc.text('NPN (National Producer Number): ____________________________________________');
    doc.moveDown(1);

    // RECITALS
    doc.fontSize(14).text('RECITALS', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).text('WHEREAS:');
    doc.moveDown(0.5);
    doc.text('The Company is engaged in the business of providing health and life insurance products; and');
    doc.moveDown(0.3);
    doc.text('The Producer is engaged in soliciting, marketing, and submitting insurance applications and desires to do so on behalf of the Company remotely;');
    doc.moveDown(0.5);
    doc.text('NOW, THEREFORE, in consideration of the mutual covenants and promises contained herein, the parties agree as follows:');
    doc.moveDown(1);

    // Section 1: AUTHORIZATION & REPRESENTATION
    doc.fontSize(14).text('1. AUTHORIZATION & REPRESENTATION', { underline: true });
    doc.moveDown(0.5);
    
    doc.fontSize(12).text('1.1 Carrier Appointments', { underline: true });
    doc.fontSize(11).text('The Producer authorizes Life Assurance Solutions, LLC to sign and submit all necessary documentation on their behalf related to Affordable Care Act (ACA) carrier appointments. This includes appointment forms, contracting packets, and certification confirmations.');
    doc.moveDown(0.3);
    doc.text('JJN Protection Insurance Agency LLC and Life Assurance Solutions LLC are authorized to represent the Producer with General Agencies (GAs), Field Marketing Organizations (FMOs), and ACA carriers to facilitate onboarding, contracting, and production access.');
    doc.moveDown(0.5);
    
    doc.fontSize(12).text('1.2 NPN Override Authorization', { underline: true });
    doc.fontSize(11).text('The Producer acknowledges that the Company has been granted NPN Override permission to establish the Producer within its agency hierarchy. This authorization allows the Company to utilize the Producer\'s NPN for overrides for agents referred or supervised by the Producer.');
    doc.moveDown(0.3);
    doc.text('This authorization will not affect the Producer\'s personal book of business outside this Agreement and ensures accurate tracking and crediting of all enrollments.');
    doc.moveDown(1);

    // Section 2: POSITION & COMPENSATION
    doc.fontSize(14).text('2. POSITION & COMPENSATION', { underline: true });
    doc.moveDown(0.5);
    
    doc.fontSize(12).text('2.1 Position Title: ACA Health Insurance Producer (Remote)', { underline: true });
    doc.moveDown(0.5);
    
    doc.fontSize(12).text('2.2 Compensation', { underline: true });
    doc.fontSize(11).text('Hourly Pay: $12 per hour');
    doc.text('Per-Sale Bonus: $15 per sale beginning with the 6th sale of each workday');
    doc.text('Residual Pay: $2 per active plan per month, beginning February 2026');
    doc.moveDown(0.5);
    
    doc.fontSize(12).text('2.3 Payment Conditions', { underline: true });
    doc.fontSize(11).text('Payment is contingent upon:');
    doc.text('The policy remaining active/on-book, and');
    doc.text('Proper placement of the Producer\'s NPN on each application.');
    doc.moveDown(0.5);
    
    doc.fontSize(12).text('2.4 Chargebacks', { underline: true });
    doc.fontSize(11).text('Any commissions reversed due to policy cancellation will be deducted or charged back from future payments within 30 days of notification.');
    doc.moveDown(0.5);
    
    doc.fontSize(12).text('2.5 Bonuses', { underline: true });
    doc.fontSize(11).text('Daily or performance-based bonuses may be offered solely at the discretion of Company management.');
    doc.moveDown(1);

    // Section 3: WORK SCHEDULE & SALES EXPECTATIONS
    doc.fontSize(14).text('3. WORK SCHEDULE & SALES EXPECTATIONS', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).text('3.1 Work Hours: Monday through Friday, 9:00 AM – 8:00 PM EST; Saturday & Sunday, 9:00 AM – 6:00 PM EST');
    doc.text('3.2 Sales Goal: A minimum of five (5) sales per day is required to remain eligible for base pay.');
    doc.text('3.3 Breaks: Producer may take a 1-hour lunch and two (2) 15-minute breaks each workday.');
    doc.moveDown(1);

    // Section 4: REMOTE WORK RULES & EXPECTATIONS
    doc.fontSize(14).text('4. REMOTE WORK RULES & EXPECTATIONS', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).text('The Producer agrees to the following standards of conduct and remote work policies:');
    doc.moveDown(0.5);
    
    doc.fontSize(12).text('4.1 Work Hours & Availability', { underline: true });
    doc.fontSize(11).text('Producer must be logged in, available, and actively engaged during scheduled work hours.');
    doc.text('Any change to work schedule must be pre-approved by management.');
    doc.text('Attendance at daily check-ins via Google Meet is required.');
    doc.moveDown(0.5);
    
    doc.fontSize(12).text('4.2 Communication', { underline: true });
    doc.fontSize(11).text('Producer must use official company email for all work-related communications.');
    doc.text('Maintain prompt communication with management via approved messaging platforms.');
    doc.text('Keep phone and email accessible for client inquiries during work hours.');
    doc.moveDown(0.5);
    
    doc.fontSize(12).text('4.3 Workspace & Equipment', { underline: true });
    doc.fontSize(11).text('Maintain a quiet, distraction-free workspace.');
    doc.text('Ensure a stable internet connection, reliable computer, and functional headset.');
    doc.text('Immediately report any technical issues that may affect productivity.');
    doc.moveDown(0.5);
    
    doc.fontSize(12).text('4.4 Data Security & Privacy', { underline: true });
    doc.fontSize(11).text('Maintain confidentiality of all client and company data.');
    doc.text('Use encrypted communication channels only.');
    doc.text('Do not share passwords or login credentials with any third party.');
    doc.text('Log out of systems when not in use and maintain up-to-date security software.');
    doc.moveDown(0.5);
    
    doc.fontSize(12).text('4.5 Team Collaboration', { underline: true });
    doc.fontSize(11).text('Attend scheduled team meetings and training sessions.');
    doc.text('Participate actively in the Google Meet "Remote Agents" group to collaborate and share updates.');
    doc.moveDown(0.5);
    
    doc.fontSize(12).text('4.6 Performance Review', { underline: true });
    doc.fontSize(11).text('Performance will be monitored based on sales volume, compliance, and professionalism.');
    doc.text('Producer agrees to proactively seek assistance when performance goals are not met.');
    doc.moveDown(0.5);
    
    doc.fontSize(12).text('4.7 Time Off & Absences', { underline: true });
    doc.fontSize(11).text('Notify management immediately in the event of illness or emergency.');
    doc.text('Submit all time-off requests in advance and avoid absences during Open Enrollment or SEP periods.');
    doc.moveDown(1);

    // Section 5: BOOK OF BUSINESS & OWNERSHIP
    doc.fontSize(14).text('5. BOOK OF BUSINESS & OWNERSHIP', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).text('All leads, clients, and applications generated under this Agreement shall be considered part of the Company\'s Book of Business.');
    doc.text('The Company retains full and exclusive ownership of such data, leads, and client records.');
    doc.moveDown(1);

    // Section 6: CONFIDENTIALITY & NON-SOLICITATION
    doc.fontSize(14).text('6. CONFIDENTIALITY & NON-SOLICITATION', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).text('The Producer shall not disclose, use, or retain any Company data or client information after termination.');
    doc.text('The Producer shall not solicit or attempt to solicit any Company clients or agents for 12 months following termination of this Agreement.');
    doc.moveDown(1);

    // Section 7: INDEPENDENT CONTRACTOR RELATIONSHIP
    doc.fontSize(14).text('7. INDEPENDENT CONTRACTOR RELATIONSHIP', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).text('The Producer is an independent contractor and not an employee of the Company.');
    doc.text('Producer is responsible for all taxes, licenses, and certifications required for their position.');
    doc.text('Nothing in this Agreement shall be construed to create an employer–employee relationship.');
    doc.moveDown(1);

    // Section 8: TERM & TERMINATION
    doc.fontSize(14).text('8. TERM & TERMINATION', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).text('This Agreement becomes effective upon execution and shall remain in force until terminated by either party in writing.');
    doc.text('Either party may terminate this Agreement at any time with written notice.');
    doc.moveDown(1);

    // Section 9: GOVERNING LAW
    doc.fontSize(14).text('9. GOVERNING LAW', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).text('This Agreement shall be governed by and construed in accordance with the laws of the State of Florida, without regard to its conflict-of-law provisions.');
    doc.moveDown(1);

    // Section 10: ENTIRE AGREEMENT
    doc.fontSize(14).text('10. ENTIRE AGREEMENT', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).text('This document constitutes the entire understanding between the parties and supersedes all prior or contemporaneous communications, whether oral or written, related to the subject matter herein.');
    doc.text('No amendment or modification shall be valid unless in writing and signed by both parties.');
    doc.moveDown(1);

    // Section 11: ACCEPTANCE & SIGNATURE
    doc.fontSize(14).text('11. ACCEPTANCE & SIGNATURE', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).text('By signing below, the Producer acknowledges and agrees to comply with all terms, conditions, and expectations outlined in this Agreement, including remote work policies, compensation terms, and carrier authorization provisions.');
    doc.moveDown(1);

    // Signature Section
    doc.fontSize(12).text('Company');
    doc.moveDown(0.3);
    doc.text('Life Assurance Solutions, LLC');
    doc.text('JJN Protection Insurance Agency, LLC');
    doc.moveDown(0.5);
    doc.text('Signature: ___________________________________________');
    doc.text('Printed Name: James Kelly');
    doc.text('Title: Managing Partner');
    doc.text('Date: ___________________________');
    doc.moveDown(1);

    doc.fontSize(12).text('Producer');
    doc.moveDown(0.3);
    doc.text('Signature: ___________________________________________');
    doc.text('Printed Name: ' + (fullName || '________________________________________'));
    doc.text('NPN: _________________________________________________');
    doc.text('Date: ___________________________');
    doc.moveDown(1);

    // Add signature image if available
    try {
      const sigPath = agent.signatures?.producerAgreement?.path;
      if (sigPath && fse.existsSync(sigPath)) {
        doc.moveDown();
        doc.fontSize(12).text('Digital Signature:');
        doc.image(sigPath, { fit: [300, 120] });
      }
    } catch (e) {
      console.warn('Could not add signature image:', e);
    }

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

    // Add Remote Producer Agreement if agent has signed it
    if (agent.signatures?.producerAgreement) {
      doc.addPage();
      doc.fontSize(16).text('REMOTE PRODUCER AGREEMENT (ACA DIVISION)', { align: 'center' });
      doc.moveDown(1);
      doc.fontSize(11).text('This Remote Producer Agreement ("Agreement") is made and entered into as of the date written below by and between Life Assurance Solutions, LLC and JJN Protection Insurance Agency, LLC (collectively referred to herein as the "Company"), and the undersigned licensed insurance producer ("Producer").');
      doc.moveDown(1);

      // Producer Information
      const fullName = `${agent.profile?.firstName || ''} ${agent.profile?.lastName || ''}`.trim();
      doc.fontSize(12).text('Producer Name: ' + (fullName || '___________________________________________'));
      doc.text('NPN (National Producer Number): ____________________________________________');
      doc.moveDown(1);

      // Key Terms Summary
      doc.fontSize(14).text('KEY TERMS SUMMARY', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).text('• Position: ACA Health Insurance Producer (Remote)');
      doc.text('• Compensation: $12/hour + $15 per sale (6th+ sale daily) + $2/month residual (Feb 2026)');
      doc.text('• Work Schedule: Monday-Friday, 10:00 AM – 6:00 PM EST');
      doc.text('• Sales Goal: Minimum 5 sales per day required');
      doc.text('• Carrier Authorization: Company authorized to sign ACA carrier appointments');
      doc.text('• NPN Override: Company authorized to use Producer NPN for overrides');
      doc.text('• Book of Business: All leads/clients belong to Company');
      doc.text('• Confidentiality: 12-month non-solicitation clause');
      doc.text('• Independent Contractor: Not an employee relationship');
      doc.text('• Governing Law: State of Florida');
      doc.moveDown(1);

      // Signature Information
      doc.fontSize(12).text('Company Signatures:');
      doc.text('Life Assurance Solutions, LLC');
      doc.text('JJN Protection Insurance Agency, LLC');
      doc.text('Signature: James Kelly, Managing Partner');
      doc.moveDown(0.5);
      
      doc.fontSize(12).text('Producer Signature:');
      doc.text(`Name: ${fullName || '________________________________________'}`);
      doc.text('NPN: _________________________________________________');
      doc.text(`Signed: ${agent.signatures.producerAgreement.signedAt ? new Date(agent.signatures.producerAgreement.signedAt).toLocaleDateString() : '___________________________'}`);
      
      // Add signature image if available
      try {
        const sigPath = agent.signatures?.producerAgreement?.path;
        if (sigPath && fse.existsSync(sigPath)) {
          doc.moveDown();
          doc.fontSize(12).text('Digital Signature:');
          doc.image(sigPath, { fit: [300, 120] });
        }
      } catch (e) {
        console.warn('Could not add signature image to intake PDF:', e);
      }
    }

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
