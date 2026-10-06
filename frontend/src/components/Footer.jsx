import React from 'react';
import { Link } from 'react-router-dom';
import { FiMapPin, FiPhone, FiMail, FiClock, FiInstagram, FiFacebook } from 'react-icons/fi';
import './Footer.css';
import { useBrand } from '../context/BrandContext';
import useCxLang, { T } from '../lib/cxLang';

const W = {
    quickLinks: T('Quick Links', 'ज़रूरी लिंक', 'Quick links'),
    home: T('Home', 'होम', 'Home'),
    menu: T('Menu', 'मेन्यू', 'Menu'),
    cart: T('Cart', 'कार्ट', 'Cart'),
    myOrders: T('My Orders', 'मेरे ऑर्डर', 'Mere order'),
    contact: T('Contact Us', 'संपर्क करें', 'Contact karo'),
    hours: T('Hours', 'खुलने का समय', 'Timing'),
    rights: T('All rights reserved.', 'सर्वाधिकार सुरक्षित।', 'All rights reserved.'),
};

const Footer = () => {
    const brand = useBrand();
    const { t } = useCxLang();
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
                    <h4 className="footer-title">{t(W.quickLinks)}</h4>
                    <ul className="footer-links">
                        <li><Link to="/">{t(W.home)}</Link></li>
                        <li><Link to="/menu">{t(W.menu)}</Link></li>
                        <li><Link to="/cart">{t(W.cart)}</Link></li>
                        <li><Link to="/profile">{t(W.myOrders)}</Link></li>
                    </ul>
                </div>

                <div className="footer-section">
                    <h4 className="footer-title">{t(W.contact)}</h4>
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
                    <h4 className="footer-title">{t(W.hours)}</h4>
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
                <p>© {new Date().getFullYear()} {brand.name}. {t(W.rights)}</p>
            </div>
        </footer>
    );
};

export default Footer;
