import React from 'react';
import './Loader.css';

const Loader = ({ fullScreen = true, message = "Preparing your delicious meal..." }) => {
    return (
        <div className={`loader-overlay ${fullScreen ? 'full-screen' : 'inline'}`}>
            <div className="loader-container">
                <div className="kitchen">
                    {/* Tawa with Flipping Dosa */}
                    <div className="tawa">
                        <div className="dosa"></div>
                    </div>

                    {/* Plate with Steaming Idlis */}
                    <div className="plate">
                        <div className="idli idli-1">
                            <div className="steam"></div>
                        </div>
                        <div className="idli idli-2">
                            <div className="steam"></div>
                        </div>
                    </div>
                </div>

                <div className="loader-text">
                    <h3>{message}</h3>
                    <div className="loading-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Loader;
