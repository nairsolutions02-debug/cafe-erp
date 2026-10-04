# Cafe ERP — Release log

Newest first. Each release lists what changed, how to deploy it, and a checklist to test on the live site.

---

## Pickup screen: a big TV that shows "Preparing" and "Ready to collect" (2026-10-04)

**Why:** in a rush, people crowd the counter asking "is mine ready?". A TV that everyone can read from their seat (5–10 m away) shows which orders are cooking and which are ready, so customers wait seated and staff hand over orders faster.

**What's new**

| Area | Change |
| --- | --- |
| The TV screen | Its own private link: `/display/<code>`. No login on the TV. Left column **Preparing** (amber: cooking now, dimmer: in queue). Right column **Ready to collect** with huge green numbers and first names. Clock, live dot, and your announcement scrolling at the bottom. Works on landscape and portrait TVs. |
| Animations | New orders pop in and glow. When an order becomes ready, the whole screen turns green for 5 s with the giant number, the name and "Please collect it from the counter", plus a two-tone chime (tap the TV once to allow sound). |
| Pickup numbers | Counter and kiosk tokens show as they are (12, 13…). **QR orders now get Q1, Q2, Q3…** for the day. The customer's order screen shows **"Your number Q7 — watch for it on the screen"**, which turns green: **"Ready! Collect at the counter"**. |
| Follows the kitchen | An order moves to Ready when the kitchen marks every dish ready (Kitchen screen, Orders, or the new page). Counter orders paid upfront work too. Collected orders leave at once. If nobody taps Collected, a ready order leaves after 10 minutes (you can change this). Orders older than 2 hours drop off. |
| What is shown | Takeaway, counter and QR orders without a table. Table orders stay off by default because they go to the table; switch on "Include table orders" for self-service hours. Kiosk sales and orders waiting for "Confirm table" never show. Only first names, never phone numbers. |
| Admin → Sell → **Pickup screen** | Add up to 5 screens (link, QR, Copy, Open, Remove, "On now" status, live mini preview). **Ready to collect** list with a **Collected** button per order. Tap any **Preparing** number to mark it ready (for when you don't use the Kitchen screen). Settings: names on/off, include table orders, how long ready orders stay, top message. |
| Busy screen | Fewer ready orders mean bigger tiles. With many orders, pages turn every 7 s. If the Wi-Fi drops, a "Reconnecting…" badge shows and the last board stays up. The TV is kept awake. |

**Deploy**

1. Supabase → SQL Editor → **New query** → paste **`supabase/upgrades/2026-10-pickup-screen.sql`** → Run → *Success*.
2. Vercel redeploys from `main` by itself. No new APK is needed.
3. Admin → Sell → Pickup screen → **Add screen** → open the link on the cafe TV → tap once (sound + full screen) → in the TV settings, turn off sleep.

**Test checklist**
- [ ] Phone: QR order without a table → order screen shows "Your number Q1"
- [ ] TV/laptop: the screen link shows Q1 under **Preparing** with the first name
- [ ] Kitchen screen → mark all dishes ready → TV turns green with "Q1", chime plays (after one tap on the TV), then Q1 sits under **Ready to collect**; phone card turns green
- [ ] Pickup screen page → **Collected** → Q1 leaves the TV within 3 s
- [ ] Counter takeaway with token 12, paid by cash → shows under Preparing → tap **12** on the Pickup screen page → moves to Ready
- [ ] Table order → not on the TV; switch on "Include table orders" → appears with "Table 5"
- [ ] Remove the screen → TV shows "This screen link isn't active"

---

## Customers now see when staff cancel their order (2026-10-04)

**What's new**

| Area | Change |
| --- | --- |
| Order screen | A cancelled order shows **"This order was cancelled"** with the reason staff typed. The internal "approved by…" note is hidden. If they had paid, it says "You paid ₹X. The staff will return it to you."; if they used points, it says the points are back. The progress tracker shows **Order Cancelled** instead of staying on "Order placed". It updates live, with no refresh needed. |
| Anywhere in the app | If the customer is on another page (menu, home, cart), a red alert appears: **"Order ORD-… was cancelled by the cafe. [View]"**. It replaces any other reminder and stays 10 seconds. |
| Order again | One tap puts the same dishes back in the cart. |

**Deploy**

Nothing to run. Vercel redeploys from `main`, and there's no SQL and no new APK.

**Test checklist**
- [ ] Phone: place a QR order and stay on the order screen → laptop: Orders → Cancel → reason "Dosa batter finished" → the phone shows the red cancelled box with that reason within a couple of seconds
- [ ] Phone: place another order, go to the Menu → cancel it from the laptop → red alert at the top → **View** opens the cancelled order
- [ ] **Order again** → cart has the same items
- [ ] Order paid with points, then cancelled → "Your N points are back" and the points balance is restored

---

## Table QR ordering, shared tables, owner-editable customer app (2026-10-04)

**What's new**

| Area | Change |
| --- | --- |
| Table from the QR | New QR codes open `/t/5-K7Q2` (a private code per table). The customer sees **"You're at Table 5"**, then the menu. There's no table dropdown: the table chip shows in the header and at checkout. Old printed `?table=5` QRs keep working until you switch them off. |
| Shared tables | Customers never see "occupied". Any number of people can scan the same QR, log in and order. **Each customer is their own group with their own bill.** "Request bill" asks only for that customer's orders. |
| Staff view | **Tables**: shows who is at each table (*Rahul ₹231 · Asha ₹294*), with busy/free set automatically from open bills. **Orders**: "Table 5 · 2 groups", a **Whole table** bill when one group pays for all, and **Move** to another table. **Kitchen** and KOT print the customer's first name when a table is shared. |
| Table modes | Menu → **Customer app**: *From the QR (locked)* (default) · *Customer picks* (dropdown, for cafes without QRs) · *No tables* (pickup only). |
| Safety | Optional **Staff confirm a table's first order**: the order waits (the kitchen doesn't see it) until staff tap **Confirm table**. This stops orders from a QR photo shared outside the cafe. The **↻ New QR code** button on Tables replaces one table's code, and the old QR stops working. Double taps place one order. |
| Moving tables | A customer who scans another table's QR is asked "Move to Table 7?", and their open orders follow them. |
| Return visits | The phone forgets the table after 3 hours or once their bill is paid, so the next visit asks them to scan again. **Takeaway instead** is one tap. |
| Banners | Menu → Customer app → **Banners**: headline, label, text, button, opens (item / category / rewards / menu / web link), colour or picture, start and end dates, on/off, reorder. Up to 12. Restricted and kiosk-only items can't be promoted, and an item's banner hides itself when the item is sold out. |
| Announcement strip | One line above the banners (scrolls if long). |
| What customers see | Switches for reward progress ring, item photos, badges and ⓘ info buttons, plus the **main colour**. |
| Reminders | Order milestone card at checkout (**"#24 · This will be your 24th order"**), **"You have enough points to pay!"** chip (only when the points really work on that bill), "1 more order to your reward", and confetti when an order is placed. Each has a switch. The rules: one at a time, auto-hides after 5 s, once per visit, never covers the Order button, and no motion when the phone asks for less. |
| Menu | Tap an item for a bottom sheet with a big picture and description. ADD flies a dot into the cart, which bumps. The cart bar shows the total. |

**Deploy**

