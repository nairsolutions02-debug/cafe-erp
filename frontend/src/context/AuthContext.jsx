import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import io from 'socket.io-client';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const API_URL = `${BASE_URL}/api`;
const SOCKET_URL = BASE_URL;

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [loading, setLoading] = useState(true);
    const [socket, setSocket] = useState(null);

    useEffect(() => {
        if (token) {
            axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
            fetchUser();
        } else {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        const newSocket = io(SOCKET_URL);
        setSocket(newSocket);
        return () => newSocket.close();
    }, []);

    useEffect(() => {
        if (socket && user) {
            if (user.role === 'admin') {
                socket.emit('join-admin-room');
            } else {
                socket.emit('join-user-room', user._id || user.id);
            }
        }
    }, [socket, user]);

    const fetchUser = async () => {
        try {
            const res = await axios.get(`${API_URL}/auth/me`);
            setUser(res.data);
        } catch (error) {
            logout();
        } finally {
            setLoading(false);
        }
    };

    const sendOTP = async (phone) => {
        const res = await axios.post(`${API_URL}/auth/send-otp`, { phone });
        return res.data;
    };

    const verifyOTP = async (phone, otp, name, email) => {
        const res = await axios.post(`${API_URL}/auth/verify-otp`, { phone, otp, name, email });
        const { token: newToken, user: userData } = res.data;
        localStorage.setItem('token', newToken);
        axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
        setToken(newToken);
        setUser(userData);
        return userData;
    };

    const adminLogin = async (phone, password) => {
        const res = await axios.post(`${API_URL}/auth/admin-login`, { phone, password });
        const { token: newToken, user: userData } = res.data;
        localStorage.setItem('token', newToken);
        axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
        setToken(newToken);
        setUser(userData);
        return userData;
    };

    const logout = () => {
        localStorage.removeItem('token');
        delete axios.defaults.headers.common['Authorization'];
        setToken(null);
        setUser(null);
    };

    const updateProfile = async (data) => {
        const res = await axios.put(`${API_URL}/auth/profile`, data);
        setUser(res.data);
        return res.data;
    };

    return (
        <AuthContext.Provider value={{
            user,
            token,
            loading,
            socket,
            sendOTP,
            verifyOTP,
            adminLogin,
            logout,
            updateProfile,
            isAuthenticated: !!user,
            isAdmin: user?.role === 'admin'
        }}>
            {children}
        </AuthContext.Provider>
    );
};
