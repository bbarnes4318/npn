// google-sheets.js
// Fully expanded Google Sheets helper with:
// - Tab resolution/creation
// - Safe append ranges
// - Exact 78-column mapping in the specified order
// - Trailing-empty trimming so only populated cells are written

const { google } = require('googleapis');

class GoogleSheets {
  constructor() {
    this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
    this.sheetName = (process.env.GOOGLE_SHEET_NAME || 'Agent Onboarding').trim();
    this.auth = null;
    this.sheets = null;

    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      try {
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
        this.auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
      } catch (err) {
        console.error('❌ Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY JSON:', err.message);
      }
    }

    this._resolvedSheetTitle = null;
    this._resolvedSheetId = null;
  }

  async initialize() {
    if (!this.auth) {
      console.log('⚠️  Google Sheets credentials not configured - skipping initialization');
      return false;
    }
    if (!this.spreadsheetId) {
      console.log('⚠️  GOOGLE_SHEET_ID not set - skipping initialization');
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

  // Resolve or create the sheet tab, cache exact title + id
  async _resolveSheet() {
    if (this._resolvedSheetTitle && this._resolvedSheetId != null) {
      return { title: this._resolvedSheetTitle, id: this._resolvedSheetId };
    }

    const wanted = this.sheetName.trim();

    const meta = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: 'sheets.properties',
    });

    const sheets = (meta.data.sheets || []).map(s => s.properties);
    let found = sheets.find(p => (p.title || '').trim() === wanted);
    if (!found) {
      const lower = wanted.toLowerCase();
      found = sheets.find(p => (p.title || '').trim().toLowerCase() === lower);
    }

    if (!found) {
      const add = await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: wanted } } }] },
      });
      const props = add.data.replies?.[0]?.addSheet?.properties;
      if (!props) throw new Error('Failed to create sheet tab');
      this._resolvedSheetTitle = props.title;
      this._resolvedSheetId = props.sheetId;
      console.log(`🆕 Created sheet tab: ${props.title} (${props.sheetId})`);
      return { title: this._resolvedSheetTitle, id: this._resolvedSheetId };
    }

    this._resolvedSheetTitle = found.title;
    this._resolvedSheetId = found.sheetId;
    if (this._resolvedSheetTitle !== wanted) {
      console.log(`ℹ️ Using resolved sheet title: "${this._resolvedSheetTitle}" (configured: "${wanted}")`);
    }
    return { title: this._resolvedSheetTitle, id: this._resolvedSheetId };
  }

  // Safe anchor for appending
  _appendAnchor(title) {
    return `${title}!A1`;
  }

  // Trim trailing empty/null/undefined values (so only cells with data are sent)
  _trimRight(values) {
    let i = values.length - 1;
    while (i >= 0) {
      const v = values[i];
      if (v === '' || v === null || v === undefined) {
        i -= 1;
      } else {
        break;
      }
    }
    return values.slice(0, i + 1);
  }

  // ===== HEADER ORDER (exact) =====
  //  1  Timestamp
  //  2  Agent ID
  //  3  Form Type
  //  4  First Name
  //  5  Last Name
  //  6  Email
  //  7  Phone
  //  8  Address Line 1
  //  9  Address Line 2
  // 10  City
  // 11  State
  // 12  ZIP Code
  // 13  Agency Name
  // 14  Website
  // 15  NPN
  // 16  States Licensed
  // 17  Crime Convicted
  // 18  Crime Convicted Explain
  // 19  Crime Charged
  // 20  Crime Charged Explain
  // 21  Lawsuit Party
  // 22  Lawsuit Party Explain
  // 23  Judgment Lien
  // 24  Judgment Lien Explain
  // 25  Debt Lawsuit
  // 26  Debt Lawsuit Explain
  // 27  Delinquent Tax
  // 28  Delinquent Tax Explain
  // 29  Terminated For Cause
  // 30  Terminated For Cause Explain
  // 31  License Revoked
  // 32  License Revoked Explain
  // 33  Indebted
  // 34  Indebted Explain
  // 35  Child Support
  // 36  Child Support Explain
  // 37  CMS/FFM Cert Proof
  // 38  License Front
  // 39  License Back
  // 40  Producer Agreement Accepted
  // 41  Privacy Notice Accepted
  // 42  Signature
  // 43  Signature Date
  // 44  W9 Name
  // 45  W9 Business Name
  // 46  W9 Tax Classification
  // 47  W9 LLC Classification
  // 48  W9 Address Line 1
  // 49  W9 Address Line 2
  // 50  W9 City
  // 51  W9 State
  // 52  W9 ZIP
  // 53  W9 SSN
  // 54  W9 EIN
  // 55  W9 Exempt Payee Code
  // 56  W9 FATCA Code
  // 57  W9 Signature
  // 58  W9 Signature Date
  // 59  Banking First Name
  // 60  Banking Last Name
  // 61  Banking Street Address
  // 62  Banking City
  // 63  Banking State
  // 64  Banking ZIP
  // 65  Banking SSN
  // 66  Banking Date of Birth
  // 67  Banking Date of Hire
  // 68  Bank Name
  // 69  Routing Number
  // 70  Account Number
  // 71  Account Type
  // 72  Account Holder Name
  // 73  Payment Method
  // 74  Authorize Direct Deposit
  // 75  Verify Banking Info
  // 76  Privacy Consent
  // 77  Banking Signature
  // 78  Banking Signature Date

  // ---------- Row builders (FULLY MAPPED, then trimmed) ----------

  _buildRowForIntake(payload) {
    const p = payload || {};
    const row = [
      new Date().toISOString(),                           // 1 Timestamp
      p.agentId || '',                                     // 2 Agent ID
      'Intake',                                            // 3 Form Type
      p.contact?.firstName || '',                          // 4 First Name
      p.contact?.lastName || '',                           // 5 Last Name
      p.contact?.email || '',                              // 6 Email
      p.contact?.phone || '',                              // 7 Phone
      p.business?.address1 || '',                          // 8 Address Line 1
      p.business?.address2 || '',                          // 9 Address Line 2
      p.business?.city || '',                              // 10 City
      p.business?.state || '',                             // 11 State
      p.business?.zip || '',                               // 12 ZIP Code
      p.business?.agencyName || '',                        // 13 Agency Name
      p.business?.website || '',                           // 14 Website
      p.npn || '',                                         // 15 NPN
      Array.isArray(p.statesLicensed)
        ? p.statesLicensed.join(', ')
        : (p.statesLicensed || ''),                        // 16 States Licensed
      (p.background?.crimeConvicted ?? '').toString(),     // 17 Crime Convicted
      p.background?.crimeConvictedExplain || '',           // 18 Crime Convicted Explain
      (p.background?.crimeCharged ?? '').toString(),       // 19 Crime Charged
      p.background?.crimeChargedExplain || '',             // 20 Crime Charged Explain
      (p.background?.lawsuitParty ?? '').toString(),       // 21 Lawsuit Party
      p.background?.lawsuitPartyExplain || '',             // 22 Lawsuit Party Explain
      (p.background?.judgmentLien ?? '').toString(),       // 23 Judgment Lien
      p.background?.judgmentLienExplain || '',             // 24 Judgment Lien Explain
      (p.background?.debtLawsuit ?? '').toString(),        // 25 Debt Lawsuit
      p.background?.debtLawsuitExplain || '',              // 26 Debt Lawsuit Explain
      (p.background?.delinquentTax ?? '').toString(),      // 27 Delinquent Tax
      p.background?.delinquentTaxExplain || '',            // 28 Delinquent Tax Explain
      (p.background?.terminatedForCause ?? '').toString(), // 29 Terminated For Cause
      p.background?.terminatedForCauseExplain || '',       // 30 Terminated For Cause Explain
      (p.background?.licenseRevoked ?? '').toString(),     // 31 License Revoked
      p.background?.licenseRevokedExplain || '',           // 32 License Revoked Explain
      (p.background?.indebted ?? '').toString(),           // 33 Indebted
      p.background?.indebtedExplain || '',                 // 34 Indebted Explain
      (p.background?.childSupport ?? '').toString(),       // 35 Child Support
      p.background?.childSupportExplain || '',             // 36 Child Support Explain
      // Files (store names or URLs depending on your flow)
      p.attachments?.certProof?.originalname || p.attachments?.certProof?.url || '', // 37 CMS/FFM Cert Proof
      p.attachments?.licenseFront?.originalname || p.attachments?.licenseFront?.url || '', // 38 License Front
      p.attachments?.licenseBack?.originalname || p.attachments?.licenseBack?.url || '', // 39 License Back
      p.acknowledgments?.producerAgreementAccepted ? 'Yes' : (p.acknowledgments?.producerAgreementAccepted === false ? 'No' : ''), // 40
      p.acknowledgments?.privacyNoticeAccepted ? 'Yes' : (p.acknowledgments?.privacyNoticeAccepted === false ? 'No' : ''),         // 41
      p.acknowledgments?.signature || '',                 // 42 Signature
      p.acknowledgments?.signatureDate || '',             // 43 Signature Date
      // 44-58 (W9) — leave blank for intake unless you collect them here:
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', // 44..58
      // 59-78 (Banking) — leave blank for intake unless collected here:
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', // 59..78
    ];
    return this._trimRight(row);
  }

  _buildRowForW9(payload) {
    const p = payload || {};
    const row = [
      new Date().toISOString(),                           // 1 Timestamp
      p.agentId || '',                                     // 2 Agent ID
      'W-9',                                               // 3 Form Type
      // Intake 4..43 unused
      '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '', // (4..36 blank)
      '', '', '', '',                 // 37..40 blank
      '', '',                         // 41..42 blank
      '',                             // 43 blank
      // W9 (44..58)
      p.name || '',                                      // 44 W9 Name
      p.businessName || '',                               // 45 W9 Business Name
      p.taxClassification || '',                          // 46 W9 Tax Classification
      p.llcClassification || '',                          // 47 W9 LLC Classification
      p.address?.address1 || '',                          // 48 W9 Address Line 1
      p.address?.address2 || '',                          // 49 W9 Address Line 2
      p.address?.city || '',                              // 50 W9 City
      p.address?.state || '',                             // 51 W9 State
      p.address?.zip || '',                               // 52 W9 ZIP
      p.tin?.ssn || '',                                   // 53 W9 SSN
      p.tin?.ein || '',                                   // 54 W9 EIN
      p.exemptPayeeCode || '',                            // 55 W9 Exempt Payee Code
      p.fatcaCode || '',                                  // 56 W9 FATCA Code
      p.certification?.signature || '',                   // 57 W9 Signature
      p.certification?.signatureDate || '',               // 58 W9 Signature Date
      // Banking (59..78) not part of W-9
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', // 59..78
    ];
    return this._trimRight(row);
  }

  _buildRowForBanking(payload) {
    const p = payload || {};
    const row = [
      new Date().toISOString(),                           // 1 Timestamp
      p.agentId || '',                                     // 2 Agent ID
      'Banking',                                           // 3 Form Type
      // Intake 4..43 unused here
      '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '', // (4..36 blank)
      '', '', '', '',                 // 37..40 blank
      '', '',                         // 41..42 blank
      '',                             // 43 blank
      // W9 (44..58) unused here
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', // 44..58 blank
      // Banking (59..78)
      p.employeeInfo?.firstName || '',                     // 59 Banking First Name
      p.employeeInfo?.lastName || '',                      // 60 Banking Last Name
      p.employeeInfo?.streetAddress || '',                 // 61 Banking Street Address
      p.employeeInfo?.city || '',                          // 62 Banking City
      p.employeeInfo?.state || '',                         // 63 Banking State
      p.employeeInfo?.zipCode || '',                       // 64 Banking ZIP
      p.employeeInfo?.ssn || '',                           // 65 Banking SSN
      p.employeeInfo?.dateOfBirth || '',                   // 66 Banking Date of Birth
      p.employeeInfo?.dateOfHire || '',                    // 67 Banking Date of Hire
      p.bankName || '',                                    // 68 Bank Name
      p.routingNumber || '',                               // 69 Routing Number
      p.accountNumber || '',                               // 70 Account Number
      p.accountType || '',                                 // 71 Account Type
      p.accountHolderName || '',                           // 72 Account Holder Name
      p.paymentMethod || '',                               // 73 Payment Method
      p.authorizations?.authorizeDirectDeposit ? 'Yes' : (p.authorizations?.authorizeDirectDeposit === false ? 'No' : ''), // 74
      p.authorizations?.verifyBankingInfo ? 'Yes' : (p.authorizations?.verifyBankingInfo === false ? 'No' : ''),           // 75
      p.authorizations?.privacyConsent ? 'Yes' : (p.authorizations?.privacyConsent === false ? 'No' : ''),                 // 76
      p.signature?.digitalSignature || '',                 // 77 Banking Signature
      p.signature?.signatureDate || '',                    // 78 Banking Signature Date
    ];
    return this._trimRight(row);
  }

  async _append(values) {
    if (!this.sheets || !this.spreadsheetId) {
      throw new Error('Google Sheets not initialized');
    }
    const { title } = await this._resolveSheet();
    const range = this._appendAnchor(title);
    const trimmed = this._trimRight(values);

    const res = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [trimmed] },
    });
    return res?.data;
  }

  async appendIntakeData(data) {
    try {
      const row = this._buildRowForIntake(data);
      return !!(await this._append(row));
    } catch (err) {
      console.error('❌ Failed to append Intake data:', err.message, err.response?.data || '');
      return false;
    }
  }

  async appendW9Data(data) {
    try {
      const row = this._buildRowForW9(data);
      return !!(await this._append(row));
    } catch (err) {
      console.error('❌ Failed to append W-9 data:', err.message, err.response?.data || '');
      return false;
    }
  }

  async appendBankingData(data) {
    try {
      const row = this._buildRowForBanking(data);
      return !!(await this._append(row));
    } catch (err) {
      console.error('❌ Failed to append Banking data:', err.message, err.response?.data || '');
      return false;
    }
  }

  // Optional helper to write headers one-time
  async createHeadersIfMissing() {
    if (!this.sheets || !this.spreadsheetId) return false;
    const headers = [
      'Timestamp','Agent ID','Form Type','First Name','Last Name','Email','Phone',
      'Address Line 1','Address Line 2','City','State','ZIP Code','Agency Name','Website',
      'NPN','States Licensed',
      'Crime Convicted','Crime Convicted Explain','Crime Charged','Crime Charged Explain',
      'Lawsuit Party','Lawsuit Party Explain','Judgment Lien','Judgment Lien Explain',
      'Debt Lawsuit','Debt Lawsuit Explain','Delinquent Tax','Delinquent Tax Explain',
      'Terminated For Cause','Terminated For Cause Explain','License Revoked','License Revoked Explain',
      'Indebted','Indebted Explain','Child Support','Child Support Explain',
      'CMS/FFM Cert Proof','License Front','License Back',
      'Producer Agreement Accepted','Privacy Notice Accepted','Signature','Signature Date',
      'W9 Name','W9 Business Name','W9 Tax Classification','W9 LLC Classification',
      'W9 Address Line 1','W9 Address Line 2','W9 City','W9 State','W9 ZIP',
      'W9 SSN','W9 EIN','W9 Exempt Payee Code','W9 FATCA Code','W9 Signature','W9 Signature Date',
      'Banking First Name','Banking Last Name','Banking Street Address','Banking City','Banking State','Banking ZIP',
      'Banking SSN','Banking Date of Birth','Banking Date of Hire','Bank Name','Routing Number','Account Number',
      'Account Type','Account Holder Name','Payment Method','Authorize Direct Deposit','Verify Banking Info',
      'Privacy Consent','Banking Signature','Banking Signature Date',
    ];
    const { title } = await this._resolveSheet();
    const range = `${title}!A1`;

    // Read the first row to see if headers already exist
    const existing = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${title}!1:1`,
      majorDimension: 'ROWS',
    });
    const firstRow = existing.data.values?.[0] || [];
    if (firstRow && firstRow.length > 0) {
      // headers already present—skip
      return false;
    }

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    });
    console.log('✅ Wrote headers to sheet');
    return true;
  }
}

module.exports = GoogleSheets;
