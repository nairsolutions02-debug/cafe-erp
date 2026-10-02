const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');

// Initialize S3 Client for Cloudflare R2
const r2Client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

/**
 * Upload a file to Cloudflare R2
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} fileName - Original filename
 * @param {string} contentType - MIME type
 * @param {string} folder - Optional folder path (e.g., 'menu', 'categories')
 * @returns {Promise<string>} - Public URL of uploaded file
 */
const uploadToR2 = async (fileBuffer, fileName, contentType, folder = 'uploads') => {
    try {
        // Generate unique filename with timestamp
        const ext = path.extname(fileName);
        const baseName = path.basename(fileName, ext);
        const uniqueName = `${folder}/${baseName}-${Date.now()}.webp`;

        const command = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: uniqueName,
            Body: fileBuffer,
            ContentType: 'image/webp',
        });

        await r2Client.send(command);

        // Return the public URL
        const publicUrl = `${process.env.R2_PUBLIC_URL}/${uniqueName}`;
        return publicUrl;
    } catch (error) {
        console.error('R2 Upload Error:', error);
        throw error;
    }
};

/**
 * Delete a file from Cloudflare R2
 * @param {string} fileUrl - The full public URL of the file
 */
const deleteFromR2 = async (fileUrl) => {
    try {
        if (!fileUrl || !fileUrl.includes(process.env.R2_PUBLIC_URL)) {
            return; // Not an R2 URL, skip
        }

        const key = fileUrl.replace(`${process.env.R2_PUBLIC_URL}/`, '');

        const command = new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
        });

        await r2Client.send(command);
        console.log('Deleted from R2:', key);
    } catch (error) {
        console.error('R2 Delete Error:', error);
        // Don't throw, just log
    }
};

module.exports = { uploadToR2, deleteFromR2, r2Client };
