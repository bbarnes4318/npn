const { google } = require('googleapis');

class GoogleSheets {
  constructor() {
    this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
    this.sheetName = process.env.GOOGLE_SHEET_NAME || 'Agent Onboarding';
    this.auth = null;
    this.sheets = null;
    
    // Initialize auth if credentials are provided
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      try {
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
        this.auth = new google.auth.GoogleAuth({
          credentials: credentials,
          scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
      } catch (err) {
        console.error('Failed to parse Google service account credentials:', err.message);
      }
    }
  }

  async initialize() {
    if (!this.auth) {
      console.log('⚠️  Google Sheets credentials not configured - skipping initialization');
      return false;
    }

    if (!this.spreadsheetId) {
      console.log('⚠️  Google Sheet ID not configured - skipping initialization');
      return false;
    }

    try {
      const authClient = await this.auth.getClient();
      this.sheets = google.sheets({ version: 'v4', auth: authClient });
      console.log('✅ Google Sheets initialized successfully');
      return true;
    } catch (err) {
      console.error('❌ Failed to initialize Google Sheets:', err.message);
      return false;
    }
  }

  /**
   * Appends a row to the Google Sheet with all agent onboarding data
   * Maps form fields to sheet columns exactly
   */
  async appendIntakeData(data) {
    if (!this.sheets || !this.spreadsheetId) {
      console.error('❌ Google Sheets not initialized, skipping data export');
      console.error('   sheets exists:', !!this.sheets);
      console.error('   spreadsheetId:', this.spreadsheetId || 'NOT SET');
      return false;
    }

    try {
      console.log('📝 Attempting to append intake data to Google Sheet:', this.spreadsheetId);
      console.log('   Sheet name:', this.sheetName);
      // Map all intake form fields to sheet columns
      // Column order matches the exact form field order
      const row = [
        new Date().toISOString(), // Timestamp
        data.agentId || '',
        // Contact Information
        data.contact?.firstName || '',
        data.contact?.lastName || '',
        data.contact?.email || '',
        data.contact?.phone || '',
        // Business Details
        data.business?.address1 || '',
        data.business?.address2 || '',
        data.business?.city || '',
        data.business?.state || '',
        data.business?.zip || '',
        data.business?.agencyName || '',
        data.business?.website || '',
        // NPN and Licensing
        data.npn || '',
        Array.isArray(data.statesLicensed) ? data.statesLicensed.join(', ') : (data.statesLicensed || ''),
        // Background Questions
        data.background?.crimeConvicted || 'no',
        data.background?.crimeConvictedExplain || '',
        data.background?.crimeCharged || 'no',
        data.background?.crimeChargedExplain || '',
        data.background?.lawsuitParty || 'no',
        data.background?.lawsuitPartyExplain || '',
        data.background?.judgmentLien || 'no',
        data.background?.judgmentLienExplain || '',
        data.background?.debtLawsuit || 'no',
        data.background?.debtLawsuitExplain || '',
        data.background?.delinquentTax || 'no',
        data.background?.delinquentTaxExplain || '',
        data.background?.terminatedForCause || 'no',
        data.background?.terminatedForCauseExplain || '',
        data.background?.licenseRevoked || 'no',
        data.background?.licenseRevokedExplain || '',
        data.background?.indebted || 'no',
        data.background?.indebtedExplain || '',
        data.background?.childSupport || 'no',
        data.background?.childSupportExplain || '',
        // Attachments
        data.attachments?.certProof?.originalname || '',
        data.attachments?.licenseFront?.originalname || '',
        data.attachments?.licenseBack?.originalname || '',
        // Acknowledgments
        data.acknowledgments?.producerAgreementAccepted ? 'Yes' : 'No',
        data.acknowledgments?.privacyNoticeAccepted ? 'Yes' : 'No',
        data.acknowledgments?.signature || '',
        data.acknowledgments?.signatureDate || ''
      ];

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:AP`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [row]
        }
      });

      console.log('✅ Intake data appended to Google Sheet successfully');
      return true;
    } catch (err) {
      console.error('❌ Failed to append intake data to Google Sheet:', err.message);
      console.error('   Error details:', err);
      if (err.response) {
        console.error('   Response status:', err.response.status);
        console.error('   Response data:', err.response.data);
      }
      return false;
    }
  }

  async appendW9Data(data) {
    if (!this.sheets || !this.spreadsheetId) {
      console.log('Google Sheets not initialized, skipping W-9 data export');
      return false;
    }

    try {
      // Map W-9 form fields to sheet columns
      const row = [
        new Date().toISOString(), // Timestamp
        data.agentId || '',
        'W-9', // Form Type
        // W-9 Information
        data.name || '',
        data.businessName || '',
        data.taxClassification || '',
        data.llcClassification || '',
        data.address?.address1 || '',
        data.address?.address2 || '',
        data.address?.city || '',
        data.address?.state || '',
        data.address?.zip || '',
        data.tin?.ssn || '',
        data.tin?.ein || '',
        data.exemptPayeeCode || '',
        data.fatcaCode || '',
        data.certification?.signature || '',
        data.certification?.signatureDate || ''
      ];

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:R`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [row]
        }
      });

