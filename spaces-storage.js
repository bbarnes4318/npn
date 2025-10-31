const AWS = require('aws-sdk');
const path = require('path');

// DigitalOcean Spaces configuration
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
    this.bucketName = BUCKET_NAME;
    // Check bucket asynchronously without blocking server startup
    this.ensureBucketExists().catch(err => {
      // Silently handle credential errors during development
      if (err.code === 'CredentialsError') {
        console.log('⚠️  Spaces credentials not configured - bucket check skipped');
      } else {
        console.error('Error checking bucket:', err.message || err);
      }
    });
  }

  async ensureBucketExists() {
    // Skip check if credentials are not configured
    if (!process.env.SPACES_ACCESS_KEY_ID || !process.env.SPACES_SECRET_ACCESS_KEY) {
      console.log('⚠️  Spaces credentials not set - skipping bucket check');
      return;
    }
    
    try {
      await s3.headBucket({ Bucket: this.bucketName }).promise();
      console.log(`✅ Spaces bucket ${this.bucketName} exists`);
    } catch (error) {
      if (error.statusCode === 404) {
        console.log(`Creating Spaces bucket ${this.bucketName}...`);
        await s3.createBucket({ Bucket: this.bucketName }).promise();
        console.log(`✅ Created Spaces bucket ${this.bucketName}`);
      } else if (error.code === 'CredentialsError') {
        // Don't throw - just log
        throw error;
      } else {
        console.error('Error checking bucket:', error.message || error);
      }
    }
  }

  // Upload file to Spaces
  async uploadFile(filePath, key, contentType = 'application/octet-stream') {
    try {
      const fs = require('fs');
      const fileContent = fs.readFileSync(filePath);
      
      const params = {
        Bucket: this.bucketName,
        Key: key,
        Body: fileContent,
        ContentType: contentType,
        ACL: 'private'
      };

      const result = await s3.upload(params).promise();
      console.log(`✅ Uploaded ${key} to Spaces: ${result.Location}`);
      return result.Location;
    } catch (error) {
      console.error(`Error uploading ${key}:`, error);
      throw error;
    }
  }

  // Upload buffer to Spaces
  async uploadBuffer(buffer, key, contentType = 'application/octet-stream') {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: 'private'
      };

      const result = await s3.upload(params).promise();
      console.log(`✅ Uploaded buffer as ${key} to Spaces: ${result.Location}`);
      return result.Location;
    } catch (error) {
      console.error(`Error uploading buffer as ${key}:`, error);
      throw error;
    }
  }

  // Download file from Spaces
  async downloadFile(key, localPath) {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: key
      };

      const result = await s3.getObject(params).promise();
      const fs = require('fs');
      fs.writeFileSync(localPath, result.Body);
      console.log(`✅ Downloaded ${key} from Spaces to ${localPath}`);
      return localPath;
    } catch (error) {
      console.error(`Error downloading ${key}:`, error);
      throw error;
    }
  }

  // Get file as buffer from Spaces
  async getFileBuffer(key) {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: key
      };

      const result = await s3.getObject(params).promise();
      return result.Body;
    } catch (error) {
      console.error(`Error getting buffer for ${key}:`, error);
      throw error;
    }
  }

  // Check if file exists in Spaces
  async fileExists(key) {
    try {
      await s3.headObject({ Bucket: this.bucketName, Key: key }).promise();
      return true;
    } catch (error) {
      if (error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  // List files in Spaces
  async listFiles(prefix = '') {
    try {
      const params = {
        Bucket: this.bucketName,
        Prefix: prefix
      };

      const result = await s3.listObjectsV2(params).promise();
      return result.Contents || [];
    } catch (error) {
      console.error(`Error listing files with prefix ${prefix}:`, error);
      throw error;
    }
  }

  // Delete file from Spaces
  async deleteFile(key) {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: key
      };

      await s3.deleteObject(params).promise();
      console.log(`✅ Deleted ${key} from Spaces`);
    } catch (error) {
      console.error(`Error deleting ${key}:`, error);
      throw error;
    }
  }

  // Generate signed URL for private file access
  async getSignedUrl(key, expiresIn = 3600) {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: key,
        Expires: expiresIn
      };

      const url = s3.getSignedUrl('getObject', params);
      return url;
    } catch (error) {
      console.error(`Error generating signed URL for ${key}:`, error);
      throw error;
    }
  }

  // Generate key for agent documents
  generateAgentKey(agentId, fileName) {
    return `agents/${agentId}/${fileName}`;
  }

  // Generate key for submissions
  generateSubmissionKey(submissionId, fileName) {
    return `submissions/${submissionId}/${fileName}`;
  }

  // Generate key for uploads
  generateUploadKey(fileName) {
    return `uploads/${fileName}`;
  }
}

module.exports = SpacesStorage;
