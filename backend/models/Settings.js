const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true
    },
    value: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    description: {
        type: String,
        default: ''
    }
}, { timestamps: true });

// Static method to get a setting
settingsSchema.statics.getSetting = async function (key, defaultValue = null) {
    const setting = await this.findOne({ key });
    return setting ? setting.value : defaultValue;
};

// Static method to set a setting
settingsSchema.statics.setSetting = async function (key, value, description = '') {
    return await this.findOneAndUpdate(
        { key },
        { key, value, description },
        { upsert: true, new: true }
    );
};

module.exports = mongoose.model('Settings', settingsSchema);
