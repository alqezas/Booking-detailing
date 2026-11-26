# Connecting a new tire service

No code change and no deploy are needed.

1. **Platform admin** opens `/admin` → **New business**: name, slug (URL), owner email,
   CRM language, currency, first branch. This creates the tenant with:
   - settings (tax rate and time zone defaulted from the currency), all modules on except
     AI assistant and corporate fleets,
   - vehicle categories, payment methods, 12 service categories, order counter,
   - an Auth invitation to the owner (or attaches an existing account).
2. **Owner** accepts the email invitation, sets a password and lands in the CRM.
3. Owner → **Settings**:
   - *Business*: legal details, VAT, currency, languages (CRM and booking page separately),
     time zone, storage price, branding colors and logo.
   - *Online booking*: slot step, earliest booking, horizon, change deadline, confirmation required, seasonal mode.
   - *Modules*: switch off what the shop does not use (e.g. tire hotel).
   - *Branches* (with opening hours) and *Posts* (equipment such as `lift, balancer, changer, truck_lift`).
   - *Team*: invite managers, mechanics, accountant; link mechanics to employee records so "My work" shows their orders.
4. **Services & prices**: add services, then pricing/duration rules (R17–18 +50, SUV +20 %, RunFlat +150…).
   Check results with *Price check*.
5. **Tire hotel**: generate cells (Zone/Racks/Shelves/Cells) for the hotel warehouse.
6. **Inventory**: add products and opening stock (Receipt).
7. Publish the booking link `https://<domain>/s/<slug>` on the shop's website / Google profile.
8. Notifications: templates exist per event/channel/language; channels start on the test adapter.
   Connect real providers as described in [INTEGRATIONS.md](INTEGRATIONS.md).

Import existing customers: Customers → *Import CSV* (`first_name,last_name,phone,email,plate`).