1. Supabase → SQL Editor → paste **`supabase/upgrades/2026-10-table-ordering.sql`** → Run → *Success*. Run it once, after the kiosk-menu upgrade.
   *Fixed 2026-10-04:* the first version stopped with "unterminated dollar-quoted string" (an apostrophe in a comment confused the SQL Editor). Nothing was applied then; paste the current file.
2. Vercel redeploys from `main` by itself. No new APK is needed.
3. Tables → **QR Codes** → Print → replace the table stickers. When every table has the new QR: Menu → Customer app → turn off **Old printed QR codes still work**.

**Test checklist**
- [ ] Tables → print Table 5's QR → scan with a phone → "You're at Table 5" → menu; header shows 📍5
- [ ] Order from phone A, then from phone B (different number) on the same QR → both go through; nobody sees "occupied"
- [ ] Tables → Table 5 shows both names with their amounts; Orders → "Table 5 · 2 groups"
- [ ] Phone A → Request bill → only A's orders change to bill requested
- [ ] Orders → **Whole table** → one bill with both groups; **Move** → pick Table 6 → order shows Table 6
- [ ] Phone A scans Table 6's QR → "Move to Table 6?" → Yes → order shows Table 6
- [ ] Customer app → **Staff confirm a table's first order** on → new phone orders at an empty table → "staff will confirm" note; Kitchen doesn't show it; Orders → **Confirm table** → Kitchen shows it
- [ ] Tables → ↻ on Table 3 → print → the old Table 3 QR says "isn't in use any more"
- [ ] Customer app → add a banner linked to an item → customer home shows it → tap → item sheet opens; set an end date in the past → it disappears
- [ ] Announcement on → strip shows on home and menu
- [ ] A regular customer with enough points → checkout shows the milestone card and the points chip → tap **Use** → discount in the bill → place order → confetti
- [ ] Customer app → turn off Item photos → menu shows a compact list

---

## New menu layout + every screen fitted for phones (2026-10-04)

**What's new**

| Area | Change |
| --- | --- |
| Main menu | 31 separate menu lines are now **8 sections**: Home · Sell · Menu · Stock · Customers · Money · Team · Settings. Tap a section to open its pages; the section you're in stays open. |
| Where pages went | **Menu** has Items, Categories, Recipes & Costing, Brands & Taxes, Homepage Sections. **Sell** has Counter, Kiosk, Orders, Kitchen, Tables. **Money** has Cash & Shifts, Finance, Reports, Profit advisor. **Team** has Employees, Attendance, Payroll, Staff logins & Roles. **Settings** has Cafe settings, Alerts, Audit log. |
| Merged pages | **Order history** is a tab next to Orders; **Points** (old Loyalty Points page) is a tab next to Rewards; **Sales trends** (old Analytics page) is a tab next to Reports. |
| Section tabs | Every page shows its section's pages as tabs at the top (e.g. Items · Categories · Recipes…), so you move between them without opening the menu. Counter and Kiosk keep the whole screen. |
| Languages | Menu names in **English / हिन्दी / Hinglish** — switch at the bottom of the side menu; each phone remembers its choice. (Page content stays English for now.) |
| Phone quick bar | On phones, a bar at the bottom with **Counter · Orders · Kitchen · My day** (only the ones the role allows). |
| Kiosk on phones | 3 compact tiles per row — a whole shelf on one screen instead of 6 big tiles. |
| Counter on phones | 3 tiles per row, and a **“2 items · ₹136 · View cart ↓”** bar at the bottom that jumps to the cart (hides while the cart is on screen). |
| All screens on phones | Smaller page headers, buttons at least 40 px tall, popups (add item, purchase, rule builder…) with one-column forms and less padding. The customer bottom bar (Home · Menu · Rewards · History · Profile) fits 320 px phones. Checked automatically: all 31 admin pages at 320 and 360 px, 15 popups and 8 customer pages — nothing wider than the screen. |
| Unchanged | Page addresses are the same, so alerts, bookmarks and the Android app open the right pages. Roles still decide what each person sees. |

**Deploy**

Nothing to run — Vercel redeploys from `main`; the Android app picks it up on the next open (no new APK).

**Test checklist**
- [ ] Laptop: side menu shows 8 sections; open **Menu** → Items, Categories, Recipes & Costing, Brands & Taxes, Homepage Sections; tabs at the top of the page match
- [ ] Orders → tab **Order history**; Rewards → tab **Points**; Reports → tab **Sales trends**
- [ ] Side menu → **हिन्दी** → names switch to Hindi; **Hinglish** → Hinglish; reopen the app → choice remembered
- [ ] Phone: quick bar at the bottom (Counter, Orders, Kitchen, My day); not shown on Counter and Kiosk screens
- [ ] Phone → Kiosk: 3 tiles per row, Cash/UPI/Khata bar at the bottom
- [ ] Phone → Counter: add 2 items → bottom bar shows count and total → tap → cart scrolls into view
- [ ] Phone → Menu → Add Item: one-column form, Save button visible
- [ ] Cashier login: only the sections their role allows

---

## Kiosk menu — choose what sells at the main shop and at the kiosk (2026-10-03)

**What's new**

| Area | Change |
| --- | --- |
| Menu | Every item has two switches: **Main shop** (counter, dine-in, takeaway and the customer QR menu) and **Kiosk**. Both are on for every existing item, so nothing changes until you switch something off. One tap on the chips on each item card, or in the item's edit form under *Sold at*. An item must stay on in at least one place (to stop selling it everywhere, mark it Out of Stock). |
| Filter | Menu → new **Where sold** filter: sold in the main shop, sold at the kiosk, main shop only, kiosk only — handy for setting up the kiosk list. |
| Kiosk screen | Shows only items switched on for the kiosk. |
| Counter and customer menu | Show only items switched on for the main shop (customer menu, homepage sections, bestsellers too). |
| Safety | The server refuses an order line for an item that isn't sold at that place (e.g. a kiosk-only cigarette on a QR order), with a clear message. Swiggy/Zomato imports are not affected. |

**Deploy**

1. Supabase → SQL Editor → paste **`supabase/upgrades/2026-10-kiosk-menu.sql`** → Run → *Success*.
2. Vercel redeploys from `main`. No new app build needed.

**Test checklist**
- [ ] Menu → a food item (e.g. Masala Dosa) → tap **Kiosk** to switch it off → Kiosk screen no longer shows it
- [ ] Menu → cigarettes / pan items → tap **Main shop** to switch them off → Counter and the customer menu no longer show them; the Kiosk still does
- [ ] Menu → Where sold → **Kiosk only** lists exactly the kiosk-only items
- [ ] Try to switch both off on one item → the app says it must be sold somewhere

---

## Fix — phone layout (2026-10-03)

**What changed**

| Area | Change |
| --- | --- |
| Dashboard on phones | The four tiles are a compact 2 × 2 grid (icon above the number) instead of two squeezed columns that pushed the page off the screen. Top Spenders rows are left-aligned and say "1 order" / "2 orders". |
| Cause | Some pages reused the same style names (`.stats-grid` in the Customers popup, `.settings-grid` in Loyalty, `.customer-info`), and because every page's styles load together, one page's rules broke another's phone layout. The Customers popup now has its own name, and a phone "safety net" in the admin layout outranks page styles so nothing can widen the page. |
| Other pages fixed at phone width | History, Homepage Sections, Tables, Analytics, Settings, Categories and Employees: header buttons and tab rows wrap or scroll sideways inside their own row. All 31 admin pages were checked at 320 px and 360 px wide with no sideways scrolling. |
| Android app | Text stays at 100% even when the phone's system font size is set large, so cards keep their shape. Needs the new app build (installs over the old one — no uninstall). |

