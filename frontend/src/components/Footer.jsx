import React from 'react';
import { Link } from 'react-router-dom';
import { FiMapPin, FiPhone, FiMail, FiClock, FiInstagram, FiFacebook } from 'react-icons/fi';
import './Footer.css';
import brand from '../brand';

const Footer = () => {
    return (
        <footer className="footer">
            <div className="footer-content">
                <div className="footer-section footer-brand">
                    <img src={brand.logo} alt={brand.name} className="footer-logo" />
                    <p className="footer-tagline">
                        {brand.tagline}
                    </p>
                    <div className="footer-social">
                        {brand.instagram && <a href={brand.instagram} className="social-link" target="_blank" rel="noreferrer"><FiInstagram /></a>}
                        {brand.facebook && <a href={brand.facebook} className="social-link" target="_blank" rel="noreferrer"><FiFacebook /></a>}
                    </div>
                </div>

                <div className="footer-section">
                    <h4 className="footer-title">Quick Links</h4>
                    <ul className="footer-links">
                        <li><Link to="/">Home</Link></li>
                        <li><Link to="/menu">Menu</Link></li>
                        <li><Link to="/cart">Cart</Link></li>
                        <li><Link to="/profile">My Orders</Link></li>
                    </ul>
                </div>

                <div className="footer-section">
                    <h4 className="footer-title">Contact Us</h4>
                    <ul className="footer-contact">
                        {brand.address && (
                            <li>
                                <FiMapPin className="contact-icon" />
                                <span>{brand.address}</span>
                            </li>
                        )}
                        {brand.phone && (
                            <li>
                                <FiPhone className="contact-icon" />
                                <span>{brand.phone}</span>
                            </li>
                        )}
                        {brand.email && (
                            <li>
                                <FiMail className="contact-icon" />
                                <span>{brand.email}</span>
                            </li>
                        )}
                    </ul>
                </div>

                <div className="footer-section">
                    <h4 className="footer-title">Hours</h4>
                    <ul className="footer-hours">
                        <li>
                            <FiClock className="contact-icon" />
                            <div>
                                <span>{brand.hoursDays}</span>
                                <span>{brand.hoursTime}</span>
                            </div>
                        </li>
                    </ul>
                </div>
            </div>

            <div className="footer-bottom">
                <p>© {new Date().getFullYear()} {brand.name}. All rights reserved.</p>
            </div>
        </footer>
    );
};

export default Footer;
