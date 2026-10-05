// Guided tour steps per role, in English, Hindi and Hinglish.
// `at`: data-tour target on a laptop; `atPhone`: target on a phone (bottom bar / header). No target = a card in the middle.
const T = (en, hi, hg) => ({ en, hi, hg });

const HELP = { at: 'help', t: T('Help is always here', 'मदद हमेशा यहाँ', 'Help hamesha yahan'),
    d: T('The full guide in your language, “Where is it?” for any setting, and a button to tell N.A.I.R. about a problem. You can run this tour again from there.',
        'आपकी भाषा में पूरी गाइड, किसी भी सेटिंग के लिए “कहाँ मिलेगा?”, और N.A.I.R. को समस्या बताने का बटन। यह टूर वहीं से दोबारा चला सकते हैं।',
        'Aapki bhasha mein poori guide, kisi bhi setting ke liye “Kahan milega?”, aur N.A.I.R. ko problem batane ka button. Yeh tour wahin se dobara chala sakte ho.') };
const THEME = { at: 'theme', t: T('Light or dark', 'लाइट या डार्क', 'Light ya dark'),
    d: T('One tap switches this screen. Each phone and laptop keeps its own choice.', 'एक टैप से यह स्क्रीन बदलती है। हर फ़ोन और लैपटॉप अपनी पसंद रखता है।', 'Ek tap se yeh screen badalti hai. Har phone aur laptop apni pasand rakhta hai.') };
const SOUND = { at: 'bell', t: T('Alerts and sound', 'अलर्ट और आवाज़', 'Alert aur awaaz'),
    d: T('New orders and important alerts arrive here; big ones fill the screen until someone taps Acknowledge. Tap the screen once after opening the app so the sound can play.',
        'नए ऑर्डर और ज़रूरी अलर्ट यहाँ आते हैं; बड़े अलर्ट Acknowledge दबाने तक पूरी स्क्रीन पर रहते हैं। ऐप खोलने के बाद स्क्रीन एक बार छुएँ ताकि आवाज़ बज सके।',
        'Naye order aur zaroori alert yahan aate hain; bade alert Acknowledge dabane tak poori screen pe rehte hain. App kholne ke baad screen ek baar chhuo taaki awaaz baj sake.') };

