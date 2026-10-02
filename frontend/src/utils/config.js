// Central configuration for API URLs
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const API_URL = `${BASE_URL}/api`;
export const SOCKET_URL = BASE_URL;
export const IMAGE_URL = BASE_URL;

// Helper function to get full image URL
export const getImageUrl = (imagePath) => {
    if (!imagePath) return null;
    if (imagePath.startsWith('http')) return imagePath; // Already absolute URL (R2)
    return `${IMAGE_URL}${imagePath}`;
};

export default {
    BASE_URL,
    API_URL,
    SOCKET_URL,
    IMAGE_URL,
    getImageUrl
};