**Deploy**

1. Nothing to run in Supabase. Vercel redeploys from `main` — the website and the current app pick up the layout fix after a refresh.
2. For the font-size fix: GitHub → Actions → **Android app** → Run workflow (same three values) → install the new APK over the old one.

**Test checklist**
- [ ] Phone → Dashboard: four tiles in 2 × 2, nothing cut off on the left or right, no sideways scrolling
- [ ] Phone → History, Analytics, Settings, Tables: the title, buttons and tabs fit; tab rows scroll sideways inside themselves
- [ ] Laptop → Dashboard still shows the four tiles in one row
- [ ] New app installed over the old one (no uninstall needed) → with the phone's font size set large, the dashboard still fits

---

## Fix — phone alerts button for every login (2026-10-03)

**What changed:** *My day* now shows **Turn on alerts on this phone** (or *Phone setup* in the Android app) for logins that aren't linked to an employee record — for example the owner's email login. Before, those logins saw only "not linked" and couldn't turn alerts on.

**Deploy:** nothing to run; Vercel redeploys from `main`.

**Test checklist**
- [ ] Owner email login on a phone → menu **My day** → the *Phone alerts* card is there → Turn on alerts → Allow
- [ ] A staff login linked to an employee still sees check-in, breaks, leave and the alerts card

---

## Phase 7 — Profit advisor, menu matrix and Swiggy/Zomato import (2026-10-03)

**What's new**

| Area | Change |
| --- | --- |
| Profit advisor (`/admin/profit`) | ~18 checks on the cafe's own data, run twice a day when the owner opens it (or **Check now**). Each suggestion shows the **₹ impact a month**, and **Why?** opens the inputs, the formula and the assumption. Ranked: *do today* first, then by impact. Plain arithmetic — no outside AI, no cost per use, same answer every time. |
| The checks | **Menu**: matrix position (raise price / promote / rework), food cost % above target (`target_food_cost_pct`, default 32%), low-rated dishes with falling sales. **Inventory**: reorder today, slow stock (nothing used in 21 days), leaks (counts + wastage), vendor price creep (+10% vs 1–3 months ago). **Costs**: expense category 25%+ above its 3-month average, staff cost above 35% of sales. **Sales**: weakest 3 hours, average bill falling. **Customers**: slipping regulars, new customers not returning. **Marketing**: reward rules that cost more than they bring, rewards over budget (`reward_budget_pct`, default 5% of gross profit). **Profit**: month forecast vs target with the 3 biggest actions. **Cash**: repeated shift mismatches by one person. **Kiosk**: packs vs loose margin. |
| Actions | **Change price** (one tap, for price suggestions), links to the recipe, stock, rewards etc., **Mark done**, **Remind me in 2 weeks**, **Dismiss** (with a reason). The engine never changes anything by itself. |
| Results | *Decisions & results* tab: 4 weeks after each decision the advisor shows what happened, e.g. "Done; 4 weeks later: sales −2%, profit +₹3,700/month". |
| Menu matrix | Kasavana & Smith menu engineering: each dish by units sold × profit per unit, split at the menu averages into **Star / Plowhorse / Puzzle / Dog**, with a chart, what to do with each group, and a table. Items without a recipe or cost are left out (and counted). |
| Swiggy / Zomato / Petpooja import | Upload the weekly order CSV → pick which column is which (guessed automatically) → match report item names to menu items (remembered for next week, close names suggested) → enter commission + fees → **Import**. Orders appear as the *Aggregator* channel in P&L and item profit (no GST — the platform pays it), recipes take stock off, the payout goes into Bank/UPI, the commission is an *Aggregator commission* expense. Re-uploading the same file skips orders already imported. |

**Deploy**

1. Supabase → SQL Editor → paste **`supabase/upgrades/2026-10-phase7.sql`** → Run → *Success*.
   (Coming from Phase 1? Paste **`supabase/upgrades/2026-10-phase2-to-7.sql`** once instead of the six files.)
2. Vercel redeploys from `main`.

**Test checklist**

- [ ] Recipes & Costing: make sure your top 10 dishes have recipes (the advisor needs costs)
- [ ] Reports → Profit target: set a monthly target
- [ ] Profit advisor → suggestions load (first visit runs the checks) → open **Why?** on two of them and check the numbers against your own
- [ ] A *Raise … price* card → **Change price to ₹…** → Menu shows the new price; the card moves to *Decisions & results*
- [ ] Dismiss one with a reason; *Remind me in 2 weeks* on another → both leave the list
- [ ] Menu matrix → last 30 days → your dishes in four groups; hover a dot; the table matches Reports → Item profit
- [ ] Swiggy partner dashboard → download last week's orders CSV → Profit advisor → **Swiggy / Zomato import** → check the columns → match items → commission from the payout statement → Import → Reports → P&L shows the *aggregator* channel and the commission expense; Finance → Bank shows the payout
- [ ] Upload the same file again → "0 imported, N already imported"
- [ ] Cashier login → no Profit advisor; Accountant → can import but sees no suggestions without *See profit*

**Known limits in this release**

- Suggestions need recipes/costs and a few weeks of sales to be specific; with little data the list is short.
- Staff cost by hour (who was on shift vs sales each hour) isn't checked yet; staff cost is checked as a share of sales.
- Report formats differ by platform and change over time; the column picker handles that, but a report with only order totals (no item lines) can't be mapped to dishes.

---

## Phase 6 — Rewards, customer portal, feedback and incentives (2026-10-03)

**What's new**

