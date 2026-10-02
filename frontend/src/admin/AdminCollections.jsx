import React, { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiX, FiCheck, FiPackage, FiEye, FiEyeOff, FiSearch, FiFilter } from 'react-icons/fi';
import {
    getAdminCollections,
    createCollection,
    updateCollection,
    deleteCollection,
    getAllMenuItems,
    addProductToCollection,
    removeProductFromCollection,
    getCategories
} from '../utils/api';
import { getImageUrl } from '../utils/config';
import Loader from '../components/Loader';
import './AdminCollections.css';

const AdminCollections = () => {
    const [collections, setCollections] = useState([]);
    const [menuItems, setMenuItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showProductModal, setShowProductModal] = useState(false);
    const [selectedCollection, setSelectedCollection] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        icon: '🍽️',
        description: '',
        showOnHomepage: true,
        order: 0,
        type: 'custom'
    });
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [showOnlySelected, setShowOnlySelected] = useState(false);
    const [categories, setCategories] = useState([]);

    const emojiOptions = ['🔥', '✨', '💯', '🌟', '❤️', '🍽️', '👨‍🍳', '🎉', '🥇', '💎', '🌶️', '🍃'];

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [collectionsRes, menuRes, catRes] = await Promise.all([
                getAdminCollections(),
                getAllMenuItems(),
                getCategories()
            ]);
            setCollections(collectionsRes.data);
            setMenuItems(menuRes.data);
            setCategories(catRes.data);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (selectedCollection) {
                await updateCollection(selectedCollection._id, formData);
            } else {
                await createCollection(formData);
            }
            fetchData();
            closeModal();
        } catch (error) {
            console.error('Error saving collection:', error);
            alert(error.response?.data?.message || 'Error saving collection. Please check if name is unique.');
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Are you sure you want to delete this collection?')) {
            try {
                await deleteCollection(id);
                fetchData();
            } catch (error) {
                console.error('Error deleting collection:', error);
            }
        }
    };

    const handleToggleHomepage = async (collection) => {
        try {
            await updateCollection(collection._id, {
                ...collection,
                showOnHomepage: !collection.showOnHomepage
            });
            fetchData();
        } catch (error) {
            console.error('Error updating collection:', error);
        }
    };

    const openEditModal = (collection) => {
        setSelectedCollection(collection);
        setFormData({
            name: collection.name,
            icon: collection.icon,
            description: collection.description || '',
            showOnHomepage: collection.showOnHomepage,
            order: collection.order || 0,
            type: collection.type || 'custom'
        });
        setShowModal(true);
    };

    const openProductModal = (collection) => {
        setSelectedCollection(collection);
        setShowProductModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setSelectedCollection(null);
        setFormData({
            name: '',
            icon: '🍽️',
            description: '',
            showOnHomepage: true,
            order: 0,
            type: 'custom'
        });
    };

    const handleAddProduct = async (productId) => {
        try {
            await addProductToCollection(selectedCollection._id, productId);
            fetchData();
            // Refresh selected collection
            const updated = (await getAdminCollections()).data.find(c => c._id === selectedCollection._id);
            setSelectedCollection(updated);
        } catch (error) {
            console.error('Error adding product:', error);
            alert(error.response?.data?.message || 'Error adding product');
        }
    };

    const handleRemoveProduct = async (productId) => {
        try {
            await removeProductFromCollection(selectedCollection._id, productId);
            fetchData();
            // Refresh selected collection
            const updated = (await getAdminCollections()).data.find(c => c._id === selectedCollection._id);
            setSelectedCollection(updated);
        } catch (error) {
            console.error('Error removing product:', error);
            alert(error.response?.data?.message || 'Error removing product');
        }
    };

    const closeProductModal = () => {
        setShowProductModal(false);
        setSearchQuery('');
        setSelectedCategory('all');
        setShowOnlySelected(false);
    };

    const isProductInCollection = (productId) => {
        return selectedCollection?.products?.some(p => p._id === productId || p === productId);
    };

    const filteredMenuItems = menuItems.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === 'all' || item.category?._id === selectedCategory || item.category === selectedCategory;
        const matchesSelected = !showOnlySelected || isProductInCollection(item._id);
        return matchesSearch && matchesCategory && matchesSelected;
    });

    if (loading) {
        return <Loader message="Loading your sections..." />;
    }

    return (
        <div className="admin-collections">
            <div className="page-header">
                <div>
                    <h1>Homepage Sections</h1>
                    <p>Create and manage custom sections for your homepage</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                    <FiPlus /> New Section
                </button>
            </div>

            <div className="collections-grid">
                {collections.map(collection => (
                    <div key={collection._id} className="collection-card">
                        <div className="collection-header">
                            <div className="collection-icon">{collection.icon}</div>
                            <div className="collection-info">
                                <h3>{collection.name}</h3>
                                <span className="product-count">{collection.products?.length || 0} products</span>
                            </div>
                            <div className="collection-status">
                                {collection.showOnHomepage ? (
                                    <span className="status-badge active">On Homepage</span>
                                ) : (
                                    <span className="status-badge inactive">Hidden</span>
                                )}
                            </div>
                        </div>

                        {collection.description && (
                            <p className="collection-description">{collection.description}</p>
                        )}

                        <div className="collection-products-preview">
                            {collection.products?.slice(0, 4).map(product => (
                                <div key={product._id} className="product-preview">
                                    {product.image ? (
                                        <img src={getImageUrl(product.image)} alt={product.name} />
                                    ) : (
                                        <div className="no-image">🍽️</div>
                                    )}
                                </div>
                            ))}
                            {collection.products?.length > 4 && (
                                <div className="product-preview more">
                                    +{collection.products.length - 4}
                                </div>
                            )}
                        </div>

                        <div className="collection-actions">
                            <button
                                className="action-btn"
                                onClick={() => openProductModal(collection)}
                                title="Manage Products"
                            >
                                <FiPackage />
                            </button>
                            <button
                                className="action-btn"
                                onClick={() => handleToggleHomepage(collection)}
                                title={collection.showOnHomepage ? 'Hide from Homepage' : 'Show on Homepage'}
                            >
                                {collection.showOnHomepage ? <FiEyeOff /> : <FiEye />}
                            </button>
                            <button
                                className="action-btn"
                                onClick={() => openEditModal(collection)}
                                title="Edit"
                            >
                                <FiEdit2 />
                            </button>
                            <button
                                className="action-btn danger"
                                onClick={() => handleDelete(collection._id)}
                                title="Delete"
                            >
                                <FiTrash2 />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {collections.length === 0 && (
                <div className="empty-state">
                    <FiPackage size={48} />
                    <h3>No Sections Yet</h3>
                    <p>Create your first homepage section to showcase your products</p>
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                        <FiPlus /> Create Section
                    </button>
                </div>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{selectedCollection ? 'Edit Section' : 'New Section'}</h2>
                            <button className="modal-close" onClick={closeModal}>
                                <FiX />
                            </button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Section Name *</label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="e.g., Chef's Special, Weekend Deals"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Icon</label>
                                    <div className="emoji-picker">
                                        {emojiOptions.map(emoji => (
                                            <button
                                                type="button"
                                                key={emoji}
                                                className={`emoji-btn ${formData.icon === emoji ? 'active' : ''}`}
                                                onClick={() => setFormData({ ...formData, icon: emoji })}
                                            >
                                                {emoji}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>Description</label>
                                    <textarea
                                        value={formData.description}
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                        placeholder="Optional description..."
                                        rows={3}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Display Order</label>
                                    <input
                                        type="number"
                                        value={formData.order}
                                        onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })}
                                        min="0"
                                    />
                                    <small>Lower numbers appear first</small>
                                </div>

                                <div className="form-group">
                                    <label>Section Type</label>
                                    <select
                                        value={formData.type}
                                        onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                    >
                                        <option value="custom">Custom (Hand-picked items)</option>
                                        <option value="bestseller">Dynamic Bestsellers</option>
                                        <option value="new">Dynamic New Arrivals</option>
                                        <option value="recommended">Dynamic Recommendations</option>
                                    </select>
                                    <small>System types automatically pull relevant items unless you add custom ones.</small>
                                </div>

                                <div className="form-group checkbox-group">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={formData.showOnHomepage}
                                            onChange={(e) => setFormData({ ...formData, showOnHomepage: e.target.checked })}
                                        />
                                        Show on Homepage
                                    </label>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={closeModal}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    {selectedCollection ? 'Update' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Product Management Modal */}
            {showProductModal && selectedCollection && (
                <div className="modal-overlay" onClick={closeProductModal}>
                    <div className="modal modal-large" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>
                                {selectedCollection.icon} {selectedCollection.name} - Manage Products
                            </h2>
                            <button className="modal-close" onClick={closeProductModal}>
                                <FiX />
                            </button>
                        </div>
                        <div className="modal-body product-manager">
                            <div className="manager-toolbar">
                                <div className="search-bar">
                                    <FiSearch />
                                    <input
                                        type="text"
                                        placeholder="Search products..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                </div>
                                <select
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                    className="category-filter"
                                >
                                    <option value="all">All Categories</option>
                                    {categories.map(cat => (
                                        <option key={cat._id} value={cat._id}>{cat.name}</option>
                                    ))}
                                </select>
                                <label className="selected-toggle">
                                    <input
                                        type="checkbox"
                                        checked={showOnlySelected}
                                        onChange={(e) => setShowOnlySelected(e.target.checked)}
                                    />
                                    Selected Only
                                </label>
                            </div>

                            <div className="products-list">
                                <div className="products-grid">
                                    {filteredMenuItems.map(item => (
                                        <div
                                            key={item._id}
                                            className={`product-item ${isProductInCollection(item._id) ? 'selected' : ''}`}
                                            onClick={() => isProductInCollection(item._id)
                                                ? handleRemoveProduct(item._id)
                                                : handleAddProduct(item._id)
                                            }
                                        >
                                            <div className="product-image">
                                                {item.image ? (
                                                    <img src={getImageUrl(item.image)} alt={item.name} />
                                                ) : (
                                                    <span>🍽️</span>
                                                )}
                                                {isProductInCollection(item._id) && (
                                                    <div className="selected-badge">
                                                        <FiCheck />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="product-details">
                                                <span className="product-name">{item.name}</span>
                                                <span className="product-price">₹{item.price}</span>
                                            </div>
                                        </div>
                                    ))}
                                    {filteredMenuItems.length === 0 && (
                                        <div className="no-results">No products match your search/filter</div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <p className="selected-count">
                                {selectedCollection.products?.length || 0} products selected
                            </p>
                            <button
                                className="btn btn-primary"
                                onClick={closeProductModal}
                            >
                                Done
                            </button>
                        </div>
                    </div >
                </div >
            )}
        </div >
    );
};

export default AdminCollections;