export const TOURS = {
    owner: [
        { at: 'sec:settings', atPhone: 'q:/admin/more', t: T('Start with the Setup checklist', 'सेटअप चेकलिस्ट से शुरू करें', 'Setup checklist se shuru karo'),
            d: T('Settings → Setup checklist shows every step a new cafe needs, with a tick when done.', 'Settings → Setup checklist में नए कैफ़े के सारे कदम हैं, पूरा होने पर टिक।', 'Settings → Setup checklist mein naye cafe ke saare steps hain, poora hone pe tick.') },
        { t: T('Settings have ⓘ buttons', 'सेटिंग्स पर ⓘ बटन', 'Settings pe ⓘ button'),
            d: T('Not sure what a setting does? Tap the small ⓘ next to it: what it does, an example, and who can change it.', 'सेटिंग समझ नहीं आई? उसके पास छोटा ⓘ दबाएँ: क्या करती है, उदाहरण, और कौन बदल सकता है।', 'Setting samajh nahi aayi? Uske paas chhota ⓘ dabao: kya karti hai, example, aur kaun badal sakta hai.') },
        { at: 'sec:sell', atPhone: 'q:/admin/pos', t: T('Selling', 'बिक्री', 'Bikri'),
            d: T('Counter for walk-in orders and payments, Orders for table and QR orders, Kitchen for the cooks. The counter keeps working when the internet drops.', 'काउंटर पर आने वालों के ऑर्डर और पेमेंट के लिए Counter, टेबल और QR के लिए Orders, रसोइयों के लिए Kitchen। इंटरनेट जाने पर भी काउंटर चलता है।', 'Walk-in order aur payment ke liye Counter, table aur QR ke liye Orders, cooks ke liye Kitchen. Internet jaane pe bhi counter chalta hai.') },
        { at: 'sec:money', atPhone: 'q:/admin/more', t: T('Money', 'पैसा', 'Paisa'),
            d: T('Cash & Shifts, expenses, reports for the CA and the Profit advisor with plain suggestions to earn more.', 'कैश और शिफ्ट, ख़र्चे, CA के लिए रिपोर्ट और ज़्यादा कमाने की सीधी सलाह देने वाला Profit advisor।', 'Cash aur shift, kharche, CA ke liye report aur zyada kamane ki seedhi salah dene wala Profit advisor.') },
        SOUND, THEME, HELP,
    ],
    cashier: [
        { at: 'sec:sell', atPhone: 'q:/admin/pos', t: T('Counter', 'काउंटर', 'Counter'),
            d: T('Take orders and payments: tap items, Pay, choose Cash / UPI / Card, give the token number.', 'ऑर्डर और पेमेंट लें: आइटम दबाएँ, Pay, Cash / UPI / Card चुनें, टोकन नंबर दें।', 'Order aur payment lo: item dabao, Pay, Cash / UPI / Card chuno, token number do.') },
        { at: 'sec:sell', atPhone: 'q:/admin/orders', t: T('Orders', 'ऑर्डर', 'Order'),
            d: T('Table and QR orders wait here. A yellow “Confirm table” means a new table: check someone is sitting there, then confirm.', 'टेबल और QR ऑर्डर यहाँ आते हैं। पीला “Confirm table” मतलब नई टेबल: देखें कोई बैठा है, फिर कन्फ़र्म करें।', 'Table aur QR order yahan aate hain. Peela “Confirm table” matlab nayi table: dekho koi baitha hai, phir confirm karo.') },
        SOUND,
        { at: 'sec:home', atPhone: 'q:/admin/me', t: T('My day', 'मेरा दिन', 'My day'),
            d: T('Check in with a selfie when you arrive, see today’s tasks, and check out when you leave.', 'आने पर सेल्फ़ी के साथ चेक-इन, आज के काम देखें, जाते समय चेक-आउट।', 'Aane pe selfie ke saath check in, aaj ke kaam dekho, jaate waqt check out.') },
        HELP,
    ],
    kitchen: [
        { at: 'sec:sell', atPhone: 'q:/admin/kitchen', t: T('Kitchen', 'रसोई', 'Kitchen'),
            d: T('Every ticket shows the table or token. Tap a dish when you start cooking and again when it is ready; “All ready” sends it to the pickup TV.', 'हर टिकट पर टेबल या टोकन। बनाना शुरू करें तो डिश दबाएँ, तैयार हो तो फिर; “All ready” पिकअप टीवी पर भेजता है।', 'Har ticket pe table ya token. Banana shuru karo toh dish dabao, ready ho toh phir; “All ready” pickup TV pe bhejta hai.') },
        { t: T('Kitchen TV', 'किचन टीवी', 'Kitchen TV'),
            d: T('On a TV or tablet, tap Full screen on the Kitchen page: only tickets show. Tickets older than 6 hours fold into “From earlier”.', 'टीवी या टैबलेट पर Kitchen पेज पर Full screen दबाएँ: सिर्फ़ टिकट दिखेंगे। 6 घंटे से पुराने टिकट “From earlier” में।', 'TV ya tablet pe Kitchen page pe Full screen dabao: sirf ticket dikhenge. 6 ghante se purane ticket “From earlier” mein.') },
        SOUND, HELP,
    ],
    office: [
        { at: 'sec:money', atPhone: 'q:/admin/more', t: T('Money', 'पैसा', 'Paisa'),
            d: T('Finance for expenses and bills to pay, Reports for profit & loss and GST files for the CA.', 'ख़र्च और चुकाने वाले बिलों के लिए Finance, मुनाफ़ा-नुकसान और CA की GST फ़ाइलों के लिए Reports।', 'Kharch aur chukane wale bill ke liye Finance, munafa-nuksaan aur CA ki GST file ke liye Reports.') },
        { at: 'sec:team', atPhone: 'q:/admin/more', t: T('Team', 'टीम', 'Team'),
            d: T('Attendance and payroll: who came, who was late, and the month’s pay.', 'हाज़िरी और वेतन: कौन आया, कौन लेट, और महीने का वेतन।', 'Haaziri aur tankhwah: kaun aaya, kaun late, aur mahine ki pay.') },
        HELP,
    ],
};

// Which tour fits this person
export const tourFor = (hasPerm) => {
    if (hasPerm('settings.edit')) return 'owner';
    if (hasPerm('orders.create')) return 'cashier';
    if (hasPerm('finance.view') || hasPerm('employees.view')) return 'office';
    return 'kitchen';
};

export const TOUR_WORDS = {
    welcome: T('New here? Take a 1-minute tour', 'नए हैं? 1 मिनट का टूर लें', 'Naye ho? 1 minute ka tour lo'),
    welcomeSub: T('It shows the buttons you will use most. You can run it again from Help.', 'आपके सबसे ज़्यादा काम आने वाले बटन दिखाता है। Help से दोबारा चला सकते हैं।', 'Aapke sabse zyada kaam aane wale button dikhata hai. Help se dobara chala sakte ho.'),
    start: T('Start the tour', 'टूर शुरू करें', 'Tour shuru karo'),
    later: T('Later', 'बाद में', 'Baad mein'),
    never: T('No thanks', 'नहीं चाहिए', 'Nahi chahiye'),
    next: T('Next', 'आगे', 'Aage'), back: T('Back', 'पीछे', 'Peeche'), done: T('Done', 'हो गया', 'Ho gaya'),
    skip: T('Skip tour', 'टूर छोड़ें', 'Tour chhodo'), step: T('Step', 'कदम', 'Step'), of: T('of', 'में से', 'of'),
    again: T('Take the tour', 'टूर लें', 'Tour lo'),
};

// Help → Take the tour (and anything else) starts it
export const startTour = () => window.dispatchEvent(new Event('start-tour'));