| Area | Change |
| --- | --- |
| Reward rule builder (`/admin/rewards`) | Each rule = **When** (every Nth order, spend crosses ₹X all-time or per month, first order, visit streak, birthday, anniversary, not visited for X days, customer moves into a group, Instagram verified, given by staff) + **If** (minimum bill, items/categories, days, time window, channel, customer group — restricted items never count) + **Give** (points, ₹ coupon, % coupon with a cap, free item, points multiplier for X days, custom text) + **Limits** (per customer per ever/year/month/week, max per month, monthly ₹ budget, coupon expiry, minimum gap) + **Tell** (show to the customer, WhatsApp message template, who sends it). Each rule shows its **cost per reward, estimated cost per month** and this month's count/cost. |
| Guardrails | A rule **pauses itself** with an alert when its monthly budget is used (restarts on the 1st). Optional: hold the rule while the week is behind the profit target. |
| WhatsApp to-do | When a rule fires, the owner/assigned staff get a *Reward* alert; the to-do card has **Send on WhatsApp** (opens WhatsApp with the customer's number and the filled-in message) → *Sent by Ravi at 7:42 pm*. Unsent cards are reminded daily. Only assigned people (and people allowed to see phone numbers) get the button. |
| Coupons from rewards | Unique code per reward (e.g. `R4F9A21`), usable **only by that customer**, once, before expiry; shown in their portal and marked *used* when redeemed. Free-item rewards take that item off the bill. |
| Customer portal (`/rewards`, new tab in the bottom bar) | Points and their ₹ value, **progress bar** to the next reward ("2 more orders away from ₹40 off"), coupons with copy button, upcoming rewards (birthday, Instagram…), offers to spend points on, history, birthday/anniversary entry (saved once). |
| Slogans and switches | Rewards → Customer portal: every heading and message is editable with a preview; each block (points, progress, upcoming, offers, Instagram, ratings, Google review) can be hidden. |
| Instagram verification | Customer taps **I tagged you** → username + **selfie at the cafe** (private) → verifier queue with the selfie and a profile link → Approve (gives the Instagram rule's reward, within its limits, e.g. once a week) or Reject with a reason the customer sees. Selfies are deleted after 30 days. |
| Dish feedback | After paying, the customer rates each dish 1–5★ with an optional comment (on the order page). Rewards → Feedback: average per dish (lowest first), comments to **reply** to (shown on their order) or hide; 1–2★ ratings send an alert. Feedback stays inside the cafe. |
| Google review | A **Google review** button for every customer after paying (set the link in Customer portal). It isn't tied to the rating — Google bans showing it only to happy customers. |
| Customer groups (automatic) | New · Regular (3+ orders in 30 days) · VIP (top 10% by spend) · Slipping (no visit in 2× their usual gap) · Lost (60+ days) · Occasional. Updated after every paid order and daily. Rewards → Groups lists each group with a one-tap WhatsApp message; rules can trigger on "moves into Slipping". |
| Incentives (Payroll → Incentives) | Rules: **per item** (₹5 per dessert), **add-on**, **sales target** bonus, **team pool** (% of profit above the weekly target, split by hours worked), **ratings** bonus. Option to pay only in weeks that made the profit target, and a cap as % of gross profit. Earnings per person with the working shown; **added to the payslip** when payroll is run. Staff see "₹145 this week" and hints on **My day**. |
| Alerts | New alert type *Low dish rating* in the Alerts grid. |

**Deploy**

1. Supabase → SQL Editor → paste **`supabase/upgrades/2026-10-phase6.sql`** → Run → *Success*.
2. Vercel redeploys from `main`.

**Test checklist**

- [ ] Rewards → Rules: two example rules are there (off). Edit *Every 10th order* → set 2 for testing → Rule is on → Save; the card shows cost per reward and estimate
- [ ] Counter: two sales to the same customer phone → bell *Reward* alert → Rewards → **WhatsApp to-do** → **Send on WhatsApp** opens WhatsApp with the message and code → card shows *sent by you*
- [ ] Customer phone → bottom bar **Rewards** → coupon with code and expiry, progress bar; use the code on the next order → to-do shows *used*; another customer's order with that code is refused
- [ ] Rewards → Customer portal → change the heading, hide *Offers*, add the Google review link and the cafe's Instagram username → Save → the customer page changes
- [ ] Rules → new *Instagram verified* rule (50 points, once a week) → customer: **I tagged you** + selfie → Rewards → Instagram → selfie and @handle → **Approve** → points added; try again same week → approved but no reward (limit)
- [ ] QR order → paid → order page: rate dishes, one 2★ with a comment → bell *Low dish rating* → Rewards → Feedback → **Reply** → customer sees the reply on their order; Google review button shown
- [ ] Rewards → Groups → counts per group; WhatsApp icon opens a message for a Slipping customer
- [ ] Rule with *Monthly budget* ₹100 and ₹50 coupons → after 2 rewards it shows *Monthly budget used up*
- [ ] Payroll → **Incentives** → *₹5 per dessert* for everyone → sell desserts from a cashier login → the table shows the cashier's ₹ with the working → My day (cashier) shows it → run payroll → payslip *Incentives* line
- [ ] Customer → Rewards → birthday = today → next day's first owner login (or a Birthday rule + the daily check) creates the birthday reward

**Known limits in this release**

- WhatsApp is sent by hand (one tap): automatic sending needs the paid WhatsApp Business API.
- Sales for incentives count for the person who rang up the order (counter/kiosk); QR orders by customers have no staff attached.
- Birthday, anniversary, inactive and group rules run once a day when the owner or a manager opens the app.

---

## Phase 5 — Staff app, attendance and alerts (2026-10-03)

**What's new**

| Area | Change |
| --- | --- |
| My day (`/admin/me`) | Every staff login gets a phone screen: **Check in / Check out** with a **selfie** and GPS, only inside the cafe's radius; late minutes against the shift start; **Break 15 / 30 / Delivery 60** buttons; this month's present / half / leave / late; **Ask for leave** (goes to Payroll → Leave for approval); **Turn on alerts on this phone**. |
| Attendance (`/admin/attendance`) | Owner/manager board for any day: in, out, late, auto check-out, **now inside / outside / on break / stopped reporting**, breaks taken, both selfies (private, opened through short-lived links). Map-pin button = today's location points (inside/outside, distance, Google Maps link). Per employee: **link to their app login**, location tracking on/off, shift start. **Cafe location**: stand in the cafe and tap *Use my location*, radius, alert-after minutes, ping interval. |
| On-premises check | While checked in and the app is open, the phone reports location every 10 min (setting). Outside the radius → a yellow banner on the staff phone ("Back in 5 min?" / *Going for a break*); still outside after 10 min → **alarm to the owner/manager**: "Ravi left the cafe 12 min ago". A phone that stops reporting shows *stopped reporting* (loud alert), not absent. Forgot to check out → closed the next day at check-in + shift hours and flagged *auto*. Location points are deleted after 30 days. |
| Consent | Staff terms **version 2** explain the location and selfie use in plain words; every staff member accepts again on next login. Owners can switch tracking off per person. |
| Alerts (`/admin/alerts`) | A grid of **people × alert types** (new order, payment request, staff left, phone silent, escalation, low stock, cash mismatch, void, approvals, reward, Instagram, khata due, GST due, subscription) with **Alarm / Loud / Normal / Off** per person, plus **quiet hours** (only order and payment alarms ring then). People only get alerts their role can see. New QR orders now ring as an alarm. |
| Alarm screen | Full-screen alarm now has **Snooze 5 / 10 / 15 min**; it rings again if nobody acknowledged. Unanswered alarms escalate to the owner after 5 min. |
| Install as an app | The website is now installable (**Add to Home screen** on Android Chrome and iPhone Safari) with the cafe's name, icon and colour, and opens offline to the last screen. With the push key set (below), alerts arrive **even when the app is closed**. |
| Android app (APK) | `frontend/android` + GitHub Actions workflow **Android app**: builds an APK per cafe that opens the cafe's live site at *My day*, so website updates reach phones without reinstalling. Inside the app: **full-screen alarm over the lock screen** (rings until opened, snooze 5 min), a **Phone setup** checklist (notifications, full-screen alarms, battery unrestricted, Xiaomi/Oppo/Vivo autostart hint, **Test alarm**) and a "new version available" note. |
| Push function | `supabase/functions/push-notify`: sends each new alert to the right phones (browser push and Android), in each person's chosen style, and removes phones that turned alerts off. |

**Deploy (needs you)**

1. Supabase → SQL Editor → paste **`supabase/upgrades/2026-10-phase5.sql`** → Run → *Success*.
2. Vercel redeploys from `main`. The app works from here; steps 3–6 add alerts while the app is closed.
3. **Push keys** (once, on your Mac): `npx web-push generate-vapid-keys` → it prints a *Public Key* and a *Private Key*.
   - Vercel → the cafe project → Settings → Environment Variables → `VITE_VAPID_PUBLIC_KEY` = the public key → Redeploy.
   - Supabase → Edge Functions → Secrets → add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (= `mailto:nairsolutions02@gmail.com`) and `PUSH_WEBHOOK_SECRET` (any long random text, e.g. from `openssl rand -hex 24`).
4. **Deploy the function** (Mac terminal, in the repo): `npx supabase login` → `npx supabase functions deploy push-notify --project-ref <your project ref> --no-verify-jwt`.
5. **Database webhook**: Supabase → Database → Webhooks → *Create* → name `push`, table `notification_events`, event **Insert**, type **Supabase Edge Functions** → `push-notify`, method POST, add HTTP header `x-webhook-secret` = the same `PUSH_WEBHOOK_SECRET` → Create.
6. **Android app** (optional, for lock-screen alarms):
   - Firebase console → Add project → Add app → Android → package name e.g. `in.nairsolutions.fika` → download `google-services.json`. Project settings → Service accounts → *Generate new private key* (a JSON file).
   - GitHub → repo → Settings → Secrets and variables → Actions → New secret `GOOGLE_SERVICES_JSON` = contents of google-services.json.
   - Supabase → Edge Functions → Secrets → `FCM_SERVICE_ACCOUNT` = contents of the service-account JSON.
   - Optional signing key, so updates install over the old app: `keytool -genkey -v -keystore fika.jks -alias fika -keyalg RSA -keysize 2048 -validity 10000` → `base64 -i fika.jks | pbcopy` → secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (= fika), `ANDROID_KEY_PASSWORD`. Keep the .jks file safe — losing it means reinstalling the app on every phone.
   - GitHub → Actions → **Android app** → Run workflow → cafe URL, app name (e.g. *FiKA Staff*), app id (same package name as Firebase) → download the APK from the run's *Artifacts* → send it to staff phones (allow "install unknown apps").

**Test checklist**

- [ ] Attendance → stand in the cafe → *Use my location* → Save → *Check on map* shows the cafe
- [ ] Attendance → each employee row → **App login** = their staff login; set shift start
- [ ] Staff phone: log in with PIN → accept the new terms (location consent) → menu **My day** → Selfie → **Check in** → green "Checked in at …"
- [ ] Owner: Attendance shows *inside* and the selfie; tap the map pin → location points
- [ ] Staff walks ~100 m away and opens the app → yellow "You are outside the cafe" banner; after 10 min the owner's phone rings *Ravi left the cafe*
- [ ] Staff → *Break 15 min* → board shows *break till …*; no alarm while on break
- [ ] Alerts → set *New order* = Off for a cashier, quiet hours 23:00–08:00 for yourself
- [ ] Customer QR order → owner screen rings full-screen → **Snooze 5 min** → rings again after 5 min → Acknowledge
- [ ] (after steps 3–5) My day → **Turn on alerts on this phone** → close the browser → place a QR order → phone notification arrives
- [ ] (after step 6) Install the APK → My day → **Phone setup** all green → **Test alarm** rings over the lock screen
- [ ] Staff checks out with a selfie; a staff member who forgets shows *auto* next day, closed at check-in + shift hours

**Known limits in this release**

- Location is checked only while the app (or browser tab) is open; when the phone is locked for long, Android may pause it — the board then shows *stopped reporting*. Background tracking would need a Play Store review.
- iPhone: alerts while closed work only from the home-screen app (iOS 16.4+), and iPhones never show a full-screen alarm.
- The APK isn't on the Play Store; staff install it directly. If no signing key is set, uninstall the old app before installing a new build.

---

## Phase 4 — Reports and payroll (2026-10-03)

**What's new**

| Area | Change |
| --- | --- |
| Reports (`/admin/reports`) | **Profit & loss** for any period (this week, this month, last month, last 30 days, custom) next to the previous period with % change: sales by channel → GST → net sales → cost of goods (recipe/cost snapshot per order line) → gross profit → wastage and count losses → staff cost → expenses by category → net profit. Every line has a **Why?** with the formula and where the numbers come from. Needs *See profit*. |
| Spread costs | An expense spread over several months (e.g. a yearly licence, a big electricity bill) counts a share per day, so one day's profit isn't distorted. One-month expenses count on their date. |
| Staff cost | From finalized payroll; months without one use each active employee's salary as an **estimate** (labelled). |
| Cash flow | Per money account: opening + in − out = closing. |
| Profit target | Weekly and monthly ₹ targets with a progress bar and a straight-line **forecast** for the period end. |
| Item profit | Every item sold: units, net sales, cost, contribution (₹ and %), per unit, share of total profit, trend vs the previous period; "cost unknown" flag for items without a recipe or cost. |
| GST pack | Sales by GST rate (taxable, CGST, SGST), HSN/SAC summary (new *HSN code* on menu items; blank = SAC 996331), purchases with vendor GSTIN, bill number range; each downloads as CSV for the CA. **Due dates** for monthly, quarterly (QRMP) or composition filing, with a bell reminder 3 days before. |
| Payroll (`/admin/payroll`) | Per employee pay type (**monthly / daily / hourly**), OT rate, shift hours, weekly off (Employees → Edit). **Run payroll** for a month from attendance: present, half-days (½), paid leave, holidays, weekly offs; overtime beyond the shift; advance instalment and approved penalties deducted. **Finalize**, then **Pay all** (or one) from Bank/Cash/UPI — each salary is a money-ledger entry. Printable **payslip** (Save as PDF). |
| Leave | Leave types (Casual 8, Sick 6, Earned 12, Unpaid) with yearly quotas; requests → approve/reject (marks attendance as leave) → balances per employee. |
| Advances & penalties | Give an advance (from any account, recovered per month); add a penalty (late, breakage) which a **second person** must approve; both appear on the payslip. |
| Privacy | Salary, wage and OT rates are hidden from anyone without *See salaries*; payroll needs it too. |

**Deploy**

1. Supabase → SQL Editor → paste **`supabase/upgrades/2026-10-phase4.sql`** → Run → *Success*.
2. Vercel redeploys from `main`.

**Test checklist**

- [ ] Reports → Profit & loss → *This month*: sales by channel, net sales, cost of goods, gross profit, net profit; tap **Why?** on a few lines
- [ ] Finance → Expenses → add a ₹12,000 *Licences* expense spread over 12 months → P&L for this month shows only its share
- [ ] Reports → Profit target → set a monthly target → progress bar and forecast
- [ ] Reports → Item profit → items with contribution and share; an item without recipe shows *cost unknown*
- [ ] Reports → GST → pick *Last month* → sales by rate + HSN; download the three CSVs; set the filing type; due dates update
- [ ] Menu → an item → *HSN code* (e.g. packaged drink 2202) → it appears in the HSN summary
- [ ] Employees → Edit → pay type, OT rate, shift hours, weekly off → Save
- [ ] Payroll → last month → **Run payroll** → check present / half / leave / offs / OT per person → **Finalize** → **Pay all** from Bank → Finance → Money ledger shows salary lines
- [ ] Payroll → payslip printer icon → print / Save as PDF
- [ ] Payroll → Leave → add a request → **Approve** → balance goes up by 1 used; the day shows as leave in attendance
- [ ] Payroll → Advances & penalties → give ₹3,000 advance (₹1,000/month) → next payroll deducts ₹1,000; add a penalty → another manager approves → deducted
- [ ] Cashier login → no Reports, Finance or Payroll; Accountant → can see Reports and Payroll but not run payroll

**Known limits in this release**

- PF/ESI are not calculated (off until the cafe crosses the thresholds; the CA confirms them).
- Incentives on payslips arrive with Phase 6 (incentive rules).
- Tally export isn't included; the CSVs open in Excel for the CA.

---

## Phase 3 — Kiosk and khata (2026-10-03)

**What's new**

| Area | Change |
| --- | --- |
| Kiosk (`/admin/kiosk`) | Fast screen for a phone or tablet: **customer tabs** across the top (Guest 1 · Raju · +) so several people can be served at once; customer by phone digits or name, regulars as one-tap chips (with khata due); big tiles, most sold at the kiosk first, with **pieces left** at the kiosk and an amber bar when low; brand/category chips. Tap = +1 piece; **hold** (long-press) for a number pad with **Piece / Pack**. One tap on **Cash · UPI · Khata** settles the tab and moves to the next waiting customer. A regular buying 2 cigarettes on khata took under 1 second of taps in testing. |
| Kiosk stock and cash | Kiosk sales take stock from the location marked *Kiosk sells from here* (Inventory → Locations) and cash goes to the **Cash – Kiosk** drawer with its own shift. Kiosk sales never go to the kitchen screen. Works offline like the counter (code K1). |
| Restricted items | "Customer looks under 18? Check ID" shows when a restricted item is in the cart (Settings key `restricted_id_reminder`). Restricted items still earn no points or offers. |
| Khata | Per-customer **credit limit** (Khata page → Limit; 0 = no credit). A sale beyond the limit needs a manager's mobile + PIN (new permission *Approve khata over the limit*; Managers have it). Balances come from the money ledger (Khata account), so cancelling a khata sale takes it off automatically. |
| Khata page (`/admin/khata`) | Who owes what, **oldest unpaid** in days (first-in-first-out), aging 0–7 / 8–15 / 16–30 / 30+, **Collect** (cash into a drawer, UPI or card), **WhatsApp** reminder with the amount pre-filled, full history. Once a day the bell shows "N khata accounts due over 7 days" (Settings key `khata_reminder_days`). |
| Low stock per location | Inventory → Stock → Edit → *Low-stock level at one location* (e.g. Kiosk: 20 pc of Gold Flake) drives the amber bar on kiosk tiles. |
| Plans | Kiosk devices count against the plan (Starter 0, Pro 1, Business 3, Custom 5). Set the plan in /superadmin before using the kiosk. |

**Deploy**

1. Supabase → SQL Editor → paste **`supabase/upgrades/2026-10-phase3.sql`** → Run → *Success*.
2. /superadmin → FiKA → make sure the plan allows at least 1 kiosk (Custom allows 5).
3. Vercel redeploys from `main`.

**Test checklist**

- [ ] Inventory → Locations: *Kiosk sells from here* is ticked on **Kiosk**
- [ ] Recipes → Gold Flake (or any resale item) → *Track it as its own stock item*; Menu → its Pack units → *Pack = 10*, sale price ₹190
- [ ] Purchases → buy 100 pc, *Received at* **Kiosk** → kiosk tile shows "100 left"
- [ ] Cash & Shifts → **Cash – Kiosk** → Open shift
- [ ] Khata → search a regular's phone → **Limit** ₹500
- [ ] Kiosk: type 4 digits of the regular's phone → pick → tap the cigarette twice → "Check ID" banner → **Khata** → green confirmation; tile drops by 2
- [ ] Kiosk: **+** tab → hold the cigarette tile → Pack → 1 → Add; **+** another tab → Mint; go back to the pack tab → **Cash**; it jumps to the Mint tab → **UPI**
- [ ] Kiosk: put the regular over their limit → asks for manager mobile + PIN → approved sale goes through
- [ ] Khata page: the regular shows the due amount and *0 days* → **Collect** by UPI → due drops; **History** lists the sale and the payment; **WhatsApp** opens with the message pre-filled
- [ ] Cash & Shifts → Kiosk drawer shows cash expected = opening + kiosk cash sales; close it
- [ ] Orders → cancel a khata sale (reason) → the khata due goes down
- [ ] Phone (portrait): kiosk tiles and the Cash/UPI/Khata bar fit without sideways scrolling

**Known limits in this release**

- The kiosk lists every available menu item (most sold at the kiosk first). Use the brand/category chips to narrow it.
- A khata limit check for an offline sale happens when it syncs; if the limit is exceeded then, the sale shows under *failed* in the sync pill for a manager to retry with approval.

---

## Phase 2 — Counter, kitchen, offline and money (2026-10-03)

**What's new**

| Area | Change |
| --- | --- |
| Counter (`/admin/pos`) | Fast billing screen: tap tiles (Enter in search adds the first match), takeaway or dine-in (table or token), optional customer by mobile, line notes, pack sizes (e.g. Box of 6 at the box price), discount with reason. **Pay** by cash (quick notes + change), UPI, card or split; or **Send to kitchen** and pay later. |
| Offline | The counter keeps working without internet: the menu is stored on the device, sales get numbers like `C1-261003-0007` (device code + date + count), and a pill shows *Offline · 3 waiting to sync*. They sync in order when the internet returns and are stored exactly once. Failed ones show with Retry. Expenses and drawer pay-outs work offline too. |
| Discounts & voids | Each person's discount limit comes from their role (Cashier 10%, Kiosk 5%, Manager 100%; editable as `max_discount_pct`). Above the limit, a manager types their mobile + PIN at the counter. Cancelling an order needs a reason; people without *Cancel / void orders* need a manager PIN. Paid money is refunded to where it came from. Cancels after the kitchen started are flagged and alert the owner. |
| Kitchen (`/admin/kitchen`) | One ticket per order with table/token, age (amber 10 min, red 20 min), line notes. Tap a line to move it queued → preparing → ready; *All ready* / *Served*. New orders beep. Works on any tablet or TV (Full screen). |
| Printing | 80 mm **KOT** and **bill** printing from the counter, kitchen and orders board through the browser print dialog (works with the USB thermal printer). Optional auto-print KOT. |
| Customer payment | After being served, the customer taps **Pay at the counter** or **Pay by UPI at my table**. Staff get a **full-screen alarm** with sound ("Table 4 wants to pay ₹640 by UPI") until someone taps Acknowledge. |
| Orders board | **Take payment** (cash with change, UPI, card, split; remove the optional service charge), **Cancel** with reason/manager PIN, **KOT** and thermal **Print**, channel/token/staff on every card. |
| Cash & Shifts (`/admin/shifts`) | Open each drawer (Counter, Kiosk) with a note-by-note count. During the shift: pay-outs (optionally recorded as an expense), cash to/from the safe. Close with a count, UPI-app and card-machine totals: shows expected vs counted. A difference above the tolerance (Settings, default ₹50) needs a reason and alerts the owner. |
| Money ledger | Every rupee is one line: sales, refunds, pay-outs, drops, expenses, vendor payments. Never edited; mistakes are reversed. Accounts: Cash – Counter, Cash – Kiosk, Cash – Office/safe, UPI, Card, Bank, Khata. |
| Finance (`/admin/finance`) | **Today** (sales, GST, discounts, unpaid, cancels, money in/out by account, channels, expenses, shifts, voids and discounts list), **Money ledger**, **Expenses** (categories, bill photo, paid now or later, spread over months, cancel with reason, monthly bills like rent), **Payables** (vendor bills aged 0–7/8–15/16–30/30+ days, bills due, pay from any account), **Accounts** (balances). Vendor payments from purchases now go through the ledger. |
| Bill settings | Settings: optional **service charge %** (off by default; shown as optional with its GST, removable), **round-off**, **bill footer**, shift cash tolerance. |
| Alerts | Bell in the admin header with recent alerts (payment requests, cash mismatches, voids after kitchen). |
| Roles | New permission module **Finance** (Manager: view/create/edit; Accountant: view). Cashiers now land on the Counter. |

**Deploy**

1. Supabase → SQL Editor → New query → paste **`supabase/upgrades/2026-10-phase2.sql`** → Run → *Success*.
2. Vercel redeploys from `main` (~1 min).
3. On the billing computer: Chrome → print dialog → choose the thermal printer, paper 80 mm, margins *None*, untick *Headers and footers* once; Chrome remembers it.

**Test checklist**

- [ ] **Cash & Shifts** → Counter → Open shift → count notes (e.g. ₹500×2, ₹100×5) → shows ₹1,500
- [ ] **Counter** → 2 coffees + 1 snack, Takeaway → total with GST → Pay → ₹500 → change shown → Paid → popup prints the KOT/bill (allow pop-ups once)
- [ ] Dine-in → pick a table → item note "less sugar" → Send to kitchen
- [ ] **Kitchen** → ticket shows table + note → tap the line (preparing → ready) → All ready → Served → ticket disappears
- [ ] Counter: discount 50% with reason as a Cashier → asks for manager mobile + PIN → manager approves → saved; Finance → Today lists it with who approved
- [ ] Offline: switch off Wi-Fi on the counter device → sale → pill shows *Offline · 1 waiting* → Wi-Fi on → *Online*; the order appears once in History
- [ ] Customer: QR order → staff mark served → customer taps **Pay by UPI at my table** → admin screen shows the red alarm with sound → Acknowledge → card says "take the QR to the table" → **Take payment** → UPI → customer sees *Payment Received*
- [ ] Orders → **Cancel** a paid order (reason) → cash refunded; if the kitchen had started, the bell shows a void alert
- [ ] Settings → Service charge 10% + Round off → new QR order shows "Service charge (optional)" and a round-off line → Take payment → *Customer asked to remove it* → total drops
- [ ] Cash & Shifts → **Pay out** ₹200 (category Consumables, "milk") → **To safe** ₹1,000 → Close shift: count less than expected → asks for a reason → closes; bell shows "closed short by ₹…"
- [ ] **Finance** → Today: sales, money in/out, shifts, voids; Money ledger lists every entry
- [ ] Finance → Expenses → Add expense (Electricity, *To pay later*) → Payables shows it → pay from Bank → disappears
- [ ] Finance → Expenses → Monthly bills → add "Shop rent" day 1 → it appears under Payables on its day
- [ ] Inventory → Purchases: a bill with *Paid in full* unticked → Finance → Payables shows it under the right age bucket
- [ ] Cashier login → lands on Counter; no Finance in the sidebar

**Known limits in this release**

- Offline needs the device to have opened the Counter online once (to store the menu). Offline bills show "≈" totals; the exact bill is priced when it syncs (cash is recorded as the exact bill amount).
- Bluetooth printers on Android come with the app (Phase 5); USB/network printers on a computer work now.
- Khata (credit) payments arrive with the kiosk (Phase 3).
- Money that moved before this release isn't in the ledger; account balances start from zero.

---

## Phase 1 — Inventory and recipes (2026-10-03)

**What's new**

| Area | Change |
| --- | --- |
| Stock ledger | Every stock change is one entry in Inventory → **Movements** (purchase, sale, cancelled order, transfer, wastage, staff meal, complimentary, correction, count). Entries can't be edited or deleted; mistakes are fixed with a correcting entry. |
| Locations | Main store, Kitchen and Kiosk are created for every cafe (add more under **Locations**). Purchases arrive at the purchase location; sales take stock from the sales location, or from the location set on the item's category or recipe (e.g. the Kiosk category sells from the Kiosk). |
| Stock items | Ingredients, resale products and packaging with a base unit (g, ml, pc) and pack units (Litre = 1000 ml, Crate = 24 pc), reorder level, usual vendor, how often to count, shelf order. |
| Vendors | Phone/WhatsApp, GSTIN, lead time, order cycle, payment terms, amount still to pay. |
| Purchases | Enter a supplier bill in pack units with GST, paid now or later, bill photo. Stock goes up and each item's **average cost** updates: (old stock × old cost + bill amount) ÷ (old + new quantity). A **price alert** shows when an item costs 10%+ more than its average. Unpaid bills can be paid later; a wrong entry can be undone. |
| Recipes & Costing | New page: ingredients × quantity (+ waste %) per menu item, live cost per portion, **food cost %** and **margin** (owner/manager only). Resale items (Coke, cigarettes) get a 1-piece recipe with one click. |
| Automatic deduction | Every order deducts its recipes from the right location the moment it's placed; cancelling the order puts the stock back. Each order line stores its cost at the time of sale (for profit reports later). |
| Wastage & meals | Record wastage (with reason and photo), staff meals and complimentary items per item and location. |
| Transfers | Move stock between locations, several items at once. |
| Counts & leaks | Start a count per location (daily items, daily + weekly, or everything). Blind count by default; expected is taken when each line is saved, so sales during the count don't show as loss. Posting corrects stock and records the variance in ₹. **Where stock went missing** lists count shortfall + wastage per item. |
| Reorder | Daily use (last 14 days), days left, reorder flag (at reorder level, or days left ≤ vendor lead time + 1) and suggested order in packs. **Reorder list** groups by vendor with a **Send on WhatsApp** button. |
| Dashboard | "Low stock" card replaced by **Stock alerts**: items to reorder and top leaks this week. |
| Search | Global search also finds stock items and vendors. |
| Permissions | Costs and stock value need "See cost prices"; margins and food cost % need "See profit". Wastage/counts need Inventory: Create; posting counts, transfers and corrections need Inventory: Edit; undoing purchases needs Inventory: Delete. The database enforces this. |
| Superadmin fix | **Owner PIN** now works for a cafe that had no PIN login (like the migrated `default` cafe): it creates the owner's PIN login from the owner name and mobile in **Edit cafe**. |
| Phone layout | Admin pages no longer scroll sideways on phones; wide tables scroll inside their box. |

**Deploy**

1. Supabase → SQL Editor → New query → paste **`supabase/upgrades/2026-10-phase1.sql`** → Run. Expected: *Success*. (Phase 0 must already be applied.)
2. Vercel redeploys from `main` automatically (~1 minute). Until step 1 runs, the Inventory page shows errors; everything else works.

**Test checklist** (owner login unless noted)

- [ ] Superadmin: Edit cafe → owner mobile filled → **Owner PIN** → set 4 digits → owner can log in with *Phone + PIN*
- [ ] Inventory → **Locations**: Main store (purchases), Kitchen (sales), Kiosk
- [ ] **Vendors** → Add vendor (e.g. Amul, phone, lead time 1, orders every 2 days)
- [ ] **Stock** → Add item *Milk*, unit `ml`, pack unit *Litre = 1000*, vendor Amul, count Daily
- [ ] Add item *Coffee beans*, unit `g`, cost ₹/kg, opening stock 1000
- [ ] **Purchases** → New purchase: Amul, Milk 5 Litre × ₹60 → stock shows 5 L at Main store, avg ₹60/L
- [ ] Second purchase at ₹75 → **price alert** appears; avg becomes ₹67.5/L
- [ ] Purchase with *Paid in full* unticked → shows under "To pay vendors" → **Record payment** clears it
- [ ] Stock → **Transfer** 3 Litre milk Main store → Kitchen → row shows "Main store 7 L · Kitchen 3 L"
- [ ] **Recipes & Costing** → a coffee → add Milk 150 ml + beans 10 g (5% waste) → cost, food cost %, margin show → Save
- [ ] Customer orders 2 of that coffee → Kitchen milk drops by 300 ml; beans by 21 g
- [ ] Cancel that order (Orders) → the stock comes back (Movements shows *Order cancelled*)
- [ ] Stock → **Wastage** on milk 100 ml (reason, optional photo) → Kitchen drops 100 ml
- [ ] **Where it went** (pie icon) on milk → shows the coffee and Wastage with %
- [ ] Kiosk item: Categories → Kiosk category → *Sales take stock from* = Kiosk; Recipes → a resale item → **Track it as its own stock item**; Purchases → buy 24 pc of it, *Received at* Kiosk; sell one → Kiosk stock drops by 1
- [ ] **Counts & leaks** → Start count → Kitchen, Daily items → type a lower milk quantity → **Post count** → variance in ₹ shows; *Where stock went missing* lists milk
- [ ] Stock → set milk reorder level above its stock → **Reorder** status + Reorder list with suggested Litres and **Send on WhatsApp**
- [ ] Dashboard → **Stock alerts** card shows the reorder item and the leak
- [ ] Search bar → vendor name and a stock item open the right tab
- [ ] Chef (Staff & Roles → Chef role: tick Inventory *Create*) → sees stock without costs, can record wastage and count, can't post a count
- [ ] Cashier → no Inventory or Recipes in the sidebar
- [ ] Phone: admin pages don't scroll sideways

**Known limits in this release**

- Variants and add-ons (Small/Large, extra shot) don't have their own recipes yet; give each size its own menu item for now.
- Counting works online only; the offline counter arrives with Phase 2.
- Selling a whole pack (e.g. a pack of 10 cigarettes as one line) comes with the kiosk (Phase 3); until then sell the pack as its own menu item with a 10-piece recipe.
- Vendor payments are tracked on the bill; they move into the money ledger and payables in Phase 2.
- Packaging bought in bulk: set *Track quantity* off; its cost per order is estimated in Phase 4 unit economics.

---

## Phase 0 — Foundation (2026-10-04)

**What's new**

| Area | Change |
| --- | --- |
| Platform | All cafes share one database; each cafe is a *tenant* with its own slug. Existing data moved into the cafe `default`. |
| Superadmin | `/superadmin` console (N.A.I.R. Solutions only): create cafes with an owner PIN, plans with staff limits, record payments (extends "paid until"), lock/unlock, reset owner PIN. |
| Billing lock | After "paid until" + grace days (default 3) a cafe locks: staff see "Account locked", customers can't order. Recording a payment unlocks instantly. Data is never deleted. |
| Staff logins | Staff log in at `/admin/login` with mobile + 4–6 digit PIN. 5 wrong PINs lock for 15 minutes. Owner email login still works. |
| Roles & permissions | Admin → Staff & Roles: 7 editable default roles (Owner, Manager, Cashier, Kiosk operator, Chef, Waiter, Accountant), a permission grid (view/create/edit/delete per section + sensitive switches), per-person exceptions. Enforced by the database, not just hidden. |
| Plan limits | Adding staff beyond the plan's limit is blocked ("Your plan allows 5 staff users…"). |
| Terms & consent | Owners and staff accept terms on first login; acceptances are stored and printable (Staff → Consent). |
| Audit log | Admin → Audit Log: who changed prices, menu, settings, orders, staff, roles and permissions, with before → after. Nobody can edit it. |
| Catalogue | Sub-categories, brands, item types (dish / resale / combo), selling unit, SKU, MRP, "price includes tax", per-item tax groups (Admin → Brands & Taxes), pack units (1 Pack = 10 pcs), restricted items. |
| Bills | Each item is taxed by its own tax group; MRP items include tax; restricted items get no coupons and earn no points; the cart shows the exact bill (each tax line) before ordering. FSSAI number in Settings, printed on bills. |
| Loyalty | Points are now earned on what the customer pays for eligible items **before tax** (previously on the total including tax). |
| Search | One search bar in admin (Ctrl+K or /): menu items (forgives typos), orders, customers (last digits of phone), categories, brands, staff, pages — only what the role may see. Phones are masked for roles without "see customer phone numbers". |

**Deploy (live: cafe-erp-dev / cafe-erp-rust.vercel.app)**

1. Supabase → SQL Editor → New query → paste **`supabase/upgrades/2026-10-phase0.sql`** → Run. Expected: *Success*.
2. Make yourself superadmin: Authentication → Users → **Add user** (your email + password, Auto Confirm), then SQL Editor:
   `select public.make_superadmin('your@email.com');`
3. The code is already on `main`; Vercel redeploys automatically (about 1 minute).
4. Optional: in Vercel set `VITE_TENANT_SLUG=default` (it's the default anyway).

Order doesn't matter: the new site works on the old database (owner keeps full access) and the old site works on the new database.

**Test checklist**

- [ ] Customer: open the site on your phone, log in with name + mobile, order 2 items, the cart shows CGST/SGST lines, order goes through
- [ ] Owner: `/admin/login` → **Owner email** tab → log in → accept the owner terms once → Dashboard loads
- [ ] Owner: Staff & Roles → **Add staff** (role Cashier, note the PIN) → appears with "1 of N staff users"
- [ ] Cashier: on another device or Incognito, `/admin/login` → mobile + PIN → accept staff terms → lands on **Orders**; sidebar has no Dashboard, Analytics, Staff or Audit
- [ ] Cashier: typing `/admin/analytics` in the address bar sends them back to Orders
- [ ] Owner: Roles & permissions → Cashier → tick **Dashboard & reports: View** → cashier reloads → Dashboard appears
- [ ] Owner: 5 wrong PINs on the cashier's login → "Too many wrong PINs"; owner resets the PIN (key icon) → new PIN works
- [ ] Owner: Brands & Taxes → add a brand and a tax group (e.g. Packaged goods 18% = CGST 9 + SGST 9)
- [ ] Owner: Categories → add a sub-category under an existing category
- [ ] Owner: Menu → edit an item → set brand, tax group, MRP, "price includes tax", restricted → card shows *Restricted* and *MRP*
- [ ] Owner: Menu → edit → **Pack units** → add "Pack = 10"
- [ ] Customer: order the restricted MRP item with a coupon → coupon applies only to the other items; total = MRP × qty for that item
- [ ] Owner: Settings → FSSAI number → Save → generate a bill → FSSAI shows on it
- [ ] Owner: search bar → type a dish with a typo, a customer's last 4 digits, an order number → each opens the right page
- [ ] Owner: Audit Log → shows the price / staff / permission changes you just made with your name
- [ ] Owner: Staff → Consent "v1" → Print / Save as PDF works
- [ ] Superadmin: `/superadmin` → log in → see the `default` cafe → **Record payment** (1 month) → paid-until moves 1 month
- [ ] Superadmin: **Lock now** → owner/cashier see "Account locked"; customer gets "Ordering is paused" → **Unlock** → all normal
- [ ] Superadmin: **New cafe** (test) → appears with its owner; (its site needs a separate Vercel project with `VITE_TENANT_SLUG=<slug>`)

**Known limits in this release**

- A customer page doesn't show a "paused" banner before ordering when the cafe is locked; the message appears when placing the order.
- Kiosk/device limits in plans are stored but not enforced until the kiosk ships (Phase 3).
- Pack units are recorded now and will drive stock deduction in Phase 1 (inventory).
