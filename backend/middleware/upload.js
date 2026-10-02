// Re-export uploadR2 middleware for use across the application
const { uploadMemory, processAndUploadToR2 } = require('./uploadR2');

module.exports = uploadMemory;
module.exports.uploadMemory = uploadMemory;
module.exports.processAndUploadToR2 = processAndUploadToR2;
