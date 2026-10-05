// "Where is it?": every setting and common task, with the menu path that opens it.
// `where` keeps the English menu words people see on screen; `q` is in the three languages.
const T = (en, hi, hg) => ({ en, hi, hg });

export const WHERE = [
    // Cafe identity and bills
    { q: T('Cafe name, logo, short line, address, phone, hours', 'कैफ़े का नाम, लोगो, छोटी लाइन, पता, फ़ोन, समय', 'Cafe naam, logo, chhoti line, pata, phone, time'), where: 'Settings → Brand & look', go: '/admin/brand', perms: ['settings.view'] },
    { q: T('Colours, corners, font of the app', 'ऐप के रंग, कोने, फ़ॉन्ट', 'App ke rang, kone, font'), where: 'Settings → Brand & look → Colours / Look', go: '/admin/brand', perms: ['settings.view'] },
    { q: T('Customer app opens light or dark', 'ग्राहक ऐप लाइट या डार्क खुले', 'Customer app light ya dark khule'), where: 'Settings → Brand & look → Customer app opens in', go: '/admin/brand', perms: ['settings.view'] },
    { q: T('GSTIN, FSSAI number, bill footer', 'GSTIN, FSSAI नंबर, बिल के नीचे की लाइन', 'GSTIN, FSSAI number, bill ke neeche ki line'), where: 'Settings → Cafe settings', go: '/admin/settings', perms: ['settings.view'] },
    { q: T('GST rate and other taxes on the bill', 'बिल पर GST दर और बाकी टैक्स', 'Bill pe GST rate aur baaki tax'), where: 'Settings → Cafe settings → Tax Configuration', go: '/admin/settings', perms: ['settings.view'] },
    { q: T('A different tax rate for some items', 'कुछ आइटम पर अलग टैक्स दर', 'Kuch item pe alag tax rate'), where: 'Menu → Brands & Taxes → Tax groups', go: '/admin/catalogue', perms: ['menu.view'] },
    { q: T('What is still missing in the setup', 'सेटअप में अभी क्या बाकी है', 'Setup mein abhi kya baaki hai'), where: 'Settings → Setup checklist', go: '/admin/setup', perms: ['settings.view'] },
    // Menu
    { q: T('Add a dish or change a price', 'डिश जोड़ना या दाम बदलना', 'Dish jodna ya daam badalna'), where: 'Menu → Items', go: '/admin/menu', perms: ['menu.view'] },
    { q: T('Switch off a dish that ran out', 'ख़त्म हुई डिश बंद करना', 'Khatam hui dish band karna'), where: 'Menu → Items → the dish', go: '/admin/menu', perms: ['menu.view'] },
    { q: T('Categories (Coffee, Snacks…)', 'श्रेणियाँ (Coffee, Snacks…)', 'Category (Coffee, Snacks…)'), where: 'Menu → Categories', go: '/admin/categories', perms: ['menu.view'] },
    { q: T('Recipe and food cost of a dish', 'डिश की रेसिपी और लागत', 'Dish ki recipe aur laagat'), where: 'Menu → Recipes & Costing', go: '/admin/recipes', perms: ['inventory.view'] },
    { q: T('Groups of dishes on the customer home screen', 'ग्राहक होम स्क्रीन पर डिशों के समूह', 'Customer home screen pe dishes ke group'), where: 'Menu → Homepage Sections', go: '/admin/collections', perms: ['collections.view'] },
    { q: T('Banners and the announcement line on the customer app', 'ग्राहक ऐप पर बैनर और सूचना की लाइन', 'Customer app pe banner aur announcement line'), where: 'Menu → Customer app', go: '/admin/customer-app', perms: ['settings.view'] },
    // Selling
    { q: T('Tables and their QR codes', 'टेबल और उनके QR कोड', 'Table aur unke QR code'), where: 'Sell → Tables', go: '/admin/tables', perms: ['tables.view'] },
    { q: T('Staff confirm a table\'s first QR order', 'टेबल का पहला QR ऑर्डर स्टाफ कन्फ़र्म करे', 'Table ka pehla QR order staff confirm kare'), where: 'Menu → Customer app → Tables and QR codes', go: '/admin/customer-app', perms: ['settings.view'] },
    { q: T('Pickup TV for token numbers', 'टोकन नंबर के लिए पिकअप टीवी', 'Token number ke liye pickup TV'), where: 'Sell → Pickup screen', go: '/admin/pickup-screen', perms: ['orders.view'] },
    { q: T('Kitchen screen in full screen (TV / tablet)', 'किचन स्क्रीन पूरी स्क्रीन में (टीवी / टैबलेट)', 'Kitchen screen full screen mein (TV / tablet)'), where: 'Sell → Kitchen → Full screen', go: '/admin/kitchen', perms: ['orders.view'] },
    { q: T('Set up a self-order kiosk', 'सेल्फ़-ऑर्डर कियोस्क सेट करना', 'Self-order kiosk set karna'), where: 'Sell → Kiosk → Set up this screen as a kiosk', go: '/admin/kiosk', perms: ['orders.create'] },
    { q: T('Old counters and kiosks, kiosk slots', 'पुराने काउंटर और कियोस्क, कियोस्क स्लॉट', 'Purane counter aur kiosk, kiosk slot'), where: 'Settings → Cafe settings → Devices', go: '/admin/settings', perms: ['settings.view'] },
    { q: T('Find an old order or reprint a bill', 'पुराना ऑर्डर ढूँढना या बिल दोबारा छापना', 'Purana order dhoondhna ya bill dobara chhapna'), where: 'Sell → Order history', go: '/admin/history', perms: ['orders.view'] },
    // Customers
    { q: T('Today\'s sales, orders and stock warnings at a glance', 'आज की बिक्री, ऑर्डर और स्टॉक चेतावनी एक नज़र में', 'Aaj ki bikri, order aur stock warning ek nazar mein'), where: 'Home → Dashboard', go: '/admin', perms: ['reports.view'] },
    { q: T('A customer\'s visits, spend and favourite dishes; export the list', 'ग्राहक के आने, ख़र्च और पसंदीदा डिश; लिस्ट डाउनलोड', 'Customer ke visit, kharch aur favourite dish; list download'), where: 'Customers → Customers', go: '/admin/customers', perms: ['customers.view'] },
    { q: T('Coupons and offer codes', 'कूपन और ऑफ़र कोड', 'Coupon aur offer code'), where: 'Customers → Coupons', go: '/admin/coupons', perms: ['coupons.view'] },
    { q: T('Points per ₹ and how points are spent', '₹ पर पॉइंट्स और पॉइंट्स कैसे खर्च हों', '₹ pe points aur points kaise kharch ho'), where: 'Customers → Points', go: '/admin/loyalty', perms: ['rewards.view'] },
    { q: T('Automatic gifts (5th coffee free, comeback offer)', 'अपने-आप तोहफ़े (5वीं कॉफ़ी मुफ़्त, वापसी ऑफ़र)', 'Apne aap gift (5vi coffee free, comeback offer)'), where: 'Customers → Rewards → Rules', go: '/admin/rewards', perms: ['rewards.view'] },
    { q: T('Monthly tiers, Members Club, birthday gifts', 'महीने के टियर, मेंबर्स क्लब, बर्थडे गिफ्ट', 'Mahine ke tier, Members Club, birthday gift'), where: 'Customers → FiKA Club', go: '/admin/club', perms: ['customers.view'] },
    { q: T('Khata (credit) limit for a customer', 'किसी ग्राहक की खाता (उधार) सीमा', 'Kisi customer ki khata (udhaar) limit'), where: 'Customers → Khata', go: '/admin/khata', perms: ['customers.view'] },
    { q: T('Dish ratings and customer comments', 'डिश की रेटिंग और ग्राहकों की राय', 'Dish ki rating aur customer comment'), where: 'Customers → Rewards → Feedback', go: '/admin/rewards?tab=feedback', perms: ['customers.view'] },
    // Money
    { q: T('Open or close a cash shift', 'कैश शिफ्ट खोलना या बंद करना', 'Cash shift kholna ya band karna'), where: 'Money → Cash & Shifts', go: '/admin/shifts', perms: ['orders.edit'] },
    { q: T('Add an expense or a bill to pay later', 'ख़र्च या बाद में चुकाने वाला बिल जोड़ना', 'Kharch ya baad mein chukane wala bill jodna'), where: 'Money → Finance → Expenses / Payables', go: '/admin/finance?tab=expenses', perms: ['finance.view'] },
    { q: T('Rent, internet and other monthly bills', 'किराया, इंटरनेट और बाकी महीने के बिल', 'Kiraya, internet aur baaki mahine ke bill'), where: 'Money → Finance → Payables → Monthly bills', go: '/admin/finance?tab=payables', perms: ['finance.view'] },
    { q: T('Profit & loss, GST files for the CA', 'मुनाफ़ा-नुकसान, CA के लिए GST फ़ाइलें', 'Munafa-nuksaan, CA ke liye GST file'), where: 'Money → Reports', go: '/admin/reports', perms: ['finance.view'] },
    { q: T('Weekly or monthly profit target', 'हफ़्ते या महीने का मुनाफ़ा लक्ष्य', 'Hafte ya mahine ka munafa target'), where: 'Money → Reports → Profit target', go: '/admin/reports?tab=targets', perms: ['finance.view'] },
    { q: T('Usual profit margin on Sales trends', 'Sales trends पर आम मुनाफ़ा %', 'Sales trends pe aam margin'), where: 'Money → Reports → Sales trends → gear on Estimated profit', go: '/admin/analytics', perms: ['reports.view'] },
    { q: T('Advice to earn more, Swiggy / Zomato statements', 'ज़्यादा कमाने की सलाह, Swiggy / Zomato स्टेटमेंट', 'Zyada kamane ki salah, Swiggy / Zomato statement'), where: 'Money → Profit advisor', go: '/admin/profit', perms: ['finance.view'] },
    // Team
    { q: T('Add a staff login or reset a PIN', 'स्टाफ लॉगिन जोड़ना या PIN रीसेट', 'Staff login jodna ya PIN reset'), where: 'Team → Staff logins & Roles', go: '/admin/staff', perms: ['staff.view'] },
    { q: T('What each role can see and do', 'हर रोल क्या देख और कर सकता है', 'Har role kya dekh aur kar sakta hai'), where: 'Team → Staff logins & Roles → Roles & permissions', go: '/admin/staff', perms: ['staff.view'] },
    { q: T('Salary, shift time and weekly off of a person', 'किसी का वेतन, शिफ्ट समय और साप्ताहिक छुट्टी', 'Kisi ki salary, shift time aur weekly off'), where: 'Team → Employees', go: '/admin/employees', perms: ['employees.view'] },
    { q: T('Cafe location for check-in', 'चेक-इन के लिए कैफ़े की लोकेशन', 'Check-in ke liye cafe location'), where: 'Team → Attendance → Cafe location', go: '/admin/attendance#cafe-location', perms: ['settings.edit'] },
    { q: T('Link a staff login to an employee', 'स्टाफ लॉगिन को कर्मचारी से जोड़ना', 'Staff login ko employee se jodna'), where: 'Team → Attendance → App login (or Setup checklist → Link them now)', go: '/admin/attendance', perms: ['employees.view'] },
    { q: T('Leave, advances, penalties, payslips', 'छुट्टी, एडवांस, जुर्माना, payslip', 'Chhutti, advance, penalty, payslip'), where: 'Team → Payroll', go: '/admin/payroll', perms: ['employees.view'] },
    // Alerts and your screen
    { q: T('Who gets which alert, alarm or quiet', 'किसे कौन सा अलर्ट, अलार्म या शांत', 'Kise kaun sa alert, alarm ya quiet'), where: 'Settings → Alerts', go: '/admin/alerts', perms: ['staff.view'] },
    { q: T('Alerts on this phone when the app is closed', 'ऐप बंद होने पर इस फ़ोन पर अलर्ट', 'App band hone pe is phone pe alert'), where: 'My day → Turn on alerts on this phone', go: '/admin/me' },
    { q: T('Light or dark screen', 'लाइट या डार्क स्क्रीन', 'Light ya dark screen'), where: 'Sun / moon button at the top (phone: More → Screen colours)', go: '/admin/more' },
    { q: T('Menu language: English, हिन्दी, Hinglish', 'मेन्यू की भाषा: English, हिन्दी, Hinglish', 'Menu ki bhasha: English, हिन्दी, Hinglish'), where: 'Side menu bottom (phone: More → Language)', go: '/admin/more' },
    { q: T('Who changed a price or setting', 'दाम या सेटिंग किसने बदली', 'Daam ya setting kisne badli'), where: 'Settings → Audit log', go: '/admin/audit', perms: ['audit.view'] },
    { q: T('Ask N.A.I.R. or report a problem', 'N.A.I.R. से पूछना या समस्या बताना', 'N.A.I.R. se poochna ya problem batana'), where: 'Help & support → Ask N.A.I.R. (or the ? at the top)', go: '/admin/help?tab=tickets' },
];
