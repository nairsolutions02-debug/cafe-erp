/**
 * Redis Cache Utility
 * Server-side caching for high-performance API
 * 
 * Installation:
 *   npm install ioredis
 * 
 * Usage in routes:
 *   const { getCache, setCache, deleteCache } = require('../utils/redis');
 *   
 *   // Check cache first
 *   const cached = await getCache('menu:all');
 *   if (cached) return res.json(cached);
 *   
 *   // Query database
 *   const data = await MenuItem.find();
 *   
 *   // Cache for 1 hour
 *   await setCache('menu:all', data, 3600);
 */

const Redis = require('ioredis');

// Redis connection configuration
const redisConfig = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,

    // Reconnection settings
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    },

    // Connection timeout
    connectTimeout: 10000,

    // Keep alive
    keepAlive: 30000,

    // Lazy connect (don't fail if Redis is down)
    lazyConnect: true,

    // Enable offline queue
    enableOfflineQueue: true,

    maxRetriesPerRequest: 3
};

// Create Redis client
let redis = null;
let isConnected = false;

/**
 * Initialize Redis connection
 */
const initRedis = async () => {
    try {
        redis = new Redis(redisConfig);

        redis.on('connect', () => {
            console.log('✅ Redis connected');
            isConnected = true;
        });

        redis.on('error', (err) => {
            console.error('❌ Redis error:', err.message);
            isConnected = false;
        });

        redis.on('close', () => {
            console.log('⚠️ Redis connection closed');
            isConnected = false;
        });

        await redis.connect();
        return redis;
    } catch (error) {
        console.warn('⚠️ Redis not available, caching disabled:', error.message);
        return null;
    }
};

/**
 * Get cached data
 * @param {string} key - Cache key
 * @returns {any|null} - Parsed data or null if not found
 */
const getCache = async (key) => {
    if (!redis || !isConnected) return null;

    try {
        const data = await redis.get(key);
        if (data) {
            return JSON.parse(data);
        }
        return null;
    } catch (error) {
        console.error('Redis GET error:', error.message);
        return null;
    }
};

/**
 * Set cached data
 * @param {string} key - Cache key
 * @param {any} data - Data to cache (will be JSON stringified)
 * @param {number} ttl - Time to live in seconds (default: 1 hour)
 */
const setCache = async (key, data, ttl = 3600) => {
    if (!redis || !isConnected) return false;

    try {
        await redis.setex(key, ttl, JSON.stringify(data));
        return true;
    } catch (error) {
        console.error('Redis SET error:', error.message);
        return false;
    }
};

/**
 * Delete cached data
 * @param {string} key - Cache key (supports patterns with *)
 */
const deleteCache = async (key) => {
    if (!redis || !isConnected) return false;

    try {
        if (key.includes('*')) {
            // Pattern delete (e.g., 'menu:*')
            const keys = await redis.keys(key);
            if (keys.length > 0) {
                await redis.del(...keys);
            }
        } else {
            await redis.del(key);
        }
        return true;
    } catch (error) {
        console.error('Redis DEL error:', error.message);
        return false;
    }
};

/**
 * Clear all cache
 */
const clearAllCache = async () => {
    if (!redis || !isConnected) return false;

    try {
        await redis.flushdb();
        console.log('🧹 Redis cache cleared');
        return true;
    } catch (error) {
        console.error('Redis FLUSH error:', error.message);
        return false;
    }
};

/**
 * Cache key generators for consistent naming
 */
const cacheKeys = {
    // Menu
    menuAll: () => 'menu:all',
    menuByCategory: (category) => `menu:category:${category}`,
    menuItem: (id) => `menu:item:${id}`,

    // Categories
    categoriesAll: () => 'categories:all',

    // Collections
    collectionsAll: () => 'collections:all',
    collection: (id) => `collection:${id}`,

    // User specific (use sparingly)
    userCart: (userId) => `user:${userId}:cart`,

    // Analytics
    dashboardStats: () => 'analytics:dashboard',
    popularItems: () => 'analytics:popular'
};

/**
 * Cache TTL presets (in seconds)
 */
const cacheTTL = {
    SHORT: 60,        // 1 minute - for frequently changing data
    MEDIUM: 300,      // 5 minutes - for semi-static data
    LONG: 3600,       // 1 hour - for menu items, categories
    DAY: 86400,       // 24 hours - for static content
    WEEK: 604800      // 7 days - for rarely changing data
};

module.exports = {
    initRedis,
    getCache,
    setCache,
    deleteCache,
    clearAllCache,
    cacheKeys,
    cacheTTL,
    getRedisClient: () => redis
};
