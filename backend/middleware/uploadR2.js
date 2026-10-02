const multer = require('multer');
const sharp = require('sharp');
const { uploadToR2 } = require('../utils/r2');

// Use memory storage for R2 uploads
const memoryStorage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'), false);
    }
};

const uploadMemory = multer({
    storage: memoryStorage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

/**
 * Middleware to process and upload image to R2
 * Converts image to WebP format for optimization
 */
const processAndUploadToR2 = (folder = 'uploads') => {
    return async (req, res, next) => {
        if (!req.file) {
            return next();
        }

        try {
            // Convert to WebP using sharp
            const webpBuffer = await sharp(req.file.buffer)
                .webp({ quality: 80 })
                .resize(800, 800, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .toBuffer();

            // Upload to R2
            const publicUrl = await uploadToR2(
                webpBuffer,
                req.file.originalname,
                'image/webp',
                folder
            );

            // Attach the URL to request for use in route
            req.fileUrl = publicUrl;
            next();
        } catch (error) {
            console.error('Image processing error:', error);
            next(error);
        }
    };
};

module.exports = { uploadMemory, processAndUploadToR2 };
