// A dot flies from the tapped ADD button to the cart, then the cart gives a little bump
export const flyToCart = (fromEl) => {
    const bump = () => window.dispatchEvent(new Event('cart-bump'));
    try {
        if (!fromEl || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { bump(); return; }
        const targets = [...document.querySelectorAll('[data-cart-target]')].filter(el => el.offsetParent !== null);
        const to = targets[targets.length - 1];
        if (!to) { bump(); return; }
        const a = fromEl.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        const dot = document.createElement('div');
        dot.className = 'fly-dot';
        dot.style.left = `${a.left + a.width / 2 - 9}px`;
        dot.style.top = `${a.top + a.height / 2 - 9}px`;
        document.body.appendChild(dot);
        requestAnimationFrame(() => {
            dot.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(.5)`;
            dot.style.opacity = '0.3';
        });
        setTimeout(() => { dot.remove(); bump(); }, 620);
    } catch { bump(); }
};
