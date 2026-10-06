// Kinds of drawn pictures (components/cx/Art.jsx) and the guess of a picture from a dish name
export const ART_KINDS = ['latte', 'flatwhite', 'iced', 'frappe', 'coldbrew', 'chai', 'croissant', 'sandwich', 'cookie', 'cake', 'dosa', 'plate'];
export const ART_LABELS = {
    latte: 'Cappuccino', flatwhite: 'Flat white', iced: 'Iced coffee', frappe: 'Frappe', coldbrew: 'Cold brew',
    chai: 'Kulhad chai', croissant: 'Croissant', sandwich: 'Sandwich', cookie: 'Cookie', cake: 'Cake', dosa: 'Dosa', plate: 'Plate',
};

const GUESS = [
    [/dosa|uttapam|uthappam/i, 'dosa'],
    [/frapp|shake|cream|whip/i, 'frappe'], [/cold ?brew|tonic|lemon|soda|mojito|cooler|juice/i, 'coldbrew'],
    [/iced|cold|ice/i, 'iced'], [/chai|\btea\b|kulhad/i, 'chai'], [/flat ?white|mocha|hazelnut/i, 'flatwhite'],
    [/coffee|latte|cappu|espresso|americano|macchiato|filter/i, 'latte'], [/croissant|puff|bun|bread|pastry/i, 'croissant'],
    [/sandwich|toast|burger|wrap|roll|sub/i, 'sandwich'], [/cookie|biscuit/i, 'cookie'],
    [/cake|brownie|dessert|muffin|pastry|sweet|waffle/i, 'cake'],
];
export const artFor = (item) => {
    const k = item?.details?.art || item?.art;
    if (k && ART_KINDS.includes(k)) return k;
    // the dish name first; the category only when the name says nothing
    const byName = GUESS.find(([re]) => re.test(item?.name || ''))?.[1];
    return byName || GUESS.find(([re]) => re.test(item?.category?.name || ''))?.[1] || 'plate';
};