      console.log('✅ W-9 data appended to Google Sheet');
      return true;
    } catch (err) {
      console.error('❌ Failed to append W-9 data to Google Sheet:', err.message);
      return false;
    }
  }

  async appendBankingData(data) {
    if (!this.sheets || !this.spreadsheetId) {
      console.log('Google Sheets not initialized, skipping banking data export');
      return false;
    }

    try {
      // Map banking form fields to sheet columns
      const row = [
        new Date().toISOString(), // Timestamp
        data.agentId || '',
        'Banking', // Form Type
        // Employee Information
        data.employeeInfo?.firstName || '',
        data.employeeInfo?.lastName || '',
        data.employeeInfo?.streetAddress || '',
        data.employeeInfo?.city || '',
        data.employeeInfo?.state || '',
        data.employeeInfo?.zipCode || '',
        data.employeeInfo?.ssn || '',
        data.employeeInfo?.dateOfBirth || '',
        data.employeeInfo?.dateOfHire || '',
        // Banking Information
        data.bankName || '',
        data.routingNumber || '',
        data.accountNumber || '',
        data.accountType || '',
        data.accountHolderName || '',
        data.paymentMethod || '',
        // Authorizations
        data.authorizations?.authorizeDirectDeposit ? 'Yes' : 'No',
        data.authorizations?.verifyBankingInfo ? 'Yes' : 'No',
        data.authorizations?.privacyConsent ? 'Yes' : 'No',
        // Signature
        data.signature?.digitalSignature || '',
        data.signature?.signatureDate || ''
      ];

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:V`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [row]
        }
      });

      console.log('✅ Banking data appended to Google Sheet');
      return true;
    } catch (err) {
      console.error('❌ Failed to append banking data to Google Sheet:', err.message);
      return false;
    }
  }

  /**
   * Creates the header row for the Google Sheet with all column names
   * Call this once to set up the sheet structure
   */
  async createHeaders() {
    if (!this.sheets || !this.spreadsheetId) {
      console.log('Google Sheets not initialized, skipping header creation');
      return false;
    }

    try {
      const headers = [
        'Timestamp',
        'Agent ID',
        'Form Type',
        // Contact Information
        'First Name',
        'Last Name',
        'Email',
        'Phone',
        // Business Details
        'Address Line 1',
        'Address Line 2',
        'City',
        'State',
        'ZIP Code',
        'Agency Name',
        'Website',
        // NPN and Licensing
        'NPN',
        'States Licensed',
        // Background Questions
        'Crime Convicted',
        'Crime Convicted Explain',
        'Crime Charged',
        'Crime Charged Explain',
        'Lawsuit Party',
        'Lawsuit Party Explain',
        'Judgment Lien',
        'Judgment Lien Explain',
        'Debt Lawsuit',
        'Debt Lawsuit Explain',
        'Delinquent Tax',
        'Delinquent Tax Explain',
        'Terminated For Cause',
        'Terminated For Cause Explain',
        'License Revoked',
        'License Revoked Explain',
        'Indebted',
        'Indebted Explain',
        'Child Support',
        'Child Support Explain',
        // Attachments
        'CMS/FFM Cert Proof',
        'License Front',
        'License Back',
        // Acknowledgments
        'Producer Agreement Accepted',
        'Privacy Notice Accepted',
        'Signature',
        'Signature Date',
        // W-9 Fields (if separate row)
        'W9 Name',
        'W9 Business Name',
        'W9 Tax Classification',
        'W9 LLC Classification',
        'W9 Address Line 1',
        'W9 Address Line 2',
        'W9 City',
        'W9 State',
        'W9 ZIP',
        'W9 SSN',
        'W9 EIN',
        'W9 Exempt Payee Code',
        'W9 FATCA Code',
        'W9 Signature',
        'W9 Signature Date',
        // Banking Fields (if separate row)
        'Banking First Name',
        'Banking Last Name',
        'Banking Street Address',
        'Banking City',
        'Banking State',
        'Banking ZIP',
        'Banking SSN',
        'Banking Date of Birth',
        'Banking Date of Hire',
        'Bank Name',
        'Routing Number',
        'Account Number',
        'Account Type',
        'Account Holder Name',
        'Payment Method',
        'Authorize Direct Deposit',
        'Verify Banking Info',
        'Privacy Consent',
        'Banking Signature',
        'Banking Signature Date'
      ];

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [headers]
        }
      });

      console.log('✅ Headers created in Google Sheet');
      return true;
    } catch (err) {
      console.error('❌ Failed to create headers in Google Sheet:', err.message);
      return false;
    }
  }
}

module.exports = GoogleSheets;

