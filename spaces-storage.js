const AWS = require('aws-sdk');
const path = require('path');
const fse = require('fs-extra');

// --- Cloud Storage (S3) / Local Filesystem Fallback ---

// DigitalOcean Spaces configuration (only used if credentials are provided)
const spacesEndpoint = new AWS.Endpoint(process.env.SPACES_ENDPOINT || 'atl1.digitaloceanspaces.com');
const s3 = new AWS.S3({
  endpoint: spacesEndpoint,
  accessKeyId: process.env.SPACES_ACCESS_KEY_ID,
  secretAccessKey: process.env.SPACES_SECRET_ACCESS_KEY,
  region: process.env.SPACES_REGION || 'atl1'
});
const BUCKET_NAME = process.env.SPACES_BUCKET_NAME || 'aca-npn';

class SpacesStorage {
  constructor() {
    // If SPACES_ACCESS_KEY_ID is not set, operate in local filesystem mode.
    this.isLocal = !process.env.SPACES_ACCESS_KEY_ID;

    if (this.isLocal) {
      console.log('SpacesStorage: SPACES_ACCESS_KEY_ID not found. Running in local filesystem mode.');
      const ROOT = path.resolve(__dirname);
      // Mirror the directory logic from server.js to ensure consistency
      this.AGENTS_DIR = this._chooseDir(process.env.AGENTS_DIR || path.join(ROOT, 'agents'), [path.join(ROOT, 'agents'), '/tmp/npn/agents']);
      this.SUBMISSIONS_DIR = this._chooseDir(process.env.SUBMISSIONS_DIR || path.join(ROOT, 'submissions'), [path.join(ROOT, 'submissions'), '/tmp/npn/submissions']);
      this.UPLOADS_DIR = this._chooseDir(process.env.UPLOADS_DIR || path.join(ROOT, 'uploads'), [path.join(ROOT, 'uploads'), '/tmp/npn/uploads']);
      console.log(`  - Local agents directory: ${this.AGENTS_DIR}`);
      console.log(`  - Local submissions directory: ${this.SUBMISSIONS_DIR}`);
    } else {
      this.bucketName = BUCKET_NAME;
      this.ensureBucketExists();
    }
  }

  // Helper to choose a writable directory, mirrored from server.js
  _chooseDir(preferred, fallbacks = []) {
    const candidates = [preferred, ...fallbacks].filter(Boolean);
    for (const p of candidates) {
      try {
        fse.ensureDirSync(p);
        return p;
      } catch (e) { /* try next candidate */ }
    }
    const tmp = path.join(require('os').tmpdir(), 'npn');
    fse.ensureDirSync(tmp);
    return tmp;
  }

  // Helper to resolve a storage key to a local filesystem path
  _getLocalPath(key) {
    const keyParts = (key || '').split('/');
    const rootDir = keyParts[0];
    const restOfPath = keyParts.slice(1);

    switch (rootDir) {
      case 'agents':
        return path.join(this.AGENTS_DIR, ...restOfPath);
      case 'submissions':
        return path.join(this.SUBMISSIONS_DIR, ...restOfPath);
      case 'uploads':
        return path.join(this.UPLOADS_DIR, ...restOfPath);
      default:
        // Use a generic base for unknown roots
        return path.join(__dirname, key);
    }
  }

  // Helper to recursively get all file paths in a directory
  async _getAllFilesRecursive(dir) {
    let results = [];
    try {
        const list = await fse.readdir(dir);
        for (const file of list) {
            const filePath = path.join(dir, file);
            const stat = await fse.stat(filePath);
            if (stat && stat.isDirectory()) {
                results = results.concat(await this._getAllFilesRecursive(filePath));
            } else {
                results.push(filePath);
            }
        }
    } catch (err) {
        if (err.code !== 'ENOENT') console.error(`Error reading directory recursively: ${dir}`, err);
    }
    return results;
  }

  async ensureBucketExists() {
    if (this.isLocal) return; // Not applicable for local mode
    try {
      await s3.headBucket({ Bucket: this.bucketName }).promise();
      console.log(`✅ Spaces bucket ${this.bucketName} exists`);
    } catch (error) {
      if (error.statusCode === 404) {
        console.log(`Creating Spaces bucket ${this.bucketName}...`);
        await s3.createBucket({ Bucket: this.bucketName }).promise();
        console.log(`✅ Created Spaces bucket ${this.bucketName}`);
      } else {
        console.error('Error checking bucket:', error);
      }
    }
  }

  async uploadBuffer(buffer, key, contentType = 'application/octet-stream') {
    if (this.isLocal) {
      const localPath = this._getLocalPath(key);
      await fse.ensureDir(path.dirname(localPath));
      await fse.writeFile(localPath, buffer);
      console.log(`✅ [Local] Saved buffer as ${key} to: ${localPath}`);
      return localPath;
    }

    try {
      const params = { Bucket: this.bucketName, Key: key, Body: buffer, ContentType: contentType, ACL: 'private' };
      const result = await s3.upload(params).promise();
      console.log(`✅ Uploaded buffer as ${key} to Spaces: ${result.Location}`);
      return result.Location;
    } catch (error) {
      console.error(`Error uploading buffer as ${key}:`, error);
      throw error;
    }
  }

  async getFileBuffer(key) {
    if (this.isLocal) {
      const localPath = this._getLocalPath(key);
      try {
        return await fse.readFile(localPath);
      } catch (error) {
        console.error(`Error getting local buffer for ${key}:`, error);
        throw error;
      }
    }

    try {
      const params = { Bucket: this.bucketName, Key: key };
      const result = await s3.getObject(params).promise();
      return result.Body;
    } catch (error) {
      console.error(`Error getting buffer for ${key}:`, error);
      throw error;
    }
  }

  async fileExists(key) {
    if (this.isLocal) {
      const localPath = this._getLocalPath(key);
      return await fse.pathExists(localPath);
    }

    try {
      await s3.headObject({ Bucket: this.bucketName, Key: key }).promise();
      return true;
    } catch (error) {
      if (error.code === 'NotFound' || error.statusCode === 404) return false;
      throw error;
    }
  }

  async listFiles(prefix = '') {
    if (this.isLocal) {
        const localDir = this._getLocalPath(prefix);
        if (!(await fse.pathExists(localDir))) return [];

        const allFiles = await this._getAllFilesRecursive(localDir);
        // Mimic the S3 response structure ({ Key, Size, LastModified })
        return allFiles.map(filePath => {
            const stats = fse.statSync(filePath);
            return {
                Key: path.relative(path.join(__dirname), filePath).replace(/\\/g, '/'),
                Size: stats.size,
                LastModified: stats.mtime
            };
        });
    }

    try {
      const params = { Bucket: this.bucketName, Prefix: prefix };
      const result = await s3.listObjectsV2(params).promise();
      return result.Contents || [];
    } catch (error) {
      console.error(`Error listing files with prefix ${prefix}:`, error);
      throw error;
    }
  }
}

module.exports = SpacesStorage;
