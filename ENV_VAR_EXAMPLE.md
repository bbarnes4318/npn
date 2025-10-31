# Google Service Account Key - Environment Variable Format

## Option 1: Single-Line JSON String (Recommended)

Use the entire JSON object as a single-line string with escaped quotes:

### For Windows PowerShell:

```powershell
$env:GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"your-project-id","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"...","universe_domain":"googleapis.com"}'
```

### For Windows Command Prompt (cmd):

```cmd
set GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"your-project-id",...}
```

### For Linux/Mac (Bash):

```bash
export GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"your-project-id","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"...","universe_domain":"googleapis.com"}'
```

### For .env file (local development):

Create a `.env` file in your project root:

```env
GOOGLE_SHEET_ID=your_sheet_id_here
GOOGLE_SHEET_NAME=Agent Onboarding
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"your-project-id","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"...","universe_domain":"googleapis.com"}
```
```

## Option 2: Using Base64 Encoding (Alternative)

If you have issues with special characters, you can base64 encode the JSON:

1. Convert your JSON to base64
2. Store the base64 string
3. Decode it in your application (you'd need to update `google-sheets.js` to handle this)

## Important Notes:

✅ **YES, use the ENTIRE JSON object** - all fields are required:
- `type` - must be "service_account"
- `project_id` - your Google Cloud project ID
- `private_key_id` - unique identifier
- `private_key` - the actual private key (keep this secret!)
- `client_email` - service account email
- `client_id` - service account client ID
- `auth_uri`, `token_uri` - OAuth endpoints
- `auth_provider_x509_cert_url`, `client_x509_cert_url` - certificate URLs
- `universe_domain` - Google API domain

⚠️ **Security Tips:**
- Never commit the JSON file or .env file to version control
- Keep the private key secret
- Use environment variables in production (not .env files)
- Rotate keys periodically

## Quick Test

After setting the environment variable, restart your server and check the logs. You should see:
- `✅ Google Sheets initialized successfully` - if it works
- `⚠️  Google Sheets credentials not configured` - if there's an issue

If you see an error, double-check:
1. The JSON is valid (no extra commas, all quotes escaped)
2. The private_key has `\n` for newlines (not actual newlines)
3. All quotes inside the JSON string are escaped

