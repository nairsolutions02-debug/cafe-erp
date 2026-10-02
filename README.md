# Cafe ERP - White-label Cafe & Restaurant Management System

A full-stack, white-label cafe/restaurant system (originally built for Chetta's Dosa) featuring customer ordering, real-time order tracking, admin dashboard, inventory management, employee attendance, and analytics.

## 🌟 Features

### Customer Features
- **Phone OTP Login**: OTP via SMS (2factor.in) for customers
- **Browse Menu**: Categories with horizontal scrolling (like Zomato/Swiggy)
- **Smart Cart**: Add items, apply coupons, see recommendations
- **Real-time Order Tracking**: Live status updates via Socket.IO
- **Bill Management**: Request bill, view bill, payment confirmation
- **Order History**: View all past orders

### Admin Features
- **Dashboard**: Real-time stats, revenue, pending orders
- **Orders Management**: Confirm, prepare, serve, generate bill, mark paid
- **Menu Management**: Add/edit categories and items with images
- **Stock Control**: Mark items as out of stock
- **Coupons & Offers**: Create percentage/fixed discount coupons
- **Inventory Management**: Track ingredients, low stock alerts
- **Employee Management**: Add employees, track attendance
- **Analytics Dashboard**: Revenue charts, category sales, top items

## 🎨 Design

- **Primary Color**: `#C87316` (Orange/Brown)
- **Off-white Background**: `#FFFAEF`
- **Mobile-first responsive design**
- **Bottom navigation for mobile**
- **Horizontal scrolling categories**

## 🛠️ Tech Stack

- **Frontend**: React + Vite
- **Backend**: Node.js + Express
- **Database**: MongoDB
- **Real-time**: Socket.IO
- **Charts**: Recharts
- **Styling**: Vanilla CSS

## 📦 Installation

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)

### 1. Clone and Install

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Configure Environment

Edit `backend/.env`:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/chettas_dosa
JWT_SECRET=your_secret_key
ADMIN_PASSWORD=choose_a_password
FRONTEND_URL=http://localhost:5173
```

### 3. Start MongoDB

```bash
mongod
```

### 4. Run Application

```bash
# Terminal 1 - Backend
cd backend
npm start

# Terminal 2 - Frontend
cd frontend
npm run dev
```

### 5. Access Application

- **Customer App**: http://localhost:5173
- **Admin Panel**: http://localhost:5173/admin/login

### Admin Credentials
- **Phone**: value of `ADMIN_PHONE` (default `9999999999`)
- **Password**: value of `ADMIN_PASSWORD` (required; admin login is disabled until it is set)

## 📱 Customer Flow

1. Visit website → Enter phone number
2. Receive OTP (shown in console for development)
3. Enter OTP + optional name/email
4. Browse categories → Select items → Add to cart
5. View cart → Apply coupon → Place order
6. Track order status in real-time
7. When served → Request bill
8. Admin generates bill → View bill
9. Pay at counter → Admin marks as paid

## 🔧 Admin Flow

1. Login at `/admin/login`
2. **Orders**: Confirm → Prepare → Ready → Served → Bill → Paid
3. **Menu**: Add categories, add items, set bestseller/new
4. **Inventory**: Track stock, restock items
5. **Employees**: Add staff, mark daily attendance
6. **Analytics**: View revenue, sales by category

## 📁 Project Structure

```
├── backend/
│   ├── config/          # Database config
│   ├── middleware/      # Auth, upload
│   ├── models/          # MongoDB schemas
│   ├── routes/          # API routes
│   ├── utils/           # Helper functions
│   ├── uploads/         # Image uploads
│   └── server.js        # Entry point
│
├── frontend/
│   ├── src/
│   │   ├── admin/       # Admin pages
│   │   ├── components/  # Reusable components
│   │   ├── context/     # Auth & Cart context
│   │   ├── pages/       # Customer pages
│   │   └── utils/       # API functions
│   └── index.html
```

## 🔌 API Endpoints

### Auth
- `POST /api/auth/send-otp` - Send OTP
- `POST /api/auth/verify-otp` - Verify & login
- `POST /api/auth/admin-login` - Admin login

### Menu
- `GET /api/categories` - Get categories
- `GET /api/menu` - Get menu items
- `GET /api/menu/bestsellers` - Bestsellers
- `GET /api/menu/recommended` - Recommendations

### Orders
- `POST /api/orders` - Create order
- `GET /api/orders/current` - Current order
- `PUT /api/orders/:id/status` - Update status
- `PUT /api/orders/:id/request-bill` - Request bill

### Admin
- `GET /api/analytics/dashboard` - Stats
- `GET /api/analytics/revenue` - Revenue data
- `GET /api/inventory` - Inventory list
- `GET /api/employees` - Employee list

## 🏷️ Branding a new cafe

All cafe-specific text lives in env vars, so the code is identical for every cafe:

- **Frontend** (`frontend/.env.example`): `VITE_CAFE_NAME`, `VITE_CAFE_TAGLINE`, `VITE_CAFE_THEME_COLOR`, address, phone, email, socials, hours, search hints. See `frontend/src/brand.js`.
- **Logo**: set `VITE_CAFE_LOGO_URL` (defaults to a generic cup logo, `frontend/public/logo.svg`).
- **Bills**: restaurant name, address, phone and GSTIN are set in Admin → Settings.

## 🚀 Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md).

## 📝 License

MIT License

---

**Cafe ERP by N.A.I.R. Solutions** 🍽️
