# Implementation Summary: Agent Onboarding Google Sheets Integration

## Overview

This implementation adds comprehensive Google Sheets integration to capture all agent onboarding form data, including driver's license uploads and proper field mapping.

## Changes Made

### 1. Driver's License Upload Fields

**File:** `public/portal.html`

- Added two required file upload fields for driver's license:
  - **Driver's License - Front** (required)
  - **Driver's License - Back** (required)
- Located in the intake form, between CMS/FFM certification and background questions

### 2. Server-Side File Handling

**File:** `server.js`

- Updated intake endpoint to handle multiple file uploads:
  - `certProof` - CMS/FFM certification proof
  - `licenseFront` - Front of driver's license
  - `licenseBack` - Back of driver's license
- Files are saved to the submissions directory with proper naming
- Files are linked to agent records for later retrieval

### 3. Background Questions Mapping

**File:** `server.js`

- Updated intake endpoint to capture all 10 background questions:
  1. Crime Convicted
  2. Crime Charged
  3. Lawsuit Party
  4. Judgment Lien
  5. Debt Lawsuit
  6. Delinquent Tax
  7. Terminated For Cause
  8. License Revoked
  9. Indebted
  10. Child Support
- Each question captures both the Yes/No answer and explanation text
- Updated PDF generation to include all background questions

### 4. Google Sheets Integration Module

**File:** `google-sheets.js` (NEW)

- Complete Google Sheets integration class
- Handles authentication via service account
- Three methods for appending data:
  - `appendIntakeData()` - Intake form data (42 columns)
  - `appendW9Data()` - W-9 form data (18 columns)
  - `appendBankingData()` - Banking form data (22 columns)
- `createHeaders()` method to set up sheet structure
- Graceful error handling - doesn't fail requests if Sheets write fails

### 5. Server Integration

**Files:** `server.js`, `package.json`

- Added `googleapis` dependency
- Initialized Google Sheets service on server startup
- Integrated Sheets writes into all three endpoints:
  - `/api/intake` - Writes intake data
  - `/api/w9` - Writes W-9 data
  - `/api/banking` - Writes banking data
- Non-blocking: Google Sheets errors don't prevent form submissions

### 6. Frontend JavaScript Updates

**File:** `public/portal.js`

- Added `setupBackgroundQuestionConditionals()` function
- Automatically shows/hides explanation textareas when "Yes" is selected
- Applies to all 10 background questions
- Properly handles form validation

## Field Mapping

### Intake Form Fields → Google Sheets Columns

| Form Field | Sheet Column | Notes |
|------------|--------------|-------|
| Timestamp | Timestamp | Auto-generated |
| Agent ID | Agent ID | From agent record |
| First Name | First Name | From contact info |
| Last Name | Last Name | From contact info |
| Email | Email | From contact info |
| Phone | Phone | From contact info |
| Address Line 1 | Address Line 1 | Business address |
| Address Line 2 | Address Line 2 | Business address |
| City | City | Business address |
| State | State | Business address |
| ZIP Code | ZIP Code | Business address |
| Agency Name | Agency Name | Business details |
| Website | Website | Business details |
| NPN | NPN | Licensing |
| States Licensed | States Licensed | Comma-separated |
| 10 Background Questions | 20 columns | Yes/No + Explain for each |
| Cert Proof File | CMS/FFM Cert Proof | Filename |
| License Front File | License Front | Filename |
| License Back File | License Back | Filename |
| Producer Agreement | Producer Agreement Accepted | Yes/No |
| Privacy Notice | Privacy Notice Accepted | Yes/No |
| Signature | Signature | Digital signature text |
| Signature Date | Signature Date | Date |

### W-9 Form Fields → Google Sheets Columns

| Form Field | Sheet Column |
|------------|--------------|
| Timestamp | Timestamp |
| Agent ID | Agent ID |
| Form Type | "W-9" |
| Name | W9 Name |
| Business Name | W9 Business Name |
| Tax Classification | W9 Tax Classification |
| LLC Classification | W9 LLC Classification |
| Address fields | W9 Address fields |
| SSN/EIN | W9 SSN / W9 EIN |
| Exempt Payee Code | W9 Exempt Payee Code |
| FATCA Code | W9 FATCA Code |
| Signature | W9 Signature |
| Signature Date | W9 Signature Date |

### Banking Form Fields → Google Sheets Columns

| Form Field | Sheet Column |
|------------|--------------|
| Timestamp | Timestamp |
| Agent ID | Agent ID |
| Form Type | "Banking" |
| Employee Info | Banking First Name, Last Name, etc. |
| Bank Details | Bank Name, Routing, Account, etc. |
| Authorizations | Yes/No checkboxes |
| Signature | Banking Signature |

## Environment Variables Required

```bash
GOOGLE_SHEET_ID=your_sheet_id_from_url
GOOGLE_SHEET_NAME=Agent Onboarding  # Optional, defaults to "Agent Onboarding"
GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'  # Full JSON as string
```

## Setup Instructions

See `GOOGLE_SHEETS_SETUP.md` for detailed setup instructions including:
- Google Cloud Project setup
- Service account creation
- Sheet sharing configuration
- Environment variable configuration

## Testing

1. **Test Intake Form:**
   - Submit intake form with all fields filled
   - Upload all three files (cert, license front, license back)
   - Check Google Sheet for new row with all data

2. **Test W-9 Form:**
   - Complete W-9 form
   - Check Google Sheet for W-9 data row

3. **Test Banking Form:**
   - Complete banking form
   - Check Google Sheet for banking data row

4. **Verify Background Questions:**
   - Answer "Yes" to background questions
   - Verify explanation textareas appear
   - Submit form and verify data in sheet

## Notes

- Google Sheets writes are non-blocking - form submissions succeed even if Sheets write fails
- Files are stored locally on the server; only filenames are sent to Google Sheets
- All three form types (Intake, W-9, Banking) write to the same Google Sheet
- Each form submission creates a new row in the sheet
- The sheet should have proper column headers (see `GOOGLE_SHEETS_SETUP.md`)

## Troubleshooting

- Check server logs for Google Sheets errors
- Verify environment variables are set correctly
- Ensure service account has Editor access to the sheet
- Verify Google Sheets API is enabled in Google Cloud Console
- Check that Sheet ID matches the sheet URL

