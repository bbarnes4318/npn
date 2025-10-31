# Google Sheets Integration Setup Guide

This guide will help you set up Google Sheets integration to automatically capture all agent onboarding form data.

## Prerequisites

1. A Google account
2. A Google Sheet created in Google Drive
3. Google Cloud Project with Sheets API enabled

## Step 1: Create a Google Cloud Project and Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google Sheets API**:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click "Enable"

## Step 2: Create a Service Account

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "Service Account"
3. Fill in the service account details:
   - Name: `agent-onboarding-sheets` (or any name you prefer)
   - Description: `Service account for agent onboarding data collection`
4. Click "Create and Continue"
5. Skip role assignment (click "Continue" then "Done")

## Step 3: Create Service Account Key

1. Click on the newly created service account
2. Go to the "Keys" tab
3. Click "Add Key" > "Create new key"
4. Select "JSON" format
5. Click "Create" - this will download a JSON file
6. **Save this file securely** - you'll need it for the next step

## Step 4: Create and Configure Your Google Sheet

1. Create a new Google Sheet in Google Drive
2. Name it something like "Agent Onboarding Data"
3. **Copy the Sheet ID** from the URL:
   - The URL looks like: `https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`
   - The `SHEET_ID_HERE` is what you need
4. Share the sheet with the service account email:
   - Open the sheet
   - Click "Share" button
   - Add the service account email (found in the JSON key file, under `client_email`)
   - Give it "Editor" permission
   - Click "Send"

## Step 5: Set Environment Variables

Add the following environment variables to your server configuration:

### Option 1: Environment Variables (Recommended for Production)

```bash
# Google Sheet ID (from the URL)
GOOGLE_SHEET_ID=your_sheet_id_here

# Sheet name (defaults to "Agent Onboarding" if not set)
GOOGLE_SHEET_NAME=Agent Onboarding

# Service Account Key JSON (entire JSON content as a string)
GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"...","private_key_id":"...","private_key":"...","client_email":"...","client_id":"...","auth_uri":"...","token_uri":"...","auth_provider_x509_cert_url":"...","client_x509_cert_url":"..."}'
```

### Option 2: .env File (For Local Development)

Create a `.env` file in your project root:

```
GOOGLE_SHEET_ID=your_sheet_id_here
GOOGLE_SHEET_NAME=Agent Onboarding
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
```

**Note:** For production, use environment variables or a secure secret management system. Never commit the `.env` file with credentials to version control.

## Step 6: Column Headers

The Google Sheet will automatically use these column headers (you can create them manually or let the system append to the sheet):

### Intake Form Columns (Columns A-AR):

1. **Timestamp** - When the form was submitted
2. **Agent ID** - Unique identifier for the agent
3. **First Name** - Agent's first name
4. **Last Name** - Agent's last name
5. **Email** - Agent's email address
6. **Phone** - Agent's phone number
7. **Address Line 1** - Street address
8. **Address Line 2** - Apartment/suite number
9. **City** - City
10. **State** - State abbreviation
11. **ZIP Code** - ZIP code
12. **Agency Name** - Agency/company name
13. **Website** - Website URL
14. **NPN** - National Producer Number
15. **States Licensed** - Comma-separated list of licensed states
16. **Crime Convicted** - Yes/No
17. **Crime Convicted Explain** - Explanation if yes
18. **Crime Charged** - Yes/No
19. **Crime Charged Explain** - Explanation if yes
20. **Lawsuit Party** - Yes/No
21. **Lawsuit Party Explain** - Explanation if yes
22. **Judgment Lien** - Yes/No
23. **Judgment Lien Explain** - Explanation if yes
24. **Debt Lawsuit** - Yes/No
25. **Debt Lawsuit Explain** - Explanation if yes
26. **Delinquent Tax** - Yes/No
27. **Delinquent Tax Explain** - Explanation if yes
28. **Terminated For Cause** - Yes/No
29. **Terminated For Cause Explain** - Explanation if yes
30. **License Revoked** - Yes/No
31. **License Revoked Explain** - Explanation if yes
32. **Indebted** - Yes/No
33. **Indebted Explain** - Explanation if yes
34. **Child Support** - Yes/No
35. **Child Support Explain** - Explanation if yes
36. **CMS/FFM Cert Proof** - Filename of uploaded certificate
37. **License Front** - Filename of front of driver's license
38. **License Back** - Filename of back of driver's license
39. **Producer Agreement Accepted** - Yes/No
40. **Privacy Notice Accepted** - Yes/No
41. **Signature** - Digital signature text
42. **Signature Date** - Date of signature

### W-9 Form Columns:

When W-9 data is submitted, it will be appended as a separate row with:
- **Timestamp** - Submission time
- **Agent ID** - Agent identifier
- **Form Type** - "W-9"
- **W9 Name** - Name on tax return
- **W9 Business Name** - Business name if different
- **W9 Tax Classification** - Tax classification
- **W9 LLC Classification** - LLC classification (if applicable)
- **W9 Address Line 1** - Address
- **W9 Address Line 2** - Address line 2
- **W9 City** - City
- **W9 State** - State
- **W9 ZIP** - ZIP code
- **W9 SSN** - Social Security Number
- **W9 EIN** - Employer Identification Number
- **W9 Exempt Payee Code** - Exempt payee code
- **W9 FATCA Code** - FATCA reporting code
- **W9 Signature** - Digital signature
- **W9 Signature Date** - Signature date

### Banking Form Columns:

When banking data is submitted, it will be appended as a separate row with:
- **Timestamp** - Submission time
- **Agent ID** - Agent identifier
- **Form Type** - "Banking"
- **Banking First Name** - First name
- **Banking Last Name** - Last name
- **Banking Street Address** - Street address
- **Banking City** - City
- **Banking State** - State
- **Banking ZIP** - ZIP code
- **Banking SSN** - Social Security Number
- **Banking Date of Birth** - Date of birth
- **Banking Date of Hire** - Date of hire
- **Bank Name** - Bank name
- **Routing Number** - 9-digit routing number
- **Account Number** - Account number
- **Account Type** - Checking or Savings
- **Account Holder Name** - Name on account
- **Payment Method** - Direct deposit or check
- **Authorize Direct Deposit** - Yes/No
- **Verify Banking Info** - Yes/No
- **Privacy Consent** - Yes/No
- **Banking Signature** - Digital signature
- **Banking Signature Date** - Signature date

## Verification

After setup, test the integration by:

1. Submit a test intake form through the portal
2. Check your Google Sheet - a new row should appear
3. Check server logs for any Google Sheets errors

## Troubleshooting

### "Google Sheets not initialized"
- Check that `GOOGLE_SERVICE_ACCOUNT_KEY` is set correctly
- Verify the JSON is valid and properly escaped if using environment variables

### "Failed to append data to Google Sheet"
- Ensure the service account email has "Editor" access to the sheet
- Verify `GOOGLE_SHEET_ID` is correct
- Check that the Sheet API is enabled in Google Cloud Console

### Data not appearing
- Check server logs for specific error messages
- Verify the sheet name matches `GOOGLE_SHEET_NAME` (default: "Agent Onboarding")
- Ensure the sheet exists and is accessible

## Security Notes

- **Never commit service account keys to version control**
- Store credentials securely using environment variables or secret management systems
- Regularly rotate service account keys
- Use least-privilege access (only Editor permission on the specific sheet)
- Consider using Google Cloud Secret Manager for production deployments

## Support

If you encounter issues:
1. Check server logs for detailed error messages
2. Verify all environment variables are set correctly
3. Ensure the Google Sheets API is enabled
4. Confirm the service account has proper permissions

