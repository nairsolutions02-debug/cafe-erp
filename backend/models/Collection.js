const mongoose = require('mongoose');

const collectionSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    slug: {
        type: String,
        unique: true,
        sparse: true,
        lowercase: true
    },
    icon: {
        type: String,
        default: '🍽️'
    },
    description: {
        type: String,
        default: ''
    },
    products: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MenuItem'
    }],
    isActive: {
        type: Boolean,
        default: true
    },
    showOnHomepage: {
        type: Boolean,
        default: true
    },
    order: {
        type: Number,
        default: 0
    },
    // Built-in types for system collections
    type: {
        type: String,
        enum: ['custom', 'bestseller', 'new', 'recommended'],
        default: 'custom'
    }
}, { timestamps: true });

// Generate slug before saving
collectionSchema.pre('save', function () {
    if (this.isModified('name') || !this.slug) {
        // Generate base slug
        let baseSlug = (this.name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
        // Add timestamp for uniqueness
        this.slug = `${baseSlug}-${Date.now().toString(36)}`;
    }
});

module.exports = mongoose.model('Collection', collectionSchema);
