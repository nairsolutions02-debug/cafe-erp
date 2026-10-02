require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');

// Import routes
const authRoutes = require('./routes/auth');
const categoryRoutes = require('./routes/categories');
const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');
const couponRoutes = require('./routes/coupons');
const inventoryRoutes = require('./routes/inventory');
const employeeRoutes = require('./routes/employees');
const analyticsRoutes = require('./routes/analytics');
const tableRoutes = require('./routes/tables');
const settingsRoutes = require('./routes/settings');
const collectionRoutes = require('./routes/collections');
const loyaltyRoutes = require('./routes/loyalty');

const app = express();
app.set('trust proxy', 1); // Enable proxy trust for Nginx
const server = http.createServer(app);

// Socket.IO setup
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        methods: ['GET', 'POST', 'PUT', 'DELETE']
    }
});

// Make io accessible in routes
app.set('io', io);

// Connect to MongoDB
connectDB();

// Initialize Redis (optional - for caching)
const { initRedis } = require('./utils/redis');
if (process.env.NODE_ENV === 'production') {
    initRedis().then(() => {
        console.log('Redis caching initialized');
    }).catch(err => {
        console.warn('Redis unavailable, caching disabled:', err.message);
    });
}

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/loyalty', loyaltyRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: "Cafe ERP API is running" });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Join user-specific room
    socket.on('join-user-room', (userId) => {
        socket.join(`user-${userId}`);
        console.log(`User ${userId} joined their room`);
    });

    // Join admin room
    socket.on('join-admin-room', () => {
        socket.join('admin-room');
        console.log('Admin joined admin room');
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Something went wrong!' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Create default admin user
const User = require('./models/User');
const createDefaultAdmin = async () => {
    try {
        const adminExists = await User.findOne({ role: 'admin' });
        if (!adminExists) {
            const adminPhone = process.env.ADMIN_PHONE || '9999999999';
            await User.create({
                phone: adminPhone,
                name: 'Admin',
                role: 'admin',
                isVerified: true
            });
            console.log(`Default admin created: phone: ${adminPhone} (password from ADMIN_PASSWORD)`);
        }
    } catch (error) {
        console.error('Error creating default admin:', error);
    }
};

setTimeout(createDefaultAdmin, 2000);
