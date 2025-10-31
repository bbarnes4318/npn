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
      // 78 columns total - Intake fills columns 1-43, leaves 44-78 empty for W9 and Banking
      const row = [
        new Date().toISOString(), // 1. Timestamp
        data.agentId || '', // 2. Agent ID
        'Intake', // 3. Form Type
        // Contact Information (4-7)
        data.contact?.firstName || '', // 4. First Name
        data.contact?.lastName || '', // 5. Last Name
        data.contact?.email || '', // 6. Email
        data.contact?.phone || '', // 7. Phone
        // Business Details (8-14)
        data.business?.address1 || '', // 8. Address Line 1
        data.business?.address2 || '', // 9. Address Line 2
        data.business?.city || '', // 10. City
        data.business?.state || '', // 11. State
        data.business?.zip || '', // 12. ZIP Code
        data.business?.agencyName || '', // 13. Agency Name
        data.business?.website || '', // 14. Website
        // NPN and Licensing (15-16)
        data.npn || '', // 15. NPN
        Array.isArray(data.statesLicensed) ? data.statesLicensed.join(', ') : (data.statesLicensed || ''), // 16. States Licensed
        // Background Questions (17-36)
        data.background?.crimeConvicted || 'no', // 17. Crime Convicted
        data.background?.crimeConvictedExplain || '', // 18. Crime Convicted Explain
        data.background?.crimeCharged || 'no', // 19. Crime Charged
        data.background?.crimeChargedExplain || '', // 20. Crime Charged Explain
        data.background?.lawsuitParty || 'no', // 21. Lawsuit Party
        data.background?.lawsuitPartyExplain || '', // 22. Lawsuit Party Explain
        data.background?.judgmentLien || 'no', // 23. Judgment Lien
        data.background?.judgmentLienExplain || '', // 24. Judgment Lien Explain
        data.background?.debtLawsuit || 'no', // 25. Debt Lawsuit
        data.background?.debtLawsuitExplain || '', // 26. Debt Lawsuit Explain
        data.background?.delinquentTax || 'no', // 27. Delinquent Tax
        data.background?.delinquentTaxExplain || '', // 28. Delinquent Tax Explain
        data.background?.terminatedForCause || 'no', // 29. Terminated For Cause
        data.background?.terminatedForCauseExplain || '', // 30. Terminated For Cause Explain
        data.background?.licenseRevoked || 'no', // 31. License Revoked
        data.background?.licenseRevokedExplain || '', // 32. License Revoked Explain
        data.background?.indebted || 'no', // 33. Indebted
        data.background?.indebtedExplain || '', // 34. Indebted Explain
        data.background?.childSupport || 'no', // 35. Child Support
        data.background?.childSupportExplain || '', // 36. Child Support Explain
        // Attachments (37-39)
        data.attachments?.certProof?.originalname || '', // 37. CMS/FFM Cert Proof
        data.attachments?.licenseFront?.originalname || '', // 38. License Front
        data.attachments?.licenseBack?.originalname || '', // 39. License Back
        // Acknowledgments (40-43)
        data.acknowledgments?.producerAgreementAccepted ? 'Yes' : 'No', // 40. Producer Agreement Accepted
        data.acknowledgments?.privacyNoticeAccepted ? 'Yes' : 'No', // 41. Privacy Notice Accepted
        data.acknowledgments?.signature || '', // 42. Signature
        data.acknowledgments?.signatureDate || '', // 43. Signature Date
        // W9 Fields (44-58) - Empty for Intake
        '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', // W9 Name through W9 Signature Date
        // Banking Fields (59-78) - Empty for Intake
        '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '' // Banking First Name through Banking Signature Date
      ];

      console.log('   Row length:', row.length);
      console.log('   First few values:', row.slice(0, 5));
      
      const result = await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `'${this.sheetName}'!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [row]
        }
      });
      
      console.log('   Append result:', result.data);

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
      // 78 columns total - W9 fills columns 1-3 and 44-58, leaves 4-43 and 59-78 empty
      const row = [
        new Date().toISOString(), // 1. Timestamp
        data.agentId || '', // 2. Agent ID
        'W-9', // 3. Form Type
        // Intake Fields (4-43) - Empty for W9
        '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', // First Name through Signature Date (40 empty)
        // W9 Fields (44-58)
        data.name || '', // 44. W9 Name
        data.businessName || '', // 45. W9 Business Name
        data.taxClassification || '', // 46. W9 Tax Classification
        data.llcClassification || '', // 47. W9 LLC Classification
        data.address?.address1 || '', // 48. W9 Address Line 1
        data.address?.address2 || '', // 49. W9 Address Line 2
        data.address?.city || '', // 50. W9 City
        data.address?.state || '', // 51. W9 State
        data.address?.zip || '', // 52. W9 ZIP
        data.tin?.ssn || '', // 53. W9 SSN
        data.tin?.ein || '', // 54. W9 EIN
        data.exemptPayeeCode || '', // 55. W9 Exempt Payee Code
        data.fatcaCode || '', // 56. W9 FATCA Code
        data.certification?.signature || '', // 57. W9 Signature
        data.certification?.signatureDate || '', // 58. W9 Signature Date
        // Banking Fields (59-78) - Empty for W9
        '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '' // Banking First Name through Banking Signature Date
      ];

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `'${this.sheetName}'!A1`,
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
      // 78 columns total - Banking fills columns 1-3 and 59-78, leaves 4-58 empty
      const row = [
        new Date().toISOString(), // 1. Timestamp
        data.agentId || '', // 2. Agent ID
        'Banking', // 3. Form Type
        // Intake Fields (4-43) - Empty for Banking
        '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', // All intake fields empty (40 empty)
        // W9 Fields (44-58) - Empty for Banking
        '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', // All W9 fields empty (15 empty)
        // Banking Fields (59-78)
        data.employeeInfo?.firstName || '', // 59. Banking First Name
        data.employeeInfo?.lastName || '', // 60. Banking Last Name
        data.employeeInfo?.streetAddress || '', // 61. Banking Street Address
        data.employeeInfo?.city || '', // 62. Banking City
        data.employeeInfo?.state || '', // 63. Banking State
        data.employeeInfo?.zipCode || '', // 64. Banking ZIP
        data.employeeInfo?.ssn || '', // 65. Banking SSN
        data.employeeInfo?.dateOfBirth || '', // 66. Banking Date of Birth
        data.employeeInfo?.dateOfHire || '', // 67. Banking Date of Hire
        data.bankName || '', // 68. Bank Name
        data.routingNumber || '', // 69. Routing Number
        data.accountNumber || '', // 70. Account Number
        data.accountType || '', // 71. Account Type
        data.accountHolderName || '', // 72. Account Holder Name
        data.paymentMethod || '', // 73. Payment Method
        data.authorizations?.authorizeDirectDeposit ? 'Yes' : 'No', // 74. Authorize Direct Deposit
        data.authorizations?.verifyBankingInfo ? 'Yes' : 'No', // 75. Verify Banking Info
        data.authorizations?.privacyConsent ? 'Yes' : 'No', // 76. Privacy Consent
        data.signature?.digitalSignature || '', // 77. Banking Signature
        data.signature?.signatureDate || '' // 78. Banking Signature Date
      ];

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A1`,
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
        range: `'${this.sheetName}'!A1`,
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

